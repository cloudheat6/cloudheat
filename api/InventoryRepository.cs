using Dapper;
using Npgsql;

namespace Cloudheat.Api;

public sealed class StockRow
{
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string ItemType { get; init; } = "";
    public string Unit { get; init; } = "";
    public string WhCode { get; init; } = "";
    public string WhName { get; init; } = "";
    public int Qty { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public sealed class StockTxRow
{
    public long TxId { get; init; }
    public DateTime TxAt { get; init; }
    public string TxType { get; init; } = "";
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string Unit { get; init; } = "";
    public string WhCode { get; init; } = "";
    public string WhName { get; init; } = "";
    public int Qty { get; init; }
    public string? RefType { get; init; }
    public string? RefNo { get; init; }
    public string Note { get; init; } = "";
}

public sealed class InventoryRepository(NpgsqlDataSource db)
{
    public async Task<IEnumerable<StockRow>> StockAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<StockRow>("""
            SELECT s.item_code, i.item_name, i.item_type, i.unit, s.wh_code, w.wh_name, s.qty, s.updated_at
            FROM mes.stock s
            JOIN mes.item i      ON i.item_code = s.item_code
            JOIN mes.warehouse w ON w.wh_code   = s.wh_code
            ORDER BY i.item_type DESC, s.item_code, s.wh_code
            """);
    }

    public async Task<IEnumerable<StockTxRow>> TransactionsAsync(int limit, string? itemCode)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<StockTxRow>("""
            SELECT t.tx_id, t.tx_at, t.tx_type, t.item_code, i.item_name, i.unit, t.wh_code, w.wh_name,
                   t.qty, t.ref_type, t.ref_no, t.note
            FROM mes.stock_tx t
            JOIN mes.item i      ON i.item_code = t.item_code
            JOIN mes.warehouse w ON w.wh_code   = t.wh_code
            WHERE @itemCode::varchar IS NULL OR t.item_code = @itemCode
            ORDER BY t.tx_id DESC
            LIMIT @limit
            """, new { limit, itemCode });
    }
}
