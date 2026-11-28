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

/// <summary>
/// ERP → MES 수신. 기준정보(품목 · 거래처)와 발주 · 수주를 updated_at 기준 증분으로 받아 MES 에 반영.
/// 기준정보를 먼저 받아야 발주 · 수주의 품목을 확인할 수 있으므로 Kinds 순서가 중요함.
/// </summary>
public sealed class ErpSyncService(NpgsqlDataSource db, ErpClient erp, ILogger<ErpSyncService> log)
{
    public static readonly string[] Kinds = ["공통코드", "품목", "거래처", "발주", "주문"];
    public static readonly string[] MasterKinds = ["공통코드", "품목", "거래처"];
    public static readonly string[] OrderKinds = ["발주", "주문"];

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

    // 받아온 묶음: 건수 · 다음 기준 시각 · 화면 표시용 번호 · 반영 방법
    private sealed record Batch(
        int Fetched, DateTime? MaxUpdatedAt, List<string> Keys,
        Func<NpgsqlConnection, CancellationToken, Task<(int Applied, List<string> Problems, string? Note)>> Apply);

    private async Task<Batch> FetchAsync(string kind, DateTime? since, CancellationToken ct)
    {
        switch (kind)
        {
            case "공통코드":
            {
                var groups = await erp.GetCodesAsync(since, ct);
                return new(groups.Count, groups.Count > 0 ? groups.Max(x => x.UpdatedAt) : null,
                    groups.Select(x => x.GroupCode).ToList(), (c, t) => ApplyCodesAsync(c, groups, t));
            }
            case "품목":
            {
                var items = await erp.GetItemsAsync(since, ct);
                return new(items.Count, items.Count > 0 ? items.Max(x => x.UpdatedAt) : null,
                    items.Select(x => x.ItemCode).ToList(), (c, t) => ApplyItemsAsync(c, items, t));
            }
            case "거래처":
            {
                var partners = await erp.GetPartnersAsync(since, ct);
                return new(partners.Count, partners.Count > 0 ? partners.Max(x => x.UpdatedAt) : null,
                    partners.Select(x => x.PartnerCode).ToList(), (c, t) => ApplyPartnersAsync(c, partners, t));
            }
            default:
            {
                var orders = kind == "발주"
                    ? await erp.GetPurchaseOrdersAsync(since, ct)
                    : await erp.GetSalesOrdersAsync(since, ct);
                return new(orders.Count, orders.Count > 0 ? orders.Max(x => x.UpdatedAt) : null,
                    orders.Select(x => x.OrderNo).ToList(), async (c, t) =>
                    {
                        var applied = 0;
                        var problems = new List<string>();
                        foreach (var o in orders)
                        {
                            var error = await ApplyOrderAsync(c, kind, o, t);
                            if (error is null) applied++;
                            else problems.Add($"{o.OrderNo}: {error}");
                        }
                        return (applied, problems, null);
                    });
            }
        }
    }

    private async Task<SyncLog?> SyncCoreAsync(string kind, string triggerBy, CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        await using var conn = await db.OpenConnectionAsync(ct);
        var since = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT last_updated_at FROM mes.erp_sync_cursor WHERE kind = @kind", new { kind });

        Batch batch;
        try
        {
            batch = await FetchAsync(kind, since, ct);
        }
        catch (ErpException ex)
        {
            await MarkCheckedAsync(conn, kind, "실패", ex.Message);
            return await WriteLogAsync(conn, kind, triggerBy, started, 0, 0, 0, "실패", ex.Message);
        }

        // 자동 수신인데 새 데이터가 없으면 로그는 남기지 않고 '마지막 확인' 만 갱신 (1분마다 빈 로그 방지)
        if (batch.Fetched == 0 && triggerBy == "자동")
        {
            await MarkCheckedAsync(conn, kind, "성공", "새 데이터 없음");
            return null;
        }

        var (applied, problems, note) = await batch.Apply(conn, ct);

        if (batch.MaxUpdatedAt is { } at)
        {
            await conn.ExecuteAsync("""
                INSERT INTO mes.erp_sync_cursor (kind, last_updated_at) VALUES (@kind, @at)
                ON CONFLICT (kind) DO UPDATE SET last_updated_at = EXCLUDED.last_updated_at
                """, new { kind, at });
        }

        var status = problems.Count == 0 ? "성공" : applied > 0 ? "부분성공" : "실패";
        var message = problems.Count > 0
            ? string.Join(" / ", problems)
            : batch.Fetched == 0
                ? "새 데이터 없음"
                : $"{string.Join(", ", batch.Keys.Take(5))}{(batch.Keys.Count > 5 ? $" 외 {batch.Keys.Count - 5}건" : "")}";
        if (note is not null) message = $"{message} · {note}";
        if (problems.Count > 0) log.LogWarning("{Kind} 수신 일부 실패: {Message}", kind, message);

        await MarkCheckedAsync(conn, kind, status, message);
        return await WriteLogAsync(conn, kind, triggerBy, started, batch.Fetched, applied, problems.Count, status, message);
    }

    // 공통코드: ERP 관리내역등록의 항목 · 상세 코드를 MES 에 동기화 (삭제된 상세 코드도 반영)
    private static async Task<(int, List<string>, string?)> ApplyCodesAsync(NpgsqlConnection conn, List<ErpCodeGroup> groups, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(ct);
        var codeCount = 0;
        foreach (var g in groups)
        {
            await conn.ExecuteAsync("""
                INSERT INTO mes.code_group (group_code, group_name, remark, use_yn, sort_no, erp_synced_at)
                VALUES (@GroupCode, @GroupName, @Remark, @UseYn, @SortNo, now())
                ON CONFLICT (group_code) DO UPDATE
                    SET group_name = EXCLUDED.group_name, remark = EXCLUDED.remark,
                        use_yn = EXCLUDED.use_yn, sort_no = EXCLUDED.sort_no, erp_synced_at = now()
                """, g, tx);

            var codes = g.Codes ?? [];
            codeCount += codes.Count;
            if (codes.Count > 0)
            {
                await conn.ExecuteAsync("""
                    INSERT INTO mes.common_code (group_code, code, code_name, sort_no, use_yn, remark, erp_synced_at)
                    VALUES (@GroupCode, @Code, @CodeName, @SortNo, @UseYn, @Remark, now())
                    ON CONFLICT (group_code, code) DO UPDATE
                        SET code_name = EXCLUDED.code_name, sort_no = EXCLUDED.sort_no,
                            use_yn = EXCLUDED.use_yn, remark = EXCLUDED.remark, erp_synced_at = now()
                    """, codes, tx);
            }
            await conn.ExecuteAsync("""
                DELETE FROM mes.common_code
                WHERE group_code = @GroupCode AND NOT (code = ANY(@keep))
                """, new { g.GroupCode, keep = codes.Select(c => c.Code).ToArray() }, tx);
        }
        await tx.CommitAsync(ct);
        return (groups.Count, [], $"코드 {codeCount}건");
    }

    // 품목: ERP 값(이름 · 구분 · 단위)만 덮어쓰고 MES 전용 속성(기본 창고 · 라인 · 안전재고 · 사용)은 유지
    private static async Task<(int, List<string>, string?)> ApplyItemsAsync(NpgsqlConnection conn, List<ErpItem> items, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(ct);
        var inserted = 0;
        foreach (var it in items)
        {
            var isNew = await conn.ExecuteScalarAsync<bool>("""
                INSERT INTO mes.item (item_code, item_name, item_type, unit, default_wh_code, erp_synced_at, updated_at)
                VALUES (@ItemCode, @ItemName, @ItemType, @Unit,
                        (SELECT wh_code FROM mes.warehouse
                         WHERE use_yn AND wh_type = CASE WHEN @ItemType = '원자재' THEN '원자재' ELSE '제품' END
                         ORDER BY wh_code LIMIT 1),
                        now(), now())
                ON CONFLICT (item_code) DO UPDATE
                    SET item_name = EXCLUDED.item_name, item_type = EXCLUDED.item_type, unit = EXCLUDED.unit,
                        erp_synced_at = now(), updated_at = now()
                RETURNING (xmax = 0)
                """, it, tx);
            if (isNew) inserted++;
        }

        // 새 품목이 생기면 '품목 미등록' 으로 건너뛴 발주 · 수주가 있을 수 있으니 처음부터 다시 받게 함
        if (inserted > 0)
            await conn.ExecuteAsync(
                "UPDATE mes.erp_sync_cursor SET last_updated_at = NULL WHERE kind = ANY(@kinds)",
                new { kinds = OrderKinds }, tx);

        await tx.CommitAsync(ct);
        return (items.Count, [], inserted > 0 ? $"신규 {inserted}건 → 발주 · 수주 재수신" : null);
    }

    private static async Task<(int, List<string>, string?)> ApplyPartnersAsync(NpgsqlConnection conn, List<ErpPartner> partners, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync("""
            INSERT INTO mes.partner (partner_code, partner_name, partner_type, erp_synced_at)
            VALUES (@PartnerCode, @PartnerName, @PartnerType, now())
            ON CONFLICT (partner_code) DO UPDATE
                SET partner_name = EXCLUDED.partner_name, partner_type = EXCLUDED.partner_type, erp_synced_at = now()
            """, partners, tx);
        await tx.CommitAsync(ct);
        return (partners.Count, [], null);
    }

    // 주문 1건 = 트랜잭션 1개. MES 에 없는 품목이 있으면 그 건만 건너뜀
    private static async Task<string?> ApplyOrderAsync(NpgsqlConnection conn, string kind, ErpOrder o, CancellationToken ct)
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
            INSERT INTO mes.{h} ({no}, {date}, order_type, currency, {partner}, due_date, erp_status, synced_at)
            VALUES (@OrderNo, @OrderDate::date, @OrderType, @Currency, @PartnerName, @DueDate::date, @Status, now())
            ON CONFLICT ({no}) DO UPDATE
                SET {date} = EXCLUDED.{date}, order_type = EXCLUDED.order_type, currency = EXCLUDED.currency,
                    {partner} = EXCLUDED.{partner}, due_date = EXCLUDED.due_date,
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

    // 종류별 마지막 확인 결과 (화면의 '수신' 상태)
    private static Task MarkCheckedAsync(NpgsqlConnection conn, string kind, string status, string message) =>
        conn.ExecuteAsync("""
            INSERT INTO mes.erp_sync_cursor (kind, last_checked_at, last_status, last_message)
            VALUES (@kind, now(), @status, left(@message, 500))
            ON CONFLICT (kind) DO UPDATE
                SET last_checked_at = now(), last_status = EXCLUDED.last_status, last_message = EXCLUDED.last_message
            """, new { kind, status, message });

    private static Task<SyncLog> WriteLogAsync(NpgsqlConnection conn, string kind, string triggerBy, DateTime started,
        int fetched, int applied, int skipped, string status, string message) =>
        conn.QuerySingleAsync<SyncLog>("""
            INSERT INTO mes.erp_sync_log (kind, trigger_by, started_at, finished_at, fetched, applied, skipped, status, message)
            VALUES (@kind, @triggerBy, @started, now(), @fetched, @applied, @skipped, @status, left(@message, 500))
            RETURNING sync_id, kind, trigger_by, started_at, finished_at, fetched, applied, skipped, status, message
            """, new { kind, triggerBy, started, fetched, applied, skipped, status, message });
}

/// <summary>1분마다 기준정보 → 발주 · 수주 순서로 자동 수신</summary>
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
