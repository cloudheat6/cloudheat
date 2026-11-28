using Dapper;
using Npgsql;

namespace Cloudheat.Api;

public sealed class WorkOrderRepository(NpgsqlDataSource db)
{
    private const string SelectColumns = """
        SELECT wo_id, wo_no, to_char(wo_date, 'YYYY-MM-DD') AS wo_date, to_char(due_date, 'YYYY-MM-DD') AS due_date,
               line_id, line_name, item_code, item_name, unit, worker_id, worker_name,
               so_no, wo_status, plan_qty, prod_qty, defect_qty, remark, status, updated_at
        FROM mes.v_work_order
        """;

    public async Task<IEnumerable<WorkOrderRow>> ListAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<WorkOrderRow>(SelectColumns + " ORDER BY wo_date DESC, wo_id DESC");
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

    // 새 작업지시 등록
    public async Task<UpdateResult> CreateAsync(SaveWorkOrder input)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var (error, woDate, dueDate, lineId, soNo, remark) = await ValidateHeaderAsync(conn, tx, input, curProdQty: 0);
        if (error is not null) return new UpdateResult(Error: error);

        var prefix = $"WO-{woDate:yyMM}-";
        await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext(@prefix))", new { prefix }, tx);
        var last = await conn.ExecuteScalarAsync<int?>("""
            SELECT max(substring(wo_no FROM '\d+$')::int) FROM mes.work_order WHERE wo_no LIKE @like
            """, new { like = prefix + "%" }, tx);
        var woNo = $"{prefix}{(last ?? 0) + 1:D4}";

        var woId = await conn.ExecuteScalarAsync<int>("""
            INSERT INTO mes.work_order (wo_no, wo_date, due_date, item_code, line_id, worker_id, plan_qty, so_no, wo_status, remark, updated_at)
            VALUES (@woNo, @woDate::date, @dueDate::date, @ItemCode, @lineId, @WorkerId, @PlanQty, @soNo, '확정', @remark, now())
            RETURNING wo_id
            """, new
        {
            woNo,
            woDate = woDate.ToString("yyyy-MM-dd"),
            dueDate = dueDate.ToString("yyyy-MM-dd"),
            input.ItemCode,
            lineId,
            input.WorkerId,
            input.PlanQty,
            soNo,
            remark,
        }, tx);

        // 불량 유형 분배 함수(fn_wo_defects)가 새 작업지시에서도 동작하도록 라인 기본 불량 가중치 생성
        if (lineId is not null)
        {
            await conn.ExecuteAsync("""
                INSERT INTO mes.wo_defect_weight (wo_id, defect_type_id, weight)
                SELECT @woId, defect_type_id, 1
                FROM mes.defect_type
                WHERE line_id = @lineId
                ON CONFLICT DO NOTHING
                """, new { woId, lineId }, tx);
        }

        var row = await conn.QuerySingleAsync<WorkOrderRow>(SelectColumns + " WHERE wo_id = @id", new { id = woId }, tx);
        await tx.CommitAsync();
        return new UpdateResult(row);
    }

    // 작업지시 헤더 수정 (확정 상태만, 이미 생산된 경우 품목 변경 불가 · 계획수량 >= 실적수량)
    public async Task<UpdateResult> UpdateHeaderAsync(int id, SaveWorkOrder input)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var cur = await conn.QuerySingleOrDefaultAsync<(string ItemCode, int ProdQty, string WoStatus)>(
            "SELECT item_code, prod_qty, wo_status FROM mes.work_order WHERE wo_id = @id FOR UPDATE",
            new { id }, tx);
        if (cur == default) return new UpdateResult(NotFound: true);
        if (cur.WoStatus != "확정") return new UpdateResult(Error: $"{cur.WoStatus} 상태인 작업지시는 수정할 수 없어요");
        if (cur.ProdQty > 0 && input.ItemCode != cur.ItemCode)
            return new UpdateResult(Error: "이미 생산실적이 등록된 작업지시는 품목을 바꿀 수 없어요");

        var (error, woDate, dueDate, lineId, soNo, remark) = await ValidateHeaderAsync(conn, tx, input, cur.ProdQty);
        if (error is not null) return new UpdateResult(Error: error);

        await conn.ExecuteAsync("""
            UPDATE mes.work_order
            SET wo_date = @woDate::date, due_date = @dueDate::date, item_code = @ItemCode, line_id = @lineId,
                worker_id = @WorkerId, plan_qty = @PlanQty, so_no = @soNo, remark = @remark, updated_at = now()
            WHERE wo_id = @id
            """, new
        {
            id,
            woDate = woDate.ToString("yyyy-MM-dd"),
            dueDate = dueDate.ToString("yyyy-MM-dd"),
            input.ItemCode,
            lineId,
            input.WorkerId,
            input.PlanQty,
            soNo,
            remark,
        }, tx);

        if (lineId is not null)
        {
            await conn.ExecuteAsync("""
                INSERT INTO mes.wo_defect_weight (wo_id, defect_type_id, weight)
                SELECT @woId, defect_type_id, 1
                FROM mes.defect_type
                WHERE line_id = @lineId
                ON CONFLICT DO NOTHING
                """, new { woId = id, lineId }, tx);
        }

        var row = await conn.QuerySingleAsync<WorkOrderRow>(SelectColumns + " WHERE wo_id = @id", new { id }, tx);
        await tx.CommitAsync();
        return new UpdateResult(row);
    }

    // 작업지시 취소 (생산실적이 없는 경우만 취소 가능)
    public async Task<UpdateResult> CancelAsync(int id)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        var cur = await conn.QuerySingleOrDefaultAsync<(int ProdQty, string WoStatus)>(
            "SELECT prod_qty, wo_status FROM mes.work_order WHERE wo_id = @id FOR UPDATE",
            new { id }, tx);
        if (cur == default) return new UpdateResult(NotFound: true);
        if (cur.WoStatus == "취소") return new UpdateResult(Error: "이미 취소된 작업지시예요");
        if (cur.ProdQty > 0) return new UpdateResult(Error: "생산실적이 등록된 작업지시는 취소할 수 없어요");

        await conn.ExecuteAsync(
            "UPDATE mes.work_order SET wo_status = '취소', updated_at = now() WHERE wo_id = @id",
            new { id }, tx);

        var row = await conn.QuerySingleAsync<WorkOrderRow>(SelectColumns + " WHERE wo_id = @id", new { id }, tx);
        await tx.CommitAsync();
        return new UpdateResult(row);
    }

    public async Task<UpdateResult> UpdateAsync(int id, UpdateWorkOrder body)
    {
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        // 동시 수정 대비 행 잠금 (MSSQL: WITH (UPDLOCK, ROWLOCK))
        var cur = await conn.QuerySingleOrDefaultAsync<(int PlanQty, int ProdQty, int DefectQty, string Remark, string WoNo, string ItemCode, string WoStatus)>(
            "SELECT plan_qty, prod_qty, defect_qty, remark, wo_no, item_code, wo_status FROM mes.work_order WHERE wo_id = @id FOR UPDATE",
            new { id }, tx);
        if (cur == default) return new UpdateResult(NotFound: true);
        if (cur.WoStatus != "확정") return new UpdateResult(Error: $"{cur.WoStatus} 상태인 작업지시는 수정할 수 없어요");

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

    private static async Task<(string? Error, DateOnly WoDate, DateOnly DueDate, short? LineId, string? SoNo, string Remark)> ValidateHeaderAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, SaveWorkOrder input, int curProdQty)
    {
        if (!DateOnly.TryParse(input.WoDate, out var woDate)) return ("지시일을 확인하세요", default, default, null, null, "");
        if (!DateOnly.TryParse(input.DueDate, out var dueDate)) return ("납기일을 확인하세요", default, default, null, null, "");
        if (dueDate < woDate) return ("납기일은 지시일 이후여야 해요", default, default, null, null, "");
        if (input.PlanQty <= 0 || input.PlanQty > 1_000_000) return ("지시수량은 1 ~ 1,000,000 사이로 입력하세요", default, default, null, null, "");
        if (input.PlanQty < curProdQty) return ($"지시수량은 이미 등록된 실적({curProdQty:N0})보다 적을 수 없어요", default, default, null, null, "");

        var remark = input.Remark?.Trim() ?? "";
        if (remark.Length > 200) return ("비고는 200자까지 입력할 수 있어요", default, default, null, null, "");

        var item = await conn.QuerySingleOrDefaultAsync<(string ItemType, bool UseYn, short? LineId)>(
            "SELECT item_type, use_yn, line_id FROM mes.item WHERE item_code = @ItemCode", new { input.ItemCode }, tx);
        if (item == default) return ("품목을 선택하세요", default, default, null, null, "");
        if (item.ItemType != "제품") return ("제품 품목만 작업지시를 등록할 수 있어요", default, default, null, null, "");
        if (!item.UseYn && curProdQty == 0) return ("사용 중지된 품목이에요", default, default, null, null, "");

        var lineId = input.LineId ?? item.LineId;
        if (lineId is not null)
        {
            var lineOk = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM mes.line WHERE line_id = @lineId)", new { lineId }, tx);
            if (!lineOk) return ("생산 라인을 확인하세요", default, default, null, null, "");
        }

        var workerOk = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS (SELECT 1 FROM mes.worker WHERE worker_id = @WorkerId)", new { input.WorkerId }, tx);
        if (!workerOk) return ("담당 작업자를 선택하세요", default, default, null, null, "");

        var soNo = string.IsNullOrWhiteSpace(input.SoNo) ? null : input.SoNo.Trim();
        if (soNo is not null)
        {
            var soOk = await conn.ExecuteScalarAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM mes.sales_order WHERE so_no = @soNo)", new { soNo }, tx);
            if (!soOk) return ($"수신된 주문번호를 찾을 수 없어요: {soNo}", default, default, null, null, "");
        }

        return (null, woDate, dueDate, lineId, soNo, remark);
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
