using Dapper;
using Npgsql;

namespace Cloudheat.Api.Erp;

public sealed class OutboxRow
{
    public long OutboxId { get; init; }
    public string DocType { get; init; } = "";
    public string DocNo { get; init; } = "";
    public string Status { get; init; } = "";
    public int Attempts { get; init; }
    public string? LastError { get; init; }
    public string? ErpDocNo { get; init; }
    public DateTime NextAttemptAt { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? SentAt { get; init; }
    public string Payload { get; init; } = "";
}

public sealed class OrderLineRow
{
    public string OrderNo { get; init; } = "";
    public string OrderDate { get; init; } = "";
    public string PartnerName { get; init; } = "";
    public string DueDate { get; init; } = "";
    public string ErpStatus { get; init; } = "";
    public DateTime SyncedAt { get; init; }
    public short LineNo { get; init; }
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string Unit { get; init; } = "";
    public int OrderQty { get; init; }
    public int DoneQty { get; init; }
}

public sealed class IntegrationRepository(NpgsqlDataSource db)
{
    public async Task<object> SummaryAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        var counts = (await conn.QueryAsync<(string Status, int Count)>(
            "SELECT status, count(*)::int FROM mes.erp_outbox GROUP BY status")).ToDictionary(x => x.Status, x => x.Count);
        var lastSync = await conn.QueryAsync<SyncLog>("""
            SELECT DISTINCT ON (kind) sync_id, kind, trigger_by, started_at, finished_at, fetched, applied, skipped, status, message
            FROM mes.erp_sync_log ORDER BY kind, started_at DESC
            """);
        var orders = await conn.QuerySingleAsync<(int Po, int So)>(
            "SELECT (SELECT count(*) FROM mes.purchase_order)::int, (SELECT count(*) FROM mes.sales_order)::int");
        return new
        {
            outbox = new
            {
                pending = counts.GetValueOrDefault("대기"),
                success = counts.GetValueOrDefault("성공"),
                failed = counts.GetValueOrDefault("실패"),
            },
            lastSync,
            receivedOrders = new { purchase = orders.Po, sales = orders.So },
        };
    }

    public async Task<IEnumerable<OutboxRow>> OutboxAsync(int limit)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<OutboxRow>("""
            SELECT outbox_id, doc_type, doc_no, status, attempts, last_error, erp_doc_no,
                   next_attempt_at, created_at, sent_at, payload::text AS payload
            FROM mes.erp_outbox ORDER BY outbox_id DESC LIMIT @limit
            """, new { limit });
    }

    public async Task<bool> RetryAsync(long id)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.ExecuteAsync("""
            UPDATE mes.erp_outbox SET status = '대기', attempts = 0, next_attempt_at = now()
            WHERE outbox_id = @id AND status = '실패'
            """, new { id }) == 1;
    }

    public async Task<int> RetryAllFailedAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.ExecuteAsync(
            "UPDATE mes.erp_outbox SET status = '대기', attempts = 0, next_attempt_at = now() WHERE status = '실패'");
    }

    public async Task<IEnumerable<SyncLog>> SyncLogAsync(int limit)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<SyncLog>("""
            SELECT sync_id, kind, trigger_by, started_at, finished_at, fetched, applied, skipped, status, message
            FROM mes.erp_sync_log ORDER BY sync_id DESC LIMIT @limit
            """, new { limit });
    }

    public async Task ResetCursorAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        await conn.ExecuteAsync("DELETE FROM mes.erp_sync_cursor");
    }

    public async Task<IEnumerable<OrderLineRow>> OrdersAsync(string kind)
    {
        var (h, l, no, date, partner, done) = kind == "발주"
            ? ("purchase_order", "purchase_order_line", "po_no", "po_date", "vendor_name", "received_qty")
            : ("sales_order", "sales_order_line", "so_no", "so_date", "customer_name", "shipped_qty");
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<OrderLineRow>($"""
            SELECT o.{no} AS order_no, to_char(o.{date}, 'YYYY-MM-DD') AS order_date, o.{partner} AS partner_name,
                   to_char(o.due_date, 'YYYY-MM-DD') AS due_date, o.erp_status, o.synced_at,
                   l.line_no, l.item_code, i.item_name, i.unit, l.order_qty, l.{done} AS done_qty
            FROM mes.{h} o
            JOIN mes.{l} l ON l.{no} = o.{no}
            JOIN mes.item i ON i.item_code = l.item_code
            ORDER BY o.{date} DESC, o.{no} DESC, l.line_no
            """);
    }
}
