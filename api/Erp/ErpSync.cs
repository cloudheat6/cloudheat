using Dapper;
using Npgsql;

namespace Cloudheat.Api.Erp;

public sealed class SyncLog
{
    public long SyncId { get; init; }
    public string Kind { get; init; } = "";
    public string TriggerBy { get; init; } = "";
    public DateTime StartedAt { get; init; }
    public DateTime? FinishedAt { get; init; }
    public int Fetched { get; init; }
    public int Applied { get; init; }
    public int Skipped { get; init; }
    public string Status { get; init; } = "";
    public string Message { get; init; } = "";
}

/// <summary>ERP → MES 수신: 발주 · 수주를 증분(updated_at 기준)으로 받아 MES 사본 테이블에 반영</summary>
public sealed class ErpSyncService(NpgsqlDataSource db, ErpClient erp, ILogger<ErpSyncService> log)
{
    public static readonly string[] Kinds = ["발주", "주문"];
    private readonly SemaphoreSlim _gate = new(1, 1);   // 자동 · 수동 수신이 겹치지 않게

    public async Task<SyncLog?> SyncAsync(string kind, string triggerBy, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return await SyncCoreAsync(kind, triggerBy, ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<SyncLog?> SyncCoreAsync(string kind, string triggerBy, CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        await using var conn = await db.OpenConnectionAsync(ct);
        var since = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT last_updated_at FROM mes.erp_sync_cursor WHERE kind = @kind", new { kind });

        List<ErpOrder> orders;
        try
        {
            orders = kind == "발주"
                ? await erp.GetPurchaseOrdersAsync(since, ct)
                : await erp.GetSalesOrdersAsync(since, ct);
        }
        catch (ErpException ex)
        {
            await MarkCheckedAsync(conn, kind, "실패", ex.Message);
            return await WriteLogAsync(conn, kind, triggerBy, started, 0, 0, 0, "실패", ex.Message);
        }

        // 자동 수신인데 새 데이터가 없으면 로그는 남기지 않고 '마지막 확인' 만 갱신 (1분마다 빈 로그 방지)
        if (orders.Count == 0 && triggerBy == "자동")
        {
            await MarkCheckedAsync(conn, kind, "성공", "새 데이터 없음");
            return null;
        }

        var applied = 0;
        var problems = new List<string>();
        foreach (var order in orders)
        {
            var error = await ApplyAsync(conn, kind, order, ct);
            if (error is null) applied++;
            else problems.Add($"{order.OrderNo}: {error}");
        }

        if (orders.Count > 0)
        {
            await conn.ExecuteAsync("""
                INSERT INTO mes.erp_sync_cursor (kind, last_updated_at) VALUES (@kind, @at)
                ON CONFLICT (kind) DO UPDATE SET last_updated_at = EXCLUDED.last_updated_at
                """, new { kind, at = orders.Max(o => o.UpdatedAt) });
        }

        var status = problems.Count == 0 ? "성공" : applied > 0 ? "부분성공" : "실패";
        var message = problems.Count == 0
            ? (orders.Count == 0 ? "새 데이터 없음" : $"{string.Join(", ", orders.Select(o => o.OrderNo).Take(5))}{(orders.Count > 5 ? " 외" : "")}")
            : string.Join(" / ", problems);
        if (problems.Count > 0) log.LogWarning("{Kind} 수신 일부 실패: {Message}", kind, message);
        await MarkCheckedAsync(conn, kind, status, message);
        return await WriteLogAsync(conn, kind, triggerBy, started, orders.Count, applied, problems.Count, status, message);
    }

    // 종류별 마지막 확인 결과 (화면의 '발주 수신 · 주문 수신' 상태)
    private static Task MarkCheckedAsync(NpgsqlConnection conn, string kind, string status, string message) =>
        conn.ExecuteAsync("""
            INSERT INTO mes.erp_sync_cursor (kind, last_checked_at, last_status, last_message)
            VALUES (@kind, now(), @status, left(@message, 500))
            ON CONFLICT (kind) DO UPDATE
                SET last_checked_at = now(), last_status = EXCLUDED.last_status, last_message = EXCLUDED.last_message
            """, new { kind, status, message });

    // 주문 1건 = 트랜잭션 1개. MES 에 없는 품목이 있으면 그 건만 건너뜀
    private static async Task<string?> ApplyAsync(NpgsqlConnection conn, string kind, ErpOrder o, CancellationToken ct)
    {
        var codes = o.Lines.Select(l => l.ItemCode).Distinct().ToArray();
        var known = (await conn.QueryAsync<string>(
            "SELECT item_code FROM mes.item WHERE item_code = ANY(@codes)", new { codes })).ToHashSet();
        var missing = codes.Where(c => !known.Contains(c)).ToArray();
        if (missing.Length > 0) return $"MES 품목 미등록 ({string.Join(", ", missing)})";

        var (h, l, no, date, partner, qtyDone) = kind == "발주"
            ? ("purchase_order", "purchase_order_line", "po_no", "po_date", "vendor_name", "received_qty")
            : ("sales_order", "sales_order_line", "so_no", "so_date", "customer_name", "shipped_qty");

        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync($"""
            INSERT INTO mes.{h} ({no}, {date}, {partner}, due_date, erp_status, synced_at)
            VALUES (@OrderNo, @OrderDate::date, @PartnerName, @DueDate::date, @Status, now())
            ON CONFLICT ({no}) DO UPDATE
                SET {date} = EXCLUDED.{date}, {partner} = EXCLUDED.{partner}, due_date = EXCLUDED.due_date,
                    erp_status = EXCLUDED.erp_status, synced_at = now()
            """, o, tx);
        foreach (var line in o.Lines)
        {
            await conn.ExecuteAsync($"""
                INSERT INTO mes.{l} ({no}, line_no, item_code, order_qty)
                VALUES (@no, @LineNo, @ItemCode, @Qty)
                ON CONFLICT ({no}, line_no) DO UPDATE SET item_code = EXCLUDED.item_code, order_qty = EXCLUDED.order_qty
                """, new { no = o.OrderNo, line.LineNo, line.ItemCode, line.Qty }, tx);
        }
        // ERP 에서 삭제된 라인 정리 (이미 입고/출고된 라인은 유지)
        await conn.ExecuteAsync($"""
            DELETE FROM mes.{l} WHERE {no} = @no AND {qtyDone} = 0 AND NOT (line_no = ANY(@lineNos))
            """, new { no = o.OrderNo, lineNos = o.Lines.Select(x => x.LineNo).ToArray() }, tx);
        await tx.CommitAsync(ct);
        return null;
    }

    private static Task<SyncLog> WriteLogAsync(NpgsqlConnection conn, string kind, string triggerBy, DateTime started,
        int fetched, int applied, int skipped, string status, string message) =>
        conn.QuerySingleAsync<SyncLog>("""
            INSERT INTO mes.erp_sync_log (kind, trigger_by, started_at, finished_at, fetched, applied, skipped, status, message)
            VALUES (@kind, @triggerBy, @started, now(), @fetched, @applied, @skipped, @status, left(@message, 500))
            RETURNING sync_id, kind, trigger_by, started_at, finished_at, fetched, applied, skipped, status, message
            """, new { kind, triggerBy, started, fetched, applied, skipped, status, message });
}

/// <summary>1분마다 발주 · 수주 자동 수신</summary>
public sealed class ErpSyncWorker(ErpSyncService sync, ErpOptions options, ILogger<ErpSyncWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled) { log.LogWarning("Erp:ApiKey 가 없어 ERP 자동 수신을 끕니다"); return; }
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            foreach (var kind in ErpSyncService.Kinds)
            {
                try { await sync.SyncAsync(kind, "자동", stoppingToken); }
                catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "{Kind} 자동 수신 오류", kind); }
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
