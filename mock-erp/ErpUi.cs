using Dapper;
using Npgsql;

namespace Cloudheat.MockErp;

// ERP 화면(erp.cloudheat.kr)용: 발주 · 수주 입력 / 수정 / 취소, 기준정보 · MES 수신 문서 조회
// MES 연동 API(/erp/v1)와 달리 API 키 · 가상 장애 없음. 저장할 때마다 updated_at 을 갱신해서 MES 가 증분으로 받아감

public sealed record OrderLineInput(short? LineNo, string ItemCode, int Qty, decimal UnitPrice);
public sealed record OrderInput(string PartnerCode, string OrderDate, string DueDate, List<OrderLineInput> Lines, string? Remark);

public sealed class UiException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class ErpUiStore(NpgsqlDataSource db, ErpStore store)
{
    // 종류별 설정: 테이블 · 번호 · 거래처 구분 · 품목 구분
    private sealed record Kind(string Header, string Line, string No, string Date, string Prefix, string PartnerType, string ItemType, string Label);

    private static readonly Dictionary<string, Kind> Kinds = new()
    {
        ["purchase"] = new("purchase_order", "purchase_order_line", "po_no", "po_date", "PO", "매입처", "원자재", "발주"),
        ["sales"] = new("sales_order", "sales_order_line", "so_no", "so_date", "SO", "매출처", "제품", "수주"),
    };

    private static Kind K(string kind) =>
        Kinds.TryGetValue(kind, out var k) ? k : throw new UiException("알 수 없는 문서 종류예요", 404);

    public async Task<IEnumerable<ErpItem>> ItemsAsync() => await store.ListItemsAsync(null);
    public async Task<IEnumerable<ErpPartner>> PartnersAsync() => await store.ListPartnersAsync(null);

    public async Task<IEnumerable<OrderHeader>> ListAsync(string kind)
    {
        K(kind);
        var all = await store.ListOrdersAsync(kind == "purchase" ? OrderKind.Purchase : OrderKind.Sales, null);
        return all.OrderByDescending(o => o.OrderNo);
    }

    public async Task<string> CreateAsync(string kind, OrderInput input)
    {
        var k = K(kind);
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var (orderDate, dueDate) = await ValidateAsync(conn, tx, k, input);

        // 번호: PO-YYMM-0001 (월별 일련번호). 같은 달 번호를 동시에 따지 않게 잠금
        var prefix = $"{k.Prefix}-{orderDate:yyMM}-";
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext(@prefix))", new { prefix }, tx);
        var last = await conn.ExecuteScalarAsync<int?>($"""
            SELECT max(substring({k.No} FROM '\d+$')::int) FROM erp.{k.Header} WHERE {k.No} LIKE @like
            """, new { like = prefix + "%" }, tx);
        var no = $"{prefix}{(last ?? 0) + 1:D4}";

        await conn.ExecuteAsync($"""
            INSERT INTO erp.{k.Header} ({k.No}, {k.Date}, partner_code, due_date, status, remark, updated_at)
            VALUES (@no, @orderDate::date, @PartnerCode, @dueDate::date, '확정', @remark, clock_timestamp())
            """, new { no, orderDate = orderDate.ToString("yyyy-MM-dd"), input.PartnerCode, dueDate = dueDate.ToString("yyyy-MM-dd"), remark = input.Remark?.Trim() ?? "" }, tx);
        short lineNo = 0;
        foreach (var l in input.Lines)
            await InsertLineAsync(conn, tx, k, no, ++lineNo, l);
        await tx.CommitAsync();
        return no;
    }

    // 수정: 확정 상태만. 기존 행 번호는 유지하고 새 행은 마지막 번호 다음으로 (MES 가 행 번호로 맞춰 봄)
    public async Task UpdateAsync(string kind, string no, OrderInput input)
    {
        var k = K(kind);
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await LockOpenAsync(conn, tx, k, no);
        var (orderDate, dueDate) = await ValidateAsync(conn, tx, k, input);

        var existing = (await conn.QueryAsync<short>(
            $"SELECT line_no FROM erp.{k.Line} WHERE {k.No} = @no", new { no }, tx)).ToHashSet();
        var keep = input.Lines.Where(l => l.LineNo is { } n && existing.Contains(n)).Select(l => l.LineNo!.Value).ToArray();
        if (keep.Length != keep.Distinct().Count()) throw new UiException("같은 행 번호가 두 번 들어 있어요");

        await conn.ExecuteAsync($"""
            UPDATE erp.{k.Header}
            SET {k.Date} = @orderDate::date, partner_code = @PartnerCode, due_date = @dueDate::date, remark = @remark, updated_at = clock_timestamp()
            WHERE {k.No} = @no
            """, new { no, orderDate = orderDate.ToString("yyyy-MM-dd"), input.PartnerCode, dueDate = dueDate.ToString("yyyy-MM-dd"), remark = input.Remark?.Trim() ?? "" }, tx);
        await conn.ExecuteAsync($"DELETE FROM erp.{k.Line} WHERE {k.No} = @no AND NOT (line_no = ANY(@keep))", new { no, keep }, tx);

        var next = (short)(existing.Count == 0 ? 0 : existing.Max());
        foreach (var l in input.Lines)
        {
            if (l.LineNo is { } n && existing.Contains(n))
                await conn.ExecuteAsync($"""
                    UPDATE erp.{k.Line} SET item_code = @ItemCode, qty = @Qty, unit_price = @UnitPrice
                    WHERE {k.No} = @no AND line_no = @n
                    """, new { no, n, l.ItemCode, l.Qty, l.UnitPrice }, tx);
            else
                await InsertLineAsync(conn, tx, k, no, ++next, l);
        }
        await tx.CommitAsync();
    }

    // 취소: 삭제하지 않고 상태만 바꿈 → MES 에도 '취소' 로 전달
    public async Task CancelAsync(string kind, string no)
    {
        var k = K(kind);
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await LockOpenAsync(conn, tx, k, no);
        await conn.ExecuteAsync(
            $"UPDATE erp.{k.Header} SET status = '취소', updated_at = clock_timestamp() WHERE {k.No} = @no", new { no }, tx);
        await tx.CommitAsync();
    }

    public async Task<IEnumerable<ReceivedDocument>> DocumentsAsync() => await store.ListDocumentsAsync(200);

    // ── 내부 ─────────────────────────────────────────────
    private static async Task LockOpenAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Kind k, string no)
    {
        var status = await conn.ExecuteScalarAsync<string?>(
            $"SELECT status FROM erp.{k.Header} WHERE {k.No} = @no FOR UPDATE", new { no }, tx);
        if (status is null) throw new UiException($"{k.Label}을 찾을 수 없어요", 404);
        if (status != "확정") throw new UiException($"{status} 상태라 바꿀 수 없어요", 409);
    }

    private static async Task<(DateOnly OrderDate, DateOnly DueDate)> ValidateAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Kind k, OrderInput input)
    {
        if (!DateOnly.TryParse(input.OrderDate, out var orderDate)) throw new UiException($"{k.Label}일을 확인하세요");
        if (!DateOnly.TryParse(input.DueDate, out var dueDate)) throw new UiException("납기일을 확인하세요");
        if (dueDate < orderDate) throw new UiException($"납기일은 {k.Label}일 이후여야 해요");
        var today = DateOnly.FromDateTime(DateTime.Now);
        if (Math.Abs(orderDate.DayNumber - today.DayNumber) > 366) throw new UiException($"{k.Label}일은 오늘 기준 1년 이내로 입력하세요");
        if ((input.Remark?.Length ?? 0) > 200) throw new UiException("비고는 200자까지예요");

        var ptype = await conn.ExecuteScalarAsync<string?>(
            "SELECT partner_type FROM erp.partner WHERE partner_code = @PartnerCode", new { input.PartnerCode }, tx);
        if (ptype is null) throw new UiException("거래처를 고르세요");
        if (ptype != k.PartnerType) throw new UiException($"{k.Label}는 {k.PartnerType}만 고를 수 있어요");

        if (input.Lines is not { Count: > 0 }) throw new UiException("품목을 한 줄 이상 입력하세요");
        if (input.Lines.Count > 50) throw new UiException("한 문서에 50줄까지 입력할 수 있어요");
        foreach (var (l, i) in input.Lines.Select((l, i) => (l, i + 1)))
        {
            if (l.Qty <= 0 || l.Qty > 1_000_000) throw new UiException($"{i}행: 수량은 1 ~ 1,000,000 이에요");
            if (l.UnitPrice < 0 || l.UnitPrice > 100_000_000) throw new UiException($"{i}행: 단가를 확인하세요");
        }
        var codes = input.Lines.Select(l => l.ItemCode).Distinct().ToArray();
        var types = (await conn.QueryAsync<(string Code, string Type)>(
            "SELECT item_code, item_type FROM erp.item WHERE item_code = ANY(@codes)", new { codes }, tx)).ToDictionary(x => x.Code, x => x.Type);
        foreach (var c in codes)
        {
            if (!types.TryGetValue(c, out var t)) throw new UiException($"품목을 찾을 수 없어요: {c}");
            if (t != k.ItemType) throw new UiException($"{k.Label}에는 {k.ItemType} 품목만 넣을 수 있어요: {c}");
        }
        return (orderDate, dueDate);
    }

    private static Task InsertLineAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Kind k, string no, short lineNo, OrderLineInput l) =>
        conn.ExecuteAsync($"""
            INSERT INTO erp.{k.Line} ({k.No}, line_no, item_code, qty, unit_price)
            VALUES (@no, @lineNo, @ItemCode, @Qty, @UnitPrice)
            """, new { no, lineNo, l.ItemCode, l.Qty, l.UnitPrice }, tx);
}
