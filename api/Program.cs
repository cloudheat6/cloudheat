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
