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
}

public sealed class OrderHeader
{
    public string OrderNo { get; init; } = "";
    public string OrderDate { get; init; } = "";
    public string PartnerCode { get; init; } = "";
    public string PartnerName { get; init; } = "";
    public string DueDate { get; init; } = "";
    public string Status { get; init; } = "";
    public DateTime UpdatedAt { get; init; }
    public List<OrderLine> Lines { get; } = [];
}

public sealed record MesDocLine(string ItemCode, int Qty, string? WhCode, string? RefNo);

public sealed record MesDocument(string DocNo, string DocType, string DocDate, List<MesDocLine> Lines, string? Ref);

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


    public async Task<List<OrderHeader>> ListOrdersAsync(OrderKind kind, DateTimeOffset? updatedSince)
    {
        var (h, l, no, date) = Names(kind);
        await using var conn = await db.OpenConnectionAsync();
        var headers = (await conn.QueryAsync<OrderHeader>($"""
            SELECT o.{no} AS order_no, to_char(o.{date}, 'YYYY-MM-DD') AS order_date,
                   o.partner_code, p.partner_name, to_char(o.due_date, 'YYYY-MM-DD') AS due_date,
                   o.status, o.updated_at
            FROM erp.{h} o JOIN erp.partner p ON p.partner_code = o.partner_code
            WHERE @since::timestamptz IS NULL OR o.updated_at > @since
            ORDER BY o.updated_at, o.{no}
            """, new { since = updatedSince })).ToList();
        if (headers.Count == 0) return headers;

        var lines = await conn.QueryAsync<(string OrderNo, short LineNo, string ItemCode, string ItemName, string Unit, int Qty, decimal UnitPrice)>($"""
            SELECT l.{no}, l.line_no, l.item_code, i.item_name, i.unit, l.qty, l.unit_price
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
            });
        return headers;
    }

    public async Task<string?> ValidateAsync(MesDocument doc)
    {
        if (string.IsNullOrWhiteSpace(doc.DocNo)) return "docNo 가 없습니다";
        if (!DocPrefix.ContainsKey(doc.DocType)) return $"지원하지 않는 문서 유형: {doc.DocType}";
        if (doc.Lines is not { Count: > 0 }) return "라인이 없습니다";
        if (doc.DocType != "생산실적" && doc.Lines.Any(x => x.Qty <= 0)) return "수량은 0보다 커야 합니다";
        if (doc.Lines.Any(x => x.Qty == 0)) return "수량 0 라인이 있습니다";

        await using var conn = await db.OpenConnectionAsync();
        var codes = doc.Lines.Select(x => x.ItemCode).Distinct().ToArray();
        var known = (await conn.QueryAsync<string>(
            "SELECT item_code FROM erp.item WHERE item_code = ANY(@codes)", new { codes })).ToHashSet();
        var missing = codes.Where(c => !known.Contains(c)).ToList();
        return missing.Count > 0 ? $"ERP 품목 미등록: {string.Join(", ", missing)}" : null;
    }

    public async Task<(string ErpDocNo, bool Duplicate)> ReceiveAsync(MesDocument doc)
    {
        await using var conn = await db.OpenConnectionAsync();
        var existing = await conn.ExecuteScalarAsync<string?>(
            "SELECT erp_doc_no FROM erp.mes_document WHERE doc_no = @DocNo", new { doc.DocNo });
        if (existing is not null) return (existing, true);

        var erpDocNo = await conn.ExecuteScalarAsync<string>(
            "SELECT @prefix || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('erp.doc_seq')::text, 5, '0')",
            new { prefix = DocPrefix[doc.DocType] });
        var inserted = await conn.ExecuteAsync("""
            INSERT INTO erp.mes_document (doc_no, doc_type, erp_doc_no, payload)
            VALUES (@docNo, @docType, @erpDocNo, @payload::jsonb)
            ON CONFLICT (doc_no) DO NOTHING
            """, new { docNo = doc.DocNo, docType = doc.DocType, erpDocNo, payload = JsonSerializer.Serialize(doc) });
        if (inserted == 0)   // 동시에 같은 문서가 들어온 경우
            return ((await conn.ExecuteScalarAsync<string>(
                "SELECT erp_doc_no FROM erp.mes_document WHERE doc_no = @DocNo", new { doc.DocNo }))!, true);
        return (erpDocNo!, false);
    }

    public async Task<IEnumerable<ReceivedDocument>> ListDocumentsAsync(int limit)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<ReceivedDocument>("""
            SELECT doc_no, doc_type, erp_doc_no, received_at,
                   jsonb_array_length(payload->'Lines') AS line_count,
                   (SELECT COALESCE(sum((x->>'Qty')::int), 0) FROM jsonb_array_elements(payload->'Lines') x) AS total_qty
            FROM erp.mes_document
            ORDER BY received_at DESC
            LIMIT @limit
            """, new { limit });
    }


    private static (string Header, string Line, string No, string Date) Names(OrderKind kind) => kind switch
    {
        OrderKind.Purchase => ("purchase_order", "purchase_order_line", "po_no", "po_date"),
        _ => ("sales_order", "sales_order_line", "so_no", "so_date"),
    };
}
