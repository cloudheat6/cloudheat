using Dapper;
using Npgsql;

namespace Cloudheat.Api;

// ── 조회 모델 ──────────────────────────────────────────────
public sealed class ItemRow
{
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string ItemType { get; init; } = "";
    public string Unit { get; init; } = "";
    public string? DefaultWhCode { get; init; }
    public short? LineId { get; init; }
    public int SafetyQty { get; init; }
    public bool UseYn { get; init; }
    public DateTime? ErpSyncedAt { get; init; }
    public int RoutingCount { get; init; }
    public int BomCount { get; init; }
}

public sealed class PartnerRow
{
    public string PartnerCode { get; init; } = "";
    public string PartnerName { get; init; } = "";
    public string PartnerType { get; init; } = "";
    public DateTime ErpSyncedAt { get; init; }
}

public sealed class CommonCodeRow
{
    public string GroupCode { get; init; } = "";
    public string Code { get; init; } = "";
    public string CodeName { get; init; } = "";
    public short SortNo { get; init; }
    public bool UseYn { get; init; }
    public string Remark { get; init; } = "";
    public DateTime ErpSyncedAt { get; init; }
}

public sealed class CodeGroupRow
{
    public string GroupCode { get; init; } = "";
    public string GroupName { get; init; } = "";
    public string Remark { get; init; } = "";
    public bool UseYn { get; init; }
    public short SortNo { get; init; }
    public DateTime ErpSyncedAt { get; init; }
    public List<CommonCodeRow> Codes { get; } = [];
}

public sealed class ProcessRow
{
    public string ProcessCode { get; init; } = "";
    public string ProcessName { get; init; } = "";
    public short SortNo { get; init; }
    public bool UseYn { get; init; }
    public int UsedBy { get; init; }
}

public sealed class WarehouseRow
{
    public string WhCode { get; init; } = "";
    public string WhName { get; init; } = "";
    public string WhType { get; init; } = "";
    public bool UseYn { get; init; }
    public int StockItems { get; init; }
}

public sealed class LineRow
{
    public short LineId { get; init; }
    public string LineName { get; init; } = "";
    public bool UseYn { get; init; }
    public int UsedBy { get; init; }
}

public sealed class RoutingStep
{
    public short Seq { get; init; }
    public string ProcessCode { get; init; } = "";
    public string ProcessName { get; init; } = "";
    public short? LineId { get; init; }
}

public sealed class BomLine
{
    public string ChildCode { get; init; } = "";
    public string ChildName { get; init; } = "";
    public string ChildType { get; init; } = "";
    public string Unit { get; init; } = "";
    public decimal QtyPer { get; init; }
}

// ── 입력 모델 ──────────────────────────────────────────────
public sealed record ItemUpdate(string? DefaultWhCode, short? LineId, int SafetyQty, bool UseYn);
public sealed record ProcessInput(string? ProcessCode, string ProcessName, short SortNo, bool UseYn = true);
public sealed record WarehouseInput(string? WhCode, string WhName, string WhType, bool UseYn = true);
public sealed record LineInput(short? LineId, string LineName, bool UseYn = true);
public sealed record RoutingInput(string ProcessCode, short? LineId);
public sealed record BomInput(string ChildCode, decimal QtyPer);

/// <summary>검증 실패 · 사용 중 삭제 등 사용자에게 보여줄 오류</summary>
public sealed class MasterException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class MasterRepository(NpgsqlDataSource db)
{
    public static readonly string[] WarehouseTypes = ["원자재", "현장", "제품", "일반"];

    // ── 품목 (ERP 기준 + MES 속성) ─────────────────────────
    public async Task<IEnumerable<ItemRow>> ItemsAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<ItemRow>("""
            SELECT i.item_code, i.item_name, i.item_type, i.unit, i.default_wh_code, i.line_id,
                   i.safety_qty, i.use_yn, i.erp_synced_at,
                   (SELECT count(*) FROM mes.routing r WHERE r.item_code = i.item_code)::int AS routing_count,
                   (SELECT count(*) FROM mes.bom b WHERE b.parent_code = i.item_code)::int  AS bom_count
            FROM mes.item i
            ORDER BY i.item_type DESC, i.item_code
            """);
    }

    public async Task UpdateItemAsync(string code, ItemUpdate u)
    {
        if (u.SafetyQty < 0) throw new MasterException("안전재고는 0 이상이어야 해요");
        await using var conn = await db.OpenConnectionAsync();
        var n = await Run(() => conn.ExecuteAsync("""
            UPDATE mes.item
            SET default_wh_code = NULLIF(@DefaultWhCode, ''), line_id = @LineId,
                safety_qty = @SafetyQty, use_yn = @UseYn, updated_at = now()
            WHERE item_code = @code
            """, new { code, u.DefaultWhCode, u.LineId, u.SafetyQty, u.UseYn }));
        if (n == 0) throw new MasterException("품목을 찾을 수 없어요", 404);
    }

    public async Task<IEnumerable<PartnerRow>> PartnersAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<PartnerRow>(
            "SELECT partner_code, partner_name, partner_type, erp_synced_at FROM mes.partner ORDER BY partner_type, partner_code");
    }

    public async Task<List<CodeGroupRow>> CodeGroupsAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        var groups = (await conn.QueryAsync<CodeGroupRow>(
            "SELECT group_code, group_name, remark, use_yn, sort_no, erp_synced_at FROM mes.code_group ORDER BY sort_no, group_code")).ToList();
        if (groups.Count == 0) return groups;

        var codes = await conn.QueryAsync<CommonCodeRow>(
            "SELECT group_code, code, code_name, sort_no, use_yn, remark, erp_synced_at FROM mes.common_code ORDER BY group_code, sort_no, code");
        var byGroup = groups.ToDictionary(g => g.GroupCode);
        foreach (var c in codes)
            if (byGroup.TryGetValue(c.GroupCode, out var g)) g.Codes.Add(c);
        return groups;
    }

    // ── 공정 ───────────────────────────────────────────────
    public async Task<IEnumerable<ProcessRow>> ProcessesAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<ProcessRow>("""
            SELECT p.process_code, p.process_name, p.sort_no, p.use_yn,
                   (SELECT count(DISTINCT r.item_code) FROM mes.routing r WHERE r.process_code = p.process_code)::int AS used_by
            FROM mes.process p ORDER BY p.sort_no, p.process_code
            """);
    }

    public async Task AddProcessAsync(ProcessInput p)
    {
        var code = Required(p.ProcessCode, "공정 코드", 10);
        var name = Required(p.ProcessName, "공정명", 30);
        await using var conn = await db.OpenConnectionAsync();
        await Run(() => conn.ExecuteAsync(
            "INSERT INTO mes.process (process_code, process_name, sort_no, use_yn) VALUES (@code, @name, @SortNo, @UseYn)",
            new { code, name, p.SortNo, p.UseYn }));
    }

    public async Task UpdateProcessAsync(string code, ProcessInput p)
    {
        var name = Required(p.ProcessName, "공정명", 30);
        await using var conn = await db.OpenConnectionAsync();
        await Found(conn.ExecuteAsync(
            "UPDATE mes.process SET process_name = @name, sort_no = @SortNo, use_yn = @UseYn WHERE process_code = @code",
            new { code, name, p.SortNo, p.UseYn }));
    }

    public Task DeleteProcessAsync(string code) => DeleteAsync("DELETE FROM mes.process WHERE process_code = @code", new { code });

    // ── 창고 ───────────────────────────────────────────────
    public async Task<IEnumerable<WarehouseRow>> WarehousesAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<WarehouseRow>("""
            SELECT w.wh_code, w.wh_name, w.wh_type, w.use_yn,
                   (SELECT count(*) FROM mes.stock s WHERE s.wh_code = w.wh_code AND s.qty <> 0)::int AS stock_items
            FROM mes.warehouse w ORDER BY w.wh_code
            """);
    }

    public async Task AddWarehouseAsync(WarehouseInput w)
    {
        var code = Required(w.WhCode, "창고 코드", 10);
        var name = Required(w.WhName, "창고명", 30);
        await using var conn = await db.OpenConnectionAsync();
        var type = await WhTypeAsync(conn, w.WhType);
        await Run(() => conn.ExecuteAsync(
            "INSERT INTO mes.warehouse (wh_code, wh_name, wh_type, use_yn) VALUES (@code, @name, @type, @UseYn)",
            new { code, name, type, w.UseYn }));
    }

    public async Task UpdateWarehouseAsync(string code, WarehouseInput w)
    {
        var name = Required(w.WhName, "창고명", 30);
        await using var conn = await db.OpenConnectionAsync();
        var type = await WhTypeAsync(conn, w.WhType);
        await Found(conn.ExecuteAsync(
            "UPDATE mes.warehouse SET wh_name = @name, wh_type = @type, use_yn = @UseYn WHERE wh_code = @code",
            new { code, name, type, w.UseYn }));
    }

    public Task DeleteWarehouseAsync(string code) => DeleteAsync("DELETE FROM mes.warehouse WHERE wh_code = @code", new { code });

    // ── 라인 ───────────────────────────────────────────────
    public async Task<IEnumerable<LineRow>> LinesAsync()
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<LineRow>("""
            SELECT l.line_id, l.line_name, l.use_yn,
                   (SELECT count(*) FROM mes.item i WHERE i.line_id = l.line_id)::int AS used_by
            FROM mes.line l ORDER BY l.line_id
            """);
    }

    public async Task AddLineAsync(LineInput l)
    {
        if (l.LineId is not > 0) throw new MasterException("라인 번호는 1 이상의 숫자예요");
        var name = Required(l.LineName, "라인명", 30);
        await using var conn = await db.OpenConnectionAsync();
        await Run(() => conn.ExecuteAsync(
            "INSERT INTO mes.line (line_id, line_name, use_yn) VALUES (@LineId, @name, @UseYn)",
            new { l.LineId, name, l.UseYn }));
    }

    public async Task UpdateLineAsync(short id, LineInput l)
    {
        var name = Required(l.LineName, "라인명", 30);
        await using var conn = await db.OpenConnectionAsync();
        await Found(conn.ExecuteAsync(
            "UPDATE mes.line SET line_name = @name, use_yn = @UseYn WHERE line_id = @id", new { id, name, l.UseYn }));
    }

    public Task DeleteLineAsync(short id) => DeleteAsync("DELETE FROM mes.line WHERE line_id = @id", new { id });

    // ── 라우팅 ─────────────────────────────────────────────
    public async Task<IEnumerable<RoutingStep>> RoutingAsync(string itemCode)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<RoutingStep>("""
            SELECT r.seq, r.process_code, p.process_name, r.line_id
            FROM mes.routing r JOIN mes.process p ON p.process_code = r.process_code
            WHERE r.item_code = @itemCode ORDER BY r.seq
            """, new { itemCode });
    }

    // 통째로 교체: 화면에서 순서를 바꾸고 저장하면 1번부터 다시 매김
    public async Task SaveRoutingAsync(string itemCode, List<RoutingInput> steps)
    {
        if (steps.Count > 30) throw new MasterException("공정은 30개까지 등록할 수 있어요");
        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await EnsureItemAsync(conn, tx, itemCode, "제품");

        var codes = steps.Select(s => s.ProcessCode).Distinct().ToArray();
        var usable = (await conn.QueryAsync<string>(
            "SELECT process_code FROM mes.process WHERE use_yn AND process_code = ANY(@codes)", new { codes }, tx)).ToHashSet();
        var bad = codes.Where(c => !usable.Contains(c)).ToList();
        if (bad.Count > 0) throw new MasterException($"사용할 수 없는 공정: {string.Join(", ", bad)}");

        await conn.ExecuteAsync("DELETE FROM mes.routing WHERE item_code = @itemCode", new { itemCode }, tx);
        for (var i = 0; i < steps.Count; i++)
            await conn.ExecuteAsync(
                "INSERT INTO mes.routing (item_code, seq, process_code, line_id) VALUES (@itemCode, @seq, @ProcessCode, @LineId)",
                new { itemCode, seq = (short)(i + 1), steps[i].ProcessCode, steps[i].LineId }, tx);
        await tx.CommitAsync();
    }

    // ── BOM ────────────────────────────────────────────────
    public async Task<IEnumerable<BomLine>> BomAsync(string parentCode)
    {
        await using var conn = await db.OpenConnectionAsync();
        return await conn.QueryAsync<BomLine>("""
            SELECT b.child_code, i.item_name AS child_name, i.item_type AS child_type, i.unit, b.qty_per
            FROM mes.bom b JOIN mes.item i ON i.item_code = b.child_code
            WHERE b.parent_code = @parentCode ORDER BY b.seq, b.child_code
            """, new { parentCode });
    }

    public async Task SaveBomAsync(string parentCode, List<BomInput> lines)
    {
        if (lines.Count > 100) throw new MasterException("자품목은 100개까지 등록할 수 있어요");
        if (lines.Any(l => l.QtyPer <= 0)) throw new MasterException("소요량은 0보다 커야 해요");
        if (lines.Any(l => decimal.Round(l.QtyPer, 4) != l.QtyPer)) throw new MasterException("소요량은 소수점 4자리까지예요");
        if (lines.Any(l => l.ChildCode == parentCode)) throw new MasterException("자기 자신을 자품목으로 넣을 수 없어요");
        var dup = lines.GroupBy(l => l.ChildCode).FirstOrDefault(g => g.Count() > 1);
        if (dup is not null) throw new MasterException($"같은 자품목이 두 번 있어요: {dup.Key}");

        await using var conn = await db.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await EnsureItemAsync(conn, tx, parentCode, "제품");   // 원자재는 BOM 을 갖지 않음

        var codes = lines.Select(l => l.ChildCode).ToArray();
        var known = (await conn.QueryAsync<string>(
            "SELECT item_code FROM mes.item WHERE item_code = ANY(@codes)", new { codes }, tx)).ToHashSet();
        var missing = codes.Where(c => !known.Contains(c)).ToList();
        if (missing.Count > 0) throw new MasterException($"없는 품목: {string.Join(", ", missing)}");

        // 순환 방지: 자품목의 하위 BOM 어딘가에 모품목이 있으면 거부 (재귀 CTE)
        var cyclic = await conn.ExecuteScalarAsync<bool>("""
            WITH RECURSIVE t AS (
                SELECT b.child_code FROM mes.bom b WHERE b.parent_code = ANY(@codes)
                UNION
                SELECT b.child_code FROM mes.bom b JOIN t ON b.parent_code = t.child_code
            )
            SELECT EXISTS (SELECT 1 FROM t WHERE child_code = @parentCode)
            """, new { codes, parentCode }, tx);
        if (cyclic) throw new MasterException("자품목의 하위 BOM에 이 품목이 들어 있어 순환이 생겨요");

        await conn.ExecuteAsync("DELETE FROM mes.bom WHERE parent_code = @parentCode", new { parentCode }, tx);
        for (var i = 0; i < lines.Count; i++)
            await conn.ExecuteAsync(
                "INSERT INTO mes.bom (parent_code, child_code, qty_per, seq) VALUES (@parentCode, @ChildCode, @QtyPer, @seq)",
                new { parentCode, lines[i].ChildCode, lines[i].QtyPer, seq = (short)(i + 1) }, tx);
        await tx.CommitAsync();
    }

    // ── 공통 ───────────────────────────────────────────────
    private static async Task EnsureItemAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string code, string? type)
    {
        var t = await conn.ExecuteScalarAsync<string?>("SELECT item_type FROM mes.item WHERE item_code = @code", new { code }, tx);
        if (t is null) throw new MasterException("품목을 찾을 수 없어요", 404);
        if (type is not null && t != type) throw new MasterException($"{type} 품목만 등록할 수 있어요");
    }

    private static string Required(string? v, string label, int max)
    {
        var s = v?.Trim() ?? "";
        if (s.Length == 0) throw new MasterException($"{label}을(를) 입력하세요");
        if (s.Length > max) throw new MasterException($"{label}은(는) {max}자까지예요");
        return s;
    }

    // 공통코드 WH_TYPE 에 등록된 창고 구분을 우선 허용 (비어 있으면 기본 목록 사용)
    private static async Task<string> WhTypeAsync(NpgsqlConnection conn, string? t)
    {
        var s = t?.Trim() ?? "";
        var allowed = (await conn.QueryAsync<string>(
            "SELECT code FROM mes.common_code WHERE group_code = 'WH_TYPE' AND use_yn ORDER BY sort_no, code")).ToArray();
        var list = allowed.Length > 0 ? allowed : WarehouseTypes;
        return list.Contains(s) ? s : throw new MasterException($"창고 구분은 {string.Join(" · ", list)} 중 하나예요");
    }

    private static async Task Found(Task<int> update)
    {
        if (await update == 0) throw new MasterException("대상을 찾을 수 없어요", 404);
    }

    private async Task DeleteAsync(string sql, object args)
    {
        await using var conn = await db.OpenConnectionAsync();
        await Found(Run(() => conn.ExecuteAsync(sql, args)));
    }

    // DB 오류를 사용자에게 보여줄 메시지로
    private static async Task<int> Run(Func<Task<int>> action)
    {
        try
        {
            return await action();
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new MasterException("이미 있는 코드예요", 409);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            throw new MasterException("다른 데이터에서 사용 중이라 삭제하거나 바꿀 수 없어요. '사용 안 함'으로 바꾸세요", 409);
        }
    }
}
