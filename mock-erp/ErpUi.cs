using Dapper;
using Npgsql;

namespace Cloudheat.MockErp;

// ERP 화면(erp.cloudheat.kr)용: 관리내역 · 발주 · 주문 입력 / 수정 / 취소, 기준정보 · MES 수신 문서 조회
// MES 연동 API(/erp/v1)와 달리 API 키 · 가상 장애 없음. 저장할 때마다 updated_at 을 갱신해서 MES 가 증분으로 받아감

public sealed record CodeGroupInput(string? GroupCode, string GroupName, string? Remark, short SortNo = 0, bool UseYn = true);
public sealed record CommonCodeInput(string? Code, string CodeName, short SortNo = 0, string? Remark = null, bool UseYn = true);

public sealed record OrderLineInput(
    short? LineNo,
    string ItemCode,
    int Qty,
    decimal UnitPrice,
    long? SupplyAmt = null,
    long? VatAmt = null,
    long? TotalAmt = null);

public sealed record OrderInput(
    string PartnerCode,
    string OrderDate,
    string DueDate,
    List<OrderLineInput> Lines,
    string? Remark,
    string OrderType = "0",
    string Currency = "KRW",
    decimal ExchangeRate = 1m);

public sealed class UiException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class ErpUiStore(NpgsqlDataSource db, ErpStore store)
{
    // 종류별 설정: 테이블 · 번호 · 구분 코드그룹 · 거래처 구분 · 품목 구분
    private sealed record Kind(string Header, string Line, string No, string Date, string Prefix, string TypeGroup, string PartnerType, string ItemType, string Label);

    private static readonly Dictionary<string, Kind> Kinds = new()
    {
        ["purchase"] = new("purchase_order", "purchase_order_line", "po_no", "po_date", "PO", "PO_TYPE", "매입처", "원자재", "발주"),
        ["sales"] = new("sales_order", "sales_order_line", "so_no", "so_date", "SO", "SO_TYPE", "매출처", "제품", "주문"),
    };

    private static Kind K(string kind) =>
        Kinds.TryGetValue(kind, out var k) ? k : throw new UiException("알 수 없는 문서 종류예요", 404);

    public async Task<List<ErpCodeGroup>> CodesAsync() => await store.ListCodeGroupsAsync(null);
    public async Task<IEnumerable<ErpItem>> ItemsAsync() => await store.ListItemsAsync(null);
    public async Task<IEnumerable<ErpPartner>> PartnersAsync() => await store.ListPartnersAsync(null);

    // ── 관리내역 (공통코드) ──────────────────────────────────
    public async Task CreateCodeGroupAsync(CodeGroupInput g)
    {
        var groupCode = RequireText(g.GroupCode, "관리항목 코드", 20).ToUpperInvariant();
        var groupName = RequireText(g.GroupName, "관리항목명", 50);
        var remark = TrimMax(g.Remark, "비고", 200);

        await using var conn = await db.OpenConnectionAsync();
        try
        {
            await conn.ExecuteAsync("""
                INSERT INTO erp.code_group (group_code, group_name, remark, use_yn, sort_no, updated_at)
                VALUES (@groupCode, @groupName, @remark, @UseYn, @SortNo, clock_timestamp())
                """, new { groupCode, groupName, remark, g.UseYn, g.SortNo });
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new UiException("이미 등록된 관리항목 코드예요", 409);
        }
    }

    public async Task UpdateCodeGroupAsync(string groupCode, CodeGroupInput g)
    {
        var groupName = RequireText(g.GroupName, "관리항목명", 50);
        var remark = TrimMax(g.Remark, "비고", 200);

        await using var conn = await db.OpenConnectionAsync();
        var n = await conn.ExecuteAsync("""
            UPDATE erp.code_group
            SET group_name = @groupName, remark = @remark, use_yn = @UseYn, sort_no = @SortNo, updated_at = clock_timestamp()
            WHERE group_code = @groupCode
            """, new { groupCode, groupName, remark, g.UseYn, g.SortNo });
        if (n == 0) throw new UiException("관리항목을 찾을 수 없어요", 404);
    }

    public async Task CreateCodeAsync(string groupCode, CommonCodeInput c)
    {
        var code = RequireText(c.Code, "관리내역 코드", 20);
        var codeName = RequireText(c.CodeName, "관리내역명", 50);
        var remark = TrimMax(c.Remark, "비고", 200);

        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var exists = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS (SELECT 1 FROM erp.code_group WHERE group_code = @groupCode)", new { groupCode }, tx);
        if (!exists) throw new UiException("관리항목을 찾을 수 없어요", 404);

        try
        {
            await conn.ExecuteAsync("""
                INSERT INTO erp.common_code (group_code, code, code_name, sort_no, use_yn, remark, updated_at)
                VALUES (@groupCode, @code, @codeName, @SortNo, @UseYn, @remark, clock_timestamp())
                """, new { groupCode, code, codeName, c.SortNo, c.UseYn, remark }, tx);
            await conn.ExecuteAsync(
                "UPDATE erp.code_group SET updated_at = clock_timestamp() WHERE group_code = @groupCode", new { groupCode }, tx);
            await tx.CommitAsync();
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new UiException("이미 등록된 관리내역 코드예요", 409);
        }
    }

    public async Task UpdateCodeAsync(string groupCode, string code, CommonCodeInput c)
    {
        var codeName = RequireText(c.CodeName, "관리내역명", 50);
        var remark = TrimMax(c.Remark, "비고", 200);

        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var n = await conn.ExecuteAsync("""
            UPDATE erp.common_code
            SET code_name = @codeName, sort_no = @SortNo, use_yn = @UseYn, remark = @remark, updated_at = clock_timestamp()
            WHERE group_code = @groupCode AND code = @code
            """, new { groupCode, code, codeName, c.SortNo, c.UseYn, remark }, tx);
        if (n == 0) throw new UiException("관리내역 코드를 찾을 수 없어요", 404);

        await conn.ExecuteAsync(
            "UPDATE erp.code_group SET updated_at = clock_timestamp() WHERE group_code = @groupCode", new { groupCode }, tx);
        await tx.CommitAsync();
    }

    public async Task DeleteCodeAsync(string groupCode, string code)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var inUse = groupCode switch
        {
            "PO_TYPE" => await conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM erp.purchase_order WHERE order_type = @code)", new { code }, tx),
            "SO_TYPE" => await conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM erp.sales_order WHERE order_type = @code)", new { code }, tx),
            "CURRENCY" => await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM erp.purchase_order WHERE currency = @code) OR EXISTS (SELECT 1 FROM erp.sales_order WHERE currency = @code)", new { code }, tx),
            "ITEM_TYPE" => await conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM erp.item WHERE item_type = @code)", new { code }, tx),
            "PARTNER_TYPE" => await conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM erp.partner WHERE partner_type = @code)", new { code }, tx),
            "UNIT" => await conn.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM erp.item WHERE unit = @code)", new { code }, tx),
            _ => false,
        };
        if (inUse) throw new UiException("이미 문서나 기준정보에서 사용 중인 코드예요. 삭제 대신 '사용'을 끄세요", 409);

        var n = await conn.ExecuteAsync(
            "DELETE FROM erp.common_code WHERE group_code = @groupCode AND code = @code", new { groupCode, code }, tx);
        if (n == 0) throw new UiException("관리내역 코드를 찾을 수 없어요", 404);

        await conn.ExecuteAsync(
            "UPDATE erp.code_group SET updated_at = clock_timestamp() WHERE group_code = @groupCode", new { groupCode }, tx);
        await tx.CommitAsync();
    }

    // ── 발주 · 주문 ──────────────────────────────────────────
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
        var (orderDate, dueDate, orderType, currency) = await ValidateAsync(conn, tx, k, input, null);

        // 번호: PO-YYMM-0001 (월별 일련번호). 같은 달 번호를 동시에 따지 않게 잠금
        var prefix = $"{k.Prefix}-{orderDate:yyMM}-";
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext(@prefix))", new { prefix }, tx);
        var last = await conn.ExecuteScalarAsync<int?>($"""
            SELECT max(substring({k.No} FROM '\d+$')::int) FROM erp.{k.Header} WHERE {k.No} LIKE @like
            """, new { like = prefix + "%" }, tx);
        var no = $"{prefix}{(last ?? 0) + 1:D4}";

        await conn.ExecuteAsync($"""
            INSERT INTO erp.{k.Header} ({k.No}, {k.Date}, order_type, currency, exchange_rate, partner_code, due_date, status, remark, updated_at)
            VALUES (@no, @orderDate::date, @orderType, @currency, @ExchangeRate, @PartnerCode, @dueDate::date, '확정', @remark, clock_timestamp())
            """, new
        {
            no,
            orderDate = orderDate.ToString("yyyy-MM-dd"),
            orderType,
            currency,
            input.ExchangeRate,
            input.PartnerCode,
            dueDate = dueDate.ToString("yyyy-MM-dd"),
            remark = input.Remark?.Trim() ?? "",
        }, tx);
        short lineNo = 0;
        foreach (var l in input.Lines)
            await InsertLineAsync(conn, tx, k, no, ++lineNo, orderType, l);
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
        var (orderDate, dueDate, orderType, currency) = await ValidateAsync(conn, tx, k, input, no);

        var existing = (await conn.QueryAsync<short>(
            $"SELECT line_no FROM erp.{k.Line} WHERE {k.No} = @no", new { no }, tx)).ToHashSet();
        var keep = input.Lines.Where(l => l.LineNo is { } n && existing.Contains(n)).Select(l => l.LineNo!.Value).ToArray();
        if (keep.Length != keep.Distinct().Count()) throw new UiException("같은 행 번호가 두 번 들어 있어요");

        await conn.ExecuteAsync($"""
            UPDATE erp.{k.Header}
            SET {k.Date} = @orderDate::date, order_type = @orderType, currency = @currency, exchange_rate = @ExchangeRate,
                partner_code = @PartnerCode, due_date = @dueDate::date, remark = @remark, updated_at = clock_timestamp()
            WHERE {k.No} = @no
            """, new
        {
            no,
            orderDate = orderDate.ToString("yyyy-MM-dd"),
            orderType,
            currency,
            input.ExchangeRate,
            input.PartnerCode,
            dueDate = dueDate.ToString("yyyy-MM-dd"),
            remark = input.Remark?.Trim() ?? "",
        }, tx);
        await conn.ExecuteAsync($"DELETE FROM erp.{k.Line} WHERE {k.No} = @no AND NOT (line_no = ANY(@keep))", new { no, keep }, tx);

        var next = (short)(existing.Count == 0 ? 0 : existing.Max());
        foreach (var l in input.Lines)
        {
            if (l.LineNo is { } n && existing.Contains(n))
            {
                var (supplyAmt, vatAmt, totalAmt) = ResolveAmounts(orderType, l);
                await conn.ExecuteAsync($"""
                    UPDATE erp.{k.Line}
                    SET item_code = @ItemCode, qty = @Qty, unit_price = @UnitPrice,
                        supply_amt = @supplyAmt, vat_amt = @vatAmt, total_amt = @totalAmt
                    WHERE {k.No} = @no AND line_no = @n
                    """, new { no, n, l.ItemCode, l.Qty, l.UnitPrice, supplyAmt, vatAmt, totalAmt }, tx);
            }
            else
                await InsertLineAsync(conn, tx, k, no, ++next, orderType, l);
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
    private static string RequireText(string? v, string label, int max)
    {
        var s = v?.Trim() ?? "";
        if (s.Length == 0) throw new UiException($"{label}을(를) 입력하세요");
        if (s.Length > max) throw new UiException($"{label}은(는) {max}자까지예요");
        return s;
    }

    private static string TrimMax(string? v, string label, int max)
    {
        var s = v?.Trim() ?? "";
        if (s.Length > max) throw new UiException($"{label}은(는) {max}자까지예요");
        return s;
    }

    private static async Task LockOpenAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Kind k, string no)
    {
        var status = await conn.ExecuteScalarAsync<string?>(
            $"SELECT status FROM erp.{k.Header} WHERE {k.No} = @no FOR UPDATE", new { no }, tx);
        if (status is null) throw new UiException($"{k.Label}을 찾을 수 없어요", 404);
        if (status != "확정") throw new UiException($"{status} 상태라 바꿀 수 없어요", 409);
    }

    private static async Task<(DateOnly OrderDate, DateOnly DueDate, string OrderType, string Currency)> ValidateAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, Kind k, OrderInput input, string? editingNo)
    {
        var orderType = RequireText(input.OrderType, $"{k.Label}구분", 20);
        var validType = await conn.ExecuteScalarAsync<bool>($"""
            SELECT EXISTS (
                SELECT 1 FROM erp.common_code WHERE group_code = @TypeGroup AND code = @orderType AND use_yn
            ) OR (@editingNo IS NOT NULL AND EXISTS (
                SELECT 1 FROM erp.{k.Header} WHERE {k.No} = @editingNo AND order_type = @orderType
            ))
            """, new { k.TypeGroup, orderType, editingNo }, tx);
        if (!validType) throw new UiException($"관리내역에 등록된 {k.Label}구분을 고르세요: {orderType}");

        var currency = string.IsNullOrWhiteSpace(input.Currency) ? "KRW" : input.Currency.Trim().ToUpperInvariant();
        if (currency.Length > 10) throw new UiException("통화 코드는 10자까지예요");
        var validCur = await conn.ExecuteScalarAsync<bool>($"""
            SELECT EXISTS (
                SELECT 1 FROM erp.common_code WHERE group_code = 'CURRENCY' AND code = @currency AND use_yn
            ) OR (@editingNo IS NOT NULL AND EXISTS (
                SELECT 1 FROM erp.{k.Header} WHERE {k.No} = @editingNo AND currency = @currency
            ))
            """, new { currency, editingNo }, tx);
        if (!validCur) throw new UiException($"관리내역에 등록된 통화를 고르세요: {currency}");

        if (input.ExchangeRate <= 0 || input.ExchangeRate > 1_000_000) throw new UiException("환율은 0보다 크고 1,000,000 이하로 입력하세요");

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
            var (s, v, tot) = ResolveAmounts(orderType, l);
            if (s < 0 || v < 0 || tot < 0 || s > 100_000_000_000L || v > 100_000_000_000L)
                throw new UiException($"{i}행: 금액을 확인하세요");
            if (s + v != tot)
                throw new UiException($"{i}행: 합계액({tot:N0})이 공급가({s:N0}) + 부가세({v:N0})와 맞지 않아요");
        }
        var codes = input.Lines.Select(l => l.ItemCode).Distinct().ToArray();
        var types = (await conn.QueryAsync<(string Code, string Type)>(
            "SELECT item_code, item_type FROM erp.item WHERE item_code = ANY(@codes)", new { codes }, tx)).ToDictionary(x => x.Code, x => x.Type);
        foreach (var c in codes)
        {
            if (!types.TryGetValue(c, out var t)) throw new UiException($"품목을 찾을 수 없어요: {c}");
            if (t != k.ItemType) throw new UiException($"{k.Label}에는 {k.ItemType} 품목만 넣을 수 있어요: {c}");
        }
        return (orderDate, dueDate, orderType, currency);
    }

    // 화면에서 직접 수정한 공급가 · 부가세 · 합계액이 오면 그대로 반영하고, 없으면 기본 계산식('1' 영세는 0%, 그 외 10% 소수점 버림) 적용
    private static (long SupplyAmt, long VatAmt, long TotalAmt) ResolveAmounts(string orderType, OrderLineInput l)
    {
        if (l.SupplyAmt is { } s && l.VatAmt is { } v && l.TotalAmt is { } tot)
            return (s, v, tot);
        var supply = (long)decimal.Truncate(l.Qty * l.UnitPrice);
        var vat = orderType == "1" ? 0L : supply / 10L;
        return (supply, vat, supply + vat);
    }

    private static Task InsertLineAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Kind k, string no, short lineNo, string orderType, OrderLineInput l)
    {
        var (supplyAmt, vatAmt, totalAmt) = ResolveAmounts(orderType, l);
        return conn.ExecuteAsync($"""
            INSERT INTO erp.{k.Line} ({k.No}, line_no, item_code, qty, unit_price, supply_amt, vat_amt, total_amt)
            VALUES (@no, @lineNo, @ItemCode, @Qty, @UnitPrice, @supplyAmt, @vatAmt, @totalAmt)
            """, new { no, lineNo, l.ItemCode, l.Qty, l.UnitPrice, supplyAmt, vatAmt, totalAmt }, tx);
    }
}
