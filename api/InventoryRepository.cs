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

// ── 기초재고 ────────────────────────────────────────────────
public sealed class OpeningRow
{
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string ItemType { get; init; } = "";
    public string Unit { get; init; } = "";
    public bool IsDefaultWh { get; init; }
    public int OpeningQty { get; init; }
    public int StockQty { get; init; }
    public int OtherTxCount { get; init; }   // 기초 외 수불 건수. 1건이라도 있으면 수정 불가
    public DateTime? OpenedAt { get; init; }
}

public sealed record OpeningInput(string ItemCode, int Qty);

public sealed class InventoryException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class OpeningRepository(NpgsqlDataSource db)
{
    // 창고 1곳의 품목별 기초재고. 사용 중인 품목 + 이미 기초/재고가 있는 품목
    public async Task<IEnumerable<OpeningRow>> ListAsync(string whCode)
    {
        await using var conn = await db.OpenConnectionAsync();
        await EnsureWarehouseAsync(conn, null, whCode);
        return await conn.QueryAsync<OpeningRow>("""
            SELECT i.item_code, i.item_name, i.item_type, i.unit,
                   (i.default_wh_code = @whCode)              AS is_default_wh,
                   COALESCE(t.opening_qty, 0)::int            AS opening_qty,
                   COALESCE(s.qty, 0)                         AS stock_qty,
                   COALESCE(t.other_tx, 0)::int               AS other_tx_count,
                   t.opened_at
            FROM mes.item i
            LEFT JOIN mes.stock s ON s.item_code = i.item_code AND s.wh_code = @whCode
            LEFT JOIN LATERAL (
                SELECT sum(x.qty) FILTER (WHERE x.tx_type = '기초') AS opening_qty,
                       count(*)   FILTER (WHERE x.tx_type <> '기초') AS other_tx,
                       max(x.tx_at) FILTER (WHERE x.tx_type = '기초') AS opened_at
                FROM mes.stock_tx x
                WHERE x.item_code = i.item_code AND x.wh_code = @whCode
            ) t ON true
            WHERE i.use_yn OR t.opening_qty IS NOT NULL OR s.qty IS NOT NULL
            ORDER BY (i.default_wh_code = @whCode) DESC NULLS LAST, i.item_type DESC, i.item_code
            """, new { whCode });
    }

    // 바뀐 품목만 받아서 차이만큼 '기초' 수불로 반영 (한 트랜잭션).
    // 기초 외 수불(입고 · 생산 · 출고 등)이 생긴 품목은 수정 불가 → 재고조정으로
    public async Task<int> SaveAsync(string whCode, List<OpeningInput> lines)
    {
        if (lines is not { Count: > 0 }) throw new InventoryException("저장할 변경이 없어요");
        if (lines.Count > 500) throw new InventoryException("한 번에 500건까지 저장할 수 있어요");
        if (lines.GroupBy(l => l.ItemCode).Any(g => g.Count() > 1)) throw new InventoryException("같은 품목이 두 번 들어 있어요");
        if (lines.FirstOrDefault(l => l.Qty < 0) is { } neg) throw new InventoryException($"{neg.ItemCode}: 기초재고는 0 이상이어야 해요");
        if (lines.FirstOrDefault(l => l.Qty > 10_000_000) is { } big) throw new InventoryException($"{big.ItemCode}: 수량이 너무 커요");

        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await EnsureWarehouseAsync(conn, tx, whCode);

        var codes = lines.Select(l => l.ItemCode).ToArray();
        // 같은 품목 · 창고를 동시에 저장하지 않게 현재고 행을 먼저 잠금
        await conn.ExecuteAsync("""
            SELECT 1 FROM mes.stock WHERE wh_code = @whCode AND item_code = ANY(@codes) ORDER BY item_code FOR UPDATE
            """, new { whCode, codes }, tx);
        var cur = (await conn.QueryAsync<(string ItemCode, bool UseYn, int Opening, int Other)>("""
            SELECT i.item_code, i.use_yn,
                   COALESCE(sum(x.qty) FILTER (WHERE x.tx_type = '기초'), 0)::int,
                   count(x.tx_id) FILTER (WHERE x.tx_type <> '기초')::int
            FROM mes.item i
            LEFT JOIN mes.stock_tx x ON x.item_code = i.item_code AND x.wh_code = @whCode
            WHERE i.item_code = ANY(@codes)
            GROUP BY i.item_code, i.use_yn
            """, new { whCode, codes }, tx)).ToDictionary(x => x.ItemCode);

        var changed = 0;
        foreach (var l in lines)
        {
            if (!cur.TryGetValue(l.ItemCode, out var c)) throw new InventoryException($"{l.ItemCode}: 품목을 찾을 수 없어요", 404);
            var delta = l.Qty - c.Opening;
            if (delta == 0) continue;
            if (c.Other > 0) throw new InventoryException($"{l.ItemCode}: 이미 입고 · 출고 등 수불이 있어 기초재고를 바꿀 수 없어요. 재고조정을 이용하세요", 409);
            if (!c.UseYn && l.Qty > 0) throw new InventoryException($"{l.ItemCode}: 사용하지 않는 품목이에요");
            await conn.ExecuteAsync(
                "SELECT mes.fn_post_stock('기초', @item, @whCode, @delta, '기초재고', @refNo, @note)",
                new { item = l.ItemCode, whCode, delta, refNo = $"OPEN-{whCode}", note = c.Opening == 0 ? "기초재고 등록" : $"기초재고 수정 {c.Opening:N0} → {l.Qty:N0}" }, tx);
            changed++;
        }
        await tx.CommitAsync();
        return changed;
    }

    private static async Task EnsureWarehouseAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string whCode)
    {
        var ok = await conn.ExecuteScalarAsync<bool?>("SELECT use_yn FROM mes.warehouse WHERE wh_code = @whCode", new { whCode }, tx);
        if (ok is null) throw new InventoryException("창고를 찾을 수 없어요", 404);
        if (ok == false) throw new InventoryException("사용하지 않는 창고예요");
    }
}
