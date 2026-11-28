using System.Text.Json;
using Dapper;
using Npgsql;

namespace Cloudheat.MockErp;

public enum OrderKind { Purchase, Sales }

public sealed class OrderLine
{
    public short LineNo { get; init; }
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string Unit { get; init; } = "";
    public int Qty { get; init; }
    public decimal UnitPrice { get; init; }
    public long SupplyAmt { get; init; }
    public long VatAmt { get; init; }
    public long TotalAmt { get; init; }
}

public sealed class OrderHeader
{
    public string OrderNo { get; init; } = "";
    public string OrderDate { get; init; } = "";
    public string OrderType { get; init; } = "0";
    public string Currency { get; init; } = "KRW";
    public decimal ExchangeRate { get; init; } = 1m;
    public string PartnerCode { get; init; } = "";
    public string PartnerName { get; init; } = "";
    public string DueDate { get; init; } = "";
    public string Status { get; init; } = "";
    public string Remark { get; init; } = "";
    public DateTime UpdatedAt { get; init; }
    public List<OrderLine> Lines { get; } = [];
}

public sealed class ErpCommonCode
{
    public string GroupCode { get; init; } = "";
    public string Code { get; init; } = "";
    public string CodeName { get; init; } = "";
    public short SortNo { get; init; }
    public bool UseYn { get; init; }
    public string Remark { get; init; } = "";
    public DateTime UpdatedAt { get; init; }
}

public sealed class ErpCodeGroup
{
    public string GroupCode { get; init; } = "";
    public string GroupName { get; init; } = "";
    public string Remark { get; init; } = "";
    public bool UseYn { get; init; }
    public short SortNo { get; init; }
    public DateTime UpdatedAt { get; init; }
    public List<ErpCommonCode> Codes { get; } = [];
}

public sealed class ErpItem
{
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string ItemType { get; init; } = "";
    public string Unit { get; init; } = "";
    public DateTime UpdatedAt { get; init; }
}

public sealed class ErpPartner
{
    public string PartnerCode { get; init; } = "";
    public string PartnerName { get; init; } = "";
    public string PartnerType { get; init; } = "";
    public DateTime UpdatedAt { get; init; }
}

public sealed record MesDocLine(
    string ItemCode,
    int Qty,
    string? WhCode = null,
    string? RefNo = null,
    short? RefLineNo = null,
    string? LineType = null,
    int DefectQty = 0);

public sealed record MesDocument(
    string DocNo,
    string DocType,
    string DocDate,
    List<MesDocLine> Lines,
    string? Ref = null,
    string? PartnerCode = null,
    string? Remark = null);

public sealed class ReceivedDocument
{
    public string DocNo { get; init; } = "";
    public string DocType { get; init; } = "";
    public string ErpDocNo { get; init; } = "";
    public DateTime ReceivedAt { get; init; }
    public int LineCount { get; init; }
    public int TotalQty { get; init; }
}

public sealed class ErpStore(NpgsqlDataSource db)
{
    private static readonly Dictionary<string, string> DocPrefix = new()
    {
        ["생산실적"] = "EPR",
        ["입고"] = "EGR",
        ["출고"] = "EGI",
    };

    public async Task<List<ErpCodeGroup>> ListCodeGroupsAsync(DateTimeOffset? updatedSince)
    {
        await using var conn = await db.OpenConnectionAsync();
        var groups = (await conn.QueryAsync<ErpCodeGroup>("""
            SELECT g.group_code, g.group_name, g.remark, g.use_yn, g.sort_no,
                   GREATEST(g.updated_at, COALESCE((SELECT max(c.updated_at) FROM erp.common_code c WHERE c.group_code = g.group_code), g.updated_at)) AS updated_at
            FROM erp.code_group g
            WHERE @since::timestamptz IS NULL
               OR g.updated_at > @since
               OR EXISTS (SELECT 1 FROM erp.common_code c WHERE c.group_code = g.group_code AND c.updated_at > @since)
            ORDER BY g.sort_no, g.group_code
            """, new { since = updatedSince })).ToList();
        if (groups.Count == 0) return groups;

        var codes = await conn.QueryAsync<ErpCommonCode>("""
            SELECT group_code, code, code_name, sort_no, use_yn, remark, updated_at
            FROM erp.common_code
            WHERE group_code = ANY(@gcodes)
            ORDER BY group_code, sort_no, code
            """, new { gcodes = groups.Select(g => g.GroupCode).ToArray() });
        var byGroup = groups.ToDictionary(g => g.GroupCode);
        foreach (var c in codes)
            byGroup[c.GroupCode].Codes.Add(c);
        return groups;
    }

    public async Task<IEnumerable<ErpItem>> ListItemsAsync(DateTimeOffset? updatedSince)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<ErpItem>("""
            SELECT item_code, item_name, item_type, unit, updated_at FROM erp.item
            WHERE @since::timestamptz IS NULL OR updated_at > @since
            ORDER BY updated_at, item_code
            """, new { since = updatedSince });
    }

    public async Task<IEnumerable<ErpPartner>> ListPartnersAsync(DateTimeOffset? updatedSince)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<ErpPartner>("""
            SELECT partner_code, partner_name, partner_type, updated_at FROM erp.partner
            WHERE @since::timestamptz IS NULL OR updated_at > @since
            ORDER BY updated_at, partner_code
            """, new { since = updatedSince });
    }

    public async Task<List<OrderHeader>> ListOrdersAsync(OrderKind kind, DateTimeOffset? updatedSince)
    {
        var (h, l, no, date) = Names(kind);
        await using var conn = await db.OpenConnectionAsync();
        var headers = (await conn.QueryAsync<OrderHeader>($"""
            SELECT o.{no} AS order_no, to_char(o.{date}, 'YYYY-MM-DD') AS order_date,
                   o.order_type, o.currency, o.exchange_rate,
                   o.partner_code, p.partner_name, to_char(o.due_date, 'YYYY-MM-DD') AS due_date,
                   o.status, o.remark, o.updated_at
            FROM erp.{h} o JOIN erp.partner p ON p.partner_code = o.partner_code
            WHERE @since::timestamptz IS NULL OR o.updated_at > @since
            ORDER BY o.updated_at, o.{no}
            """, new { since = updatedSince })).ToList();
        if (headers.Count == 0) return headers;

        var lines = await conn.QueryAsync<LineRow>($"""
            SELECT l.{no} AS order_no, l.line_no, l.item_code, i.item_name, i.unit, l.qty, l.unit_price,
                   l.supply_amt, l.vat_amt, l.total_amt
            FROM erp.{l} l JOIN erp.item i ON i.item_code = l.item_code
            WHERE l.{no} = ANY(@nos)
            ORDER BY l.{no}, l.line_no
            """, new { nos = headers.Select(x => x.OrderNo).ToArray() });
        var byNo = headers.ToDictionary(x => x.OrderNo);
        foreach (var x in lines)
            byNo[x.OrderNo].Lines.Add(new OrderLine
            {
                LineNo = x.LineNo, ItemCode = x.ItemCode, ItemName = x.ItemName,
                Unit = x.Unit, Qty = x.Qty, UnitPrice = x.UnitPrice,
                SupplyAmt = x.SupplyAmt, VatAmt = x.VatAmt, TotalAmt = x.TotalAmt,
            });
        return headers;
    }

    private sealed class LineRow
    {
        public string OrderNo { get; init; } = "";
        public short LineNo { get; init; }
        public string ItemCode { get; init; } = "";
        public string ItemName { get; init; } = "";
        public string Unit { get; init; } = "";
        public int Qty { get; init; }
        public decimal UnitPrice { get; init; }
        public long SupplyAmt { get; init; }
        public long VatAmt { get; init; }
        public long TotalAmt { get; init; }
    }

    public async Task<string?> ValidateAsync(MesDocument doc)
    {
        if (string.IsNullOrWhiteSpace(doc.DocNo)) return "docNo 가 없습니다";
        if (!DocPrefix.ContainsKey(doc.DocType)) return $"지원하지 않는 문서 유형: {doc.DocType}";
        if (!DateOnly.TryParse(doc.DocDate, out _)) return $"문서 일자가 올바르지 않습니다: {doc.DocDate}";
        if (doc.Lines is not { Count: > 0 }) return "라인이 없습니다";
        if (doc.DocType != "생산실적" && doc.Lines.Any(x => x.Qty <= 0)) return "수량은 0보다 커야 합니다";
        if (doc.Lines.Any(x => x.Qty == 0)) return "수량 0 라인이 있습니다";
        if (doc.Lines.Any(x => x.DefectQty < 0)) return "불량 수량은 0 이상이어야 합니다";
        if ((doc.Remark?.Length ?? 0) > 200) return "비고는 200자까지입니다";

        await using var conn = await db.OpenConnectionAsync();
        var codes = doc.Lines.Select(x => x.ItemCode).Distinct().ToArray();
        var known = (await conn.QueryAsync<string>(
            "SELECT item_code FROM erp.item WHERE item_code = ANY(@codes)", new { codes })).ToHashSet();
        var missing = codes.Where(c => !known.Contains(c)).ToList();
        if (missing.Count > 0) return $"ERP 품목 미등록: {string.Join(", ", missing)}";

        if (NullIfBlank(doc.PartnerCode) is { } partnerCode)
        {
            var partnerExists = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM erp.partner WHERE partner_code = @partnerCode)", new { partnerCode });
            if (!partnerExists) return $"ERP 거래처 미등록: {partnerCode}";
        }

        if (doc.DocType is "입고" or "출고")
        {
            var isReceipt = doc.DocType == "입고";
            var (hTable, lTable, noCol, label) = isReceipt
                ? ("purchase_order", "purchase_order_line", "po_no", "발주")
                : ("sales_order", "sales_order_line", "so_no", "수주");

            var headerOrderNo = NullIfBlank(doc.Ref);
            if (headerOrderNo is not null)
            {
                var exists = await conn.ExecuteScalarAsync<bool>(
                    $"SELECT EXISTS (SELECT 1 FROM erp.{hTable} WHERE {noCol} = @no)", new { no = headerOrderNo });
                if (!exists) return $"ERP {label} 없음: {headerOrderNo}";
            }

            foreach (var (line, idx) in doc.Lines.Select((l, i) => (l, i + 1)))
            {
                var lineOrderNo = NullIfBlank(line.RefNo) ?? headerOrderNo;
                if (line.RefLineNo is { } lineNo)
                {
                    if (lineOrderNo is null) return $"{idx}행: {label} 행 번호가 있지만 {label}번호가 없습니다";
                    var orderItem = await conn.ExecuteScalarAsync<string?>(
                        $"SELECT item_code FROM erp.{lTable} WHERE {noCol} = @no AND line_no = @lineNo",
                        new { no = lineOrderNo, lineNo });
                    if (orderItem is null) return $"ERP {label} 행 없음: {lineOrderNo} #{lineNo}";
                    if (orderItem != line.ItemCode)
                        return $"ERP {label} 행 품목 불일치: {lineOrderNo} #{lineNo} ({orderItem} ≠ {line.ItemCode})";
                }
                else if (NullIfBlank(line.RefNo) is { } refOnly && refOnly != headerOrderNo)
                {
                    var exists = await conn.ExecuteScalarAsync<bool>(
                        $"SELECT EXISTS (SELECT 1 FROM erp.{hTable} WHERE {noCol} = @no)", new { no = refOnly });
                    if (!exists) return $"ERP {label} 없음: {refOnly}";
                }
            }
        }

        return null;
    }

    // 수신과 같은 트랜잭션에서 erp.mes_document + 전표 테이블(헤더 · 행)에 함께 저장, doc_no 로 중복 수신 방지
    public async Task<(string ErpDocNo, bool Duplicate)> ReceiveAsync(MesDocument doc)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        // 같은 MES 문서번호가 동시에 들어와도 직렬화해서 한 번만 반영
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext(@DocNo))", new { doc.DocNo }, tx);

        var existing = await conn.ExecuteScalarAsync<string?>(
            "SELECT erp_doc_no FROM erp.mes_document WHERE doc_no = @DocNo", new { doc.DocNo }, tx);
        if (existing is not null) return (existing, true);

        var erpDocNo = (await conn.ExecuteScalarAsync<string>(
            "SELECT @prefix || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('erp.doc_seq')::text, 5, '0')",
            new { prefix = DocPrefix[doc.DocType] }, tx))!;

        await conn.ExecuteAsync("""
            INSERT INTO erp.mes_document (doc_no, doc_type, erp_doc_no, payload)
            VALUES (@docNo, @docType, @erpDocNo, @payload::jsonb)
            """, new { docNo = doc.DocNo, docType = doc.DocType, erpDocNo, payload = JsonSerializer.Serialize(doc) }, tx);

        await InsertVoucherAsync(conn, tx, erpDocNo, doc);

        await tx.CommitAsync();
        return (erpDocNo, false);
    }

    private static async Task InsertVoucherAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string erpDocNo, MesDocument doc)
    {
        var remark = doc.Remark?.Trim() ?? "";
        var headerRef = NullIfBlank(doc.Ref) ?? doc.Lines.Select(l => NullIfBlank(l.RefNo)).FirstOrDefault(x => x is not null);

        switch (doc.DocType)
        {
            case "입고":
            {
                var partnerCode = NullIfBlank(doc.PartnerCode);
                if (partnerCode is null && headerRef is not null)
                    partnerCode = await conn.ExecuteScalarAsync<string?>(
                        "SELECT partner_code FROM erp.purchase_order WHERE po_no = @poNo", new { poNo = headerRef }, tx);

                await conn.ExecuteAsync("""
                    INSERT INTO erp.goods_receipt (erp_doc_no, doc_date, source, mes_doc_no, po_no, partner_code, status, remark)
                    VALUES (@erpDocNo, @docDate::date, 'MES', @mesDocNo, @poNo, @partnerCode, '확정', @remark)
                    """, new { erpDocNo, docDate = doc.DocDate, mesDocNo = doc.DocNo, poNo = headerRef, partnerCode, remark }, tx);

                short lineNo = 0;
                foreach (var l in doc.Lines)
                {
                    var linePoNo = l.RefLineNo is not null ? (NullIfBlank(l.RefNo) ?? headerRef) : null;
                    await conn.ExecuteAsync("""
                        INSERT INTO erp.goods_receipt_line (erp_doc_no, line_no, item_code, qty, wh_code, po_no, po_line_no)
                        VALUES (@erpDocNo, @lineNo, @ItemCode, @Qty, @whCode, @poNo, @poLineNo)
                        """, new
                    {
                        erpDocNo,
                        lineNo = ++lineNo,
                        l.ItemCode,
                        l.Qty,
                        whCode = NullIfBlank(l.WhCode),
                        poNo = linePoNo,
                        poLineNo = l.RefLineNo,
                    }, tx);
                }
                break;
            }

            case "생산실적":
            {
                await conn.ExecuteAsync("""
                    INSERT INTO erp.production_result (erp_doc_no, doc_date, source, mes_doc_no, wo_no, status, remark)
                    VALUES (@erpDocNo, @docDate::date, 'MES', @mesDocNo, @woNo, '확정', @remark)
                    """, new { erpDocNo, docDate = doc.DocDate, mesDocNo = doc.DocNo, woNo = headerRef, remark }, tx);

                short lineNo = 0;
                foreach (var l in doc.Lines)
                {
                    var lineType = l.LineType is "투입" or "생산" ? l.LineType : "생산";
                    await conn.ExecuteAsync("""
                        INSERT INTO erp.production_result_line (erp_doc_no, line_no, line_type, item_code, qty, defect_qty, wh_code, wo_no)
                        VALUES (@erpDocNo, @lineNo, @lineType, @ItemCode, @Qty, @DefectQty, @whCode, @woNo)
                        """, new
                    {
                        erpDocNo,
                        lineNo = ++lineNo,
                        lineType,
                        l.ItemCode,
                        l.Qty,
                        l.DefectQty,
                        whCode = NullIfBlank(l.WhCode),
                        woNo = NullIfBlank(l.RefNo) ?? headerRef,
                    }, tx);
                }
                break;
            }

            case "출고":
            {
                var partnerCode = NullIfBlank(doc.PartnerCode);
                if (partnerCode is null && headerRef is not null)
                    partnerCode = await conn.ExecuteScalarAsync<string?>(
                        "SELECT partner_code FROM erp.sales_order WHERE so_no = @soNo", new { soNo = headerRef }, tx);

                await conn.ExecuteAsync("""
                    INSERT INTO erp.goods_issue (erp_doc_no, doc_date, source, mes_doc_no, so_no, partner_code, status, remark)
                    VALUES (@erpDocNo, @docDate::date, 'MES', @mesDocNo, @soNo, @partnerCode, '확정', @remark)
                    """, new { erpDocNo, docDate = doc.DocDate, mesDocNo = doc.DocNo, soNo = headerRef, partnerCode, remark }, tx);

                short lineNo = 0;
                foreach (var l in doc.Lines)
                {
                    var lineSoNo = l.RefLineNo is not null ? (NullIfBlank(l.RefNo) ?? headerRef) : null;
                    await conn.ExecuteAsync("""
                        INSERT INTO erp.goods_issue_line (erp_doc_no, line_no, item_code, qty, wh_code, so_no, so_line_no)
                        VALUES (@erpDocNo, @lineNo, @ItemCode, @Qty, @whCode, @soNo, @soLineNo)
                        """, new
                    {
                        erpDocNo,
                        lineNo = ++lineNo,
                        l.ItemCode,
                        l.Qty,
                        whCode = NullIfBlank(l.WhCode),
                        soNo = lineSoNo,
                        soLineNo = l.RefLineNo,
                    }, tx);
                }
                break;
            }
        }
    }

    public async Task<IEnumerable<ReceivedDocument>> ListDocumentsAsync(int limit)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<ReceivedDocument>("""
            SELECT doc_no, doc_type, erp_doc_no, received_at, line_count, total_qty
            FROM (
                SELECT r.mes_doc_no AS doc_no, '입고'::varchar AS doc_type, r.erp_doc_no, r.created_at AS received_at,
                       count(l.line_no)::int AS line_count, COALESCE(sum(l.qty), 0)::int AS total_qty
                FROM erp.goods_receipt r
                LEFT JOIN erp.goods_receipt_line l ON l.erp_doc_no = r.erp_doc_no
                WHERE r.source = 'MES'
                GROUP BY r.erp_doc_no
                UNION ALL
                SELECT r.mes_doc_no, '생산실적'::varchar, r.erp_doc_no, r.created_at,
                       count(l.line_no)::int, COALESCE(sum(l.qty), 0)::int
                FROM erp.production_result r
                LEFT JOIN erp.production_result_line l ON l.erp_doc_no = r.erp_doc_no
                WHERE r.source = 'MES'
                GROUP BY r.erp_doc_no
                UNION ALL
                SELECT r.mes_doc_no, '출고'::varchar, r.erp_doc_no, r.created_at,
                       count(l.line_no)::int, COALESCE(sum(l.qty), 0)::int
                FROM erp.goods_issue r
                LEFT JOIN erp.goods_issue_line l ON l.erp_doc_no = r.erp_doc_no
                WHERE r.source = 'MES'
                GROUP BY r.erp_doc_no
            ) d
            ORDER BY received_at DESC, erp_doc_no DESC
            LIMIT @limit
            """, new { limit });
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static (string Header, string Line, string No, string Date) Names(OrderKind kind) => kind switch
    {
        OrderKind.Purchase => ("purchase_order", "purchase_order_line", "po_no", "po_date"),
        _ => ("sales_order", "sales_order_line", "so_no", "so_date"),
    };
}
