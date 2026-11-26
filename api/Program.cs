using System.Threading.RateLimiting;
using Cloudheat.Api;
using Cloudheat.Api.Erp;
using Dapper;
using Npgsql;

// snake_case 컬럼(wo_no) → PascalCase 속성(WoNo) 자동 매핑
DefaultTypeMap.MatchNamesWithUnderscores = true;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default 가 설정되지 않았습니다.");
builder.Services.AddSingleton(new NpgsqlDataSourceBuilder(connectionString).Build());
builder.Services.AddSingleton<WorkOrderRepository>();
builder.Services.AddSingleton<InventoryRepository>();
builder.Services.AddSingleton<IntegrationRepository>();
builder.Services.AddSingleton<MasterRepository>();

// ERP 연동: 클라이언트 · 수신(1분 주기) · 송신(outbox, 3초 주기)
var erpOptions = builder.Configuration.GetSection("Erp").Get<ErpOptions>() ?? new ErpOptions();
builder.Services.AddSingleton(erpOptions);
builder.Services.AddHttpClient<ErpClient>(c =>
{
    c.BaseAddress = new Uri(erpOptions.BaseUrl.TrimEnd('/') + "/");
    c.Timeout = TimeSpan.FromSeconds(erpOptions.TimeoutSeconds);
    c.DefaultRequestHeaders.Add("X-Api-Key", erpOptions.ApiKey);
});
builder.Services.AddSingleton<ErpSyncService>();
builder.Services.AddHostedService<ErpSyncWorker>();
builder.Services.AddHostedService<OutboxWorker>();

// 공개 데모라 쓰기 요청은 IP 당 분당 60회로 제한 (Cloudflare 뒤라 CF-Connecting-IP 사용)
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("writes", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Request.Headers["CF-Connecting-IP"].FirstOrDefault()
            ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

// DB 스키마 적용: schema.sql 은 IF NOT EXISTS / CREATE OR REPLACE 로만 되어 있어 매번 실행해도 안전.
// 실패하면 시작하지 않음 → 배포 헬스체크 실패 → 이전 버전으로 자동 되돌림
await using (var stream = typeof(AppInfo).Assembly.GetManifestResourceStream("schema.sql")!)
using (var reader = new StreamReader(stream))
{
    var sql = await reader.ReadToEndAsync();
    await using var conn = await app.Services.GetRequiredService<NpgsqlDataSource>().OpenConnectionAsync();
    await using var cmd = new NpgsqlCommand(sql, conn);
    await cmd.ExecuteNonQueryAsync();
    app.Logger.LogInformation("DB 스키마 적용 완료 (v{Version})", AppInfo.Version);
}

app.UseRateLimiter();

var api = app.MapGroup("/api");

api.MapGet("/health", async (NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    var dbVersion = await conn.ExecuteScalarAsync<string>("SELECT version()");
    return Results.Ok(new { status = "ok", version = AppInfo.Version, database = dbVersion?.Split(',')[0] });
});

// ── 생산 작업지시 ──────────────────────────────────────────
api.MapGet("/work-orders", async (WorkOrderRepository repo) =>
    Results.Ok(await repo.ListAsync()));

api.MapGet("/work-orders/{id:int}/detail", async (int id, WorkOrderRepository repo) =>
{
    var detail = await repo.DetailAsync(id);
    return detail is null ? Results.NotFound() : Results.Ok(detail);
});

api.MapPatch("/work-orders/{id:int}", async (int id, UpdateWorkOrder body, WorkOrderRepository repo) =>
{
    var result = await repo.UpdateAsync(id, body);
    return result switch
    {
        { NotFound: true } => Results.NotFound(),
        { Error: not null } => Results.BadRequest(new { message = result.Error }),
        _ => Results.Ok(new { row = result.Row, docNo = result.DocNo }),
    };
}).RequireRateLimiting("writes");

// ── 재고 ───────────────────────────────────────────────────
api.MapGet("/inventory/stock", async (InventoryRepository repo) =>
    Results.Ok(await repo.StockAsync()));

api.MapGet("/inventory/transactions", async (int? limit, string? itemCode, InventoryRepository repo) =>
    Results.Ok(await repo.TransactionsAsync(Math.Clamp(limit ?? 500, 1, 2000), itemCode)));

// ── 기준정보 ───────────────────────────────────────────────
var master = api.MapGroup("/master");
master.AddEndpointFilter(async (ctx, next) =>
{
    try { return await next(ctx); }
    catch (MasterException ex) { return Results.Json(new { message = ex.Message }, statusCode: ex.Status); }
});

// 품목 · 거래처: ERP 가 원본 → 조회 + MES 전용 속성만 수정
master.MapGet("/items", async (MasterRepository r) => Results.Ok(await r.ItemsAsync()));
master.MapPut("/items/{code}", async (string code, ItemUpdate body, MasterRepository r) =>
{ await r.UpdateItemAsync(code, body); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapGet("/partners", async (MasterRepository r) => Results.Ok(await r.PartnersAsync()));

// ERP 기준정보 지금 수신 (품목 → 거래처)
master.MapPost("/sync", async (ErpSyncService sync, ErpOptions opt, CancellationToken ct) =>
{
    if (!opt.Enabled) return Results.BadRequest(new { message = "ERP 연동 설정이 없어요" });
    var logs = new List<SyncLog>();
    foreach (var kind in ErpSyncService.MasterKinds)
        if (await sync.SyncAsync(kind, "수동", ct) is { } l) logs.Add(l);
    return Results.Ok(logs);
}).RequireRateLimiting("writes");

// 공정 · 창고 · 라인: MES 관리
master.MapGet("/processes", async (MasterRepository r) => Results.Ok(await r.ProcessesAsync()));
master.MapPost("/processes", async (ProcessInput b, MasterRepository r) =>
{ await r.AddProcessAsync(b); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapPut("/processes/{code}", async (string code, ProcessInput b, MasterRepository r) =>
{ await r.UpdateProcessAsync(code, b); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapDelete("/processes/{code}", async (string code, MasterRepository r) =>
{ await r.DeleteProcessAsync(code); return Results.Ok(); }).RequireRateLimiting("writes");

master.MapGet("/warehouses", async (MasterRepository r) => Results.Ok(await r.WarehousesAsync()));
master.MapPost("/warehouses", async (WarehouseInput b, MasterRepository r) =>
{ await r.AddWarehouseAsync(b); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapPut("/warehouses/{code}", async (string code, WarehouseInput b, MasterRepository r) =>
{ await r.UpdateWarehouseAsync(code, b); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapDelete("/warehouses/{code}", async (string code, MasterRepository r) =>
{ await r.DeleteWarehouseAsync(code); return Results.Ok(); }).RequireRateLimiting("writes");

master.MapGet("/lines", async (MasterRepository r) => Results.Ok(await r.LinesAsync()));
master.MapPost("/lines", async (LineInput b, MasterRepository r) =>
{ await r.AddLineAsync(b); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapPut("/lines/{id:int}", async (short id, LineInput b, MasterRepository r) =>
{ await r.UpdateLineAsync(id, b); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapDelete("/lines/{id:int}", async (short id, MasterRepository r) =>
{ await r.DeleteLineAsync(id); return Results.Ok(); }).RequireRateLimiting("writes");

// 라우팅 · BOM: 품목 단위로 통째로 저장
master.MapGet("/routings/{itemCode}", async (string itemCode, MasterRepository r) => Results.Ok(await r.RoutingAsync(itemCode)));
master.MapPut("/routings/{itemCode}", async (string itemCode, List<RoutingInput> steps, MasterRepository r) =>
{ await r.SaveRoutingAsync(itemCode, steps); return Results.Ok(); }).RequireRateLimiting("writes");
master.MapGet("/bom/{itemCode}", async (string itemCode, MasterRepository r) => Results.Ok(await r.BomAsync(itemCode)));
master.MapPut("/bom/{itemCode}", async (string itemCode, List<BomInput> lines, MasterRepository r) =>
{ await r.SaveBomAsync(itemCode, lines); return Results.Ok(); }).RequireRateLimiting("writes");

// ── ERP 에서 받은 발주 · 수주 ───────────────────────────────
api.MapGet("/orders/purchase", async (IntegrationRepository repo) => Results.Ok(await repo.OrdersAsync("발주")));
api.MapGet("/orders/sales", async (IntegrationRepository repo) => Results.Ok(await repo.OrdersAsync("주문")));

// ── ERP 연동 모니터링 ──────────────────────────────────────
var integ = api.MapGroup("/integration");

integ.MapGet("/summary", async (IntegrationRepository repo, ErpClient erp, CancellationToken ct) =>
{
    var summary = await repo.SummaryAsync();
    var erpUp = await erp.PingAsync(ct);
    return Results.Ok(new { summary, erpOnline = erpUp });
});

integ.MapGet("/outbox", async (int? limit, IntegrationRepository repo) =>
    Results.Ok(await repo.OutboxAsync(Math.Clamp(limit ?? 200, 1, 1000))));

integ.MapPost("/outbox/{id:long}/retry", async (long id, IntegrationRepository repo) =>
    await repo.RetryAsync(id) ? Results.Ok() : Results.BadRequest(new { message = "실패 상태인 문서만 재전송할 수 있어요" }))
    .RequireRateLimiting("writes");

integ.MapPost("/outbox/retry-failed", async (IntegrationRepository repo) =>
    Results.Ok(new { count = await repo.RetryAllFailedAsync() }))
    .RequireRateLimiting("writes");

integ.MapGet("/sync-log", async (int? limit, IntegrationRepository repo) =>
    Results.Ok(await repo.SyncLogAsync(Math.Clamp(limit ?? 100, 1, 500))));

// 지금 수신 (발주 · 주문). full=true 면 처음부터 다시 받음
integ.MapPost("/sync", async (bool? full, ErpSyncService sync, IntegrationRepository repo, ErpOptions opt, CancellationToken ct) =>
{
    if (!opt.Enabled) return Results.BadRequest(new { message = "ERP 연동 설정이 없어요" });
    if (full == true) await repo.ResetCursorAsync();
    var logs = new List<SyncLog>();
    foreach (var kind in ErpSyncService.Kinds)
        if (await sync.SyncAsync(kind, "수동", ct) is { } l) logs.Add(l);
    return Results.Ok(logs);
}).RequireRateLimiting("writes");

// ERP 쪽에서 실제로 받은 문서 (상대 시스템 확인용)
integ.MapGet("/erp/documents", async (ErpClient erp, CancellationToken ct) =>
{
    try { return Results.Ok(await erp.GetDocumentsAsync(100, ct)); }
    catch (ErpException ex) { return Results.Json(new { message = ex.Message }, statusCode: 502); }
});

app.Run();
