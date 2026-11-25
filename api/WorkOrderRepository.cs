using Dapper;
using Npgsql;

namespace Cloudheat.Api;

public sealed class WorkOrderRepository(NpgsqlDataSource db)
{
    private const string SelectColumns = """
        SELECT wo_id, wo_no, to_char(due_date, 'YYYY-MM-DD') AS due_date,
               line_id, line_name, item_code, item_name, worker_name,
               plan_qty, prod_qty, defect_qty, remark, status, updated_at
        FROM mes.v_work_order
        """;

    public async Task<IEnumerable<WorkOrderRow>> ListAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<WorkOrderRow>(SelectColumns + " ORDER BY due_date, wo_id");
    }

    public async Task<WorkOrderDetail?> DetailAsync(int id)
    {
        await using var conn = await db.OpenConnectionAsync();
        var exists = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS (SELECT 1 FROM mes.work_order WHERE wo_id = @id)", new { id });
        if (!exists) return null;

        var process = await conn.QueryAsync<ProcessStep>(
            "SELECT seq, step_name, in_qty, out_qty, loss_qty FROM mes.fn_wo_process(@id)", new { id });
        var defects = await conn.QueryAsync<DefectCount>(
            "SELECT defect_name, qty FROM mes.fn_wo_defects(@id)", new { id });
        return new WorkOrderDetail(process, defects);
    }

    public async Task<UpdateResult> UpdateAsync(int id, UpdateWorkOrder body)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        // 동시 수정 대비 행 잠금 (MSSQL: WITH (UPDLOCK, ROWLOCK))
        var cur = await conn.QuerySingleOrDefaultAsync<(int PlanQty, int ProdQty, int DefectQty, string Remark, string WoNo, string ItemCode)>(
            "SELECT plan_qty, prod_qty, defect_qty, remark, wo_no, item_code FROM mes.work_order WHERE wo_id = @id FOR UPDATE",
            new { id }, tx);
        if (cur == default) return new UpdateResult(NotFound: true);

        var prod = body.ProdQty ?? cur.ProdQty;
        var defect = body.DefectQty ?? cur.DefectQty;
        var remark = (body.Remark ?? cur.Remark).Trim();

        var error = Validate(cur.PlanQty, prod, defect, remark);
        if (error is not null) return new UpdateResult(Error: error);

        try
        {
            await conn.ExecuteAsync("""
                UPDATE mes.work_order
                SET prod_qty = @prod, defect_qty = @defect, remark = @remark, updated_at = now()
                WHERE wo_id = @id
                """, new { id, prod, defect, remark }, tx);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.CheckViolation)
        {
            // 앱 검증을 통과했더라도 DB CHECK 제약이 최종 방어선
            return new UpdateResult(Error: $"DB 제약 조건 위반: {ex.ConstraintName}");
        }

        // 양품 수량이 바뀌면: 제품창고 재고 반영 + ERP 생산실적 송신 대기열 등록 (같은 트랜잭션)
        string? docNo = null;
        var goodDelta = (prod - defect) - (cur.ProdQty - cur.DefectQty);
        if (goodDelta != 0)
        {
            try
            {
                docNo = await PostProductionAsync(conn, tx, cur.WoNo, cur.ItemCode, goodDelta);
            }
            catch (PostgresException ex) when (ex.SqlState == "P0001")
            {
                return new UpdateResult(Error: $"{ex.MessageText} — 이미 출고된 수량보다 적게 줄일 수 없어요");
            }
        }

        var row = await conn.QuerySingleAsync<WorkOrderRow>(SelectColumns + " WHERE wo_id = @id", new { id }, tx);
        await tx.CommitAsync();
        return new UpdateResult(row, DocNo: docNo);
    }

    private static async Task<string> PostProductionAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string woNo, string itemCode, int goodDelta)
    {
        var docNo = await conn.ExecuteScalarAsync<string>(
            "SELECT 'PR-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('mes.doc_seq')::text, 5, '0')",
            transaction: tx);
        await conn.ExecuteAsync(
            "SELECT mes.fn_post_stock('생산입고', @itemCode, 'WH-FG', @goodDelta, '생산실적', @docNo, @note)",
            new { itemCode, goodDelta, docNo, note = $"{woNo} 실적 {(goodDelta > 0 ? "+" : "")}{goodDelta}" }, tx);

        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            docNo,
            docType = "생산실적",
            docDate = DateTime.Now.ToString("yyyy-MM-dd"),
            @ref = woNo,
            lines = new[] { new { itemCode, qty = goodDelta, whCode = "WH-FG", refNo = woNo } },
        });
        await conn.ExecuteAsync(
            "INSERT INTO mes.erp_outbox (doc_type, doc_no, payload) VALUES ('생산실적', @docNo, @payload::jsonb)",
            new { docNo, payload }, tx);
        return docNo!;
    }

    private static string? Validate(int plan, int prod, int defect, string remark)
    {
        if (prod < 0 || defect < 0) return "0 이상의 정수만 입력할 수 있어요";
        if (prod > plan * 1.2) return $"실적은 계획({plan:N0})의 120%를 넘을 수 없어요";
        if (defect > prod) return $"불량은 실적 수량({prod:N0})보다 클 수 없어요";
        if (remark.Length > 200) return "비고는 200자까지 입력할 수 있어요";
        return null;
    }
}
