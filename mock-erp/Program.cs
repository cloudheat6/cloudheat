// 가상 ERP 서버 — MES 연동 데모용
// 실제 더존 Amaranth 10 / iCUBE 규격이 아닌, 연동 패턴을 보여주기 위한 범용 API 입니다.
using Cloudheat.MockErp;
using Dapper;
using Npgsql;
using System.Threading.RateLimiting;

DefaultTypeMap.MatchNamesWithUnderscores = true;

var builder = WebApplication.CreateBuilder(args);
var cs = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default 가 설정되지 않았습니다.");
var options = builder.Configuration.GetSection("Erp").Get<ErpOptions>() ?? new ErpOptions();
if (string.IsNullOrWhiteSpace(options.ApiKey)) throw new InvalidOperationException("Erp:ApiKey 가 설정되지 않았습니다.");

builder.Services.AddSingleton(new NpgsqlDataSourceBuilder(cs).Build());
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<ErpStore>();
builder.Services.AddSingleton<ErpUiStore>();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("writes", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Request.Headers["CF-Connecting-IP"].FirstOrDefault()
            ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

// erp 스키마 적용 (멱등). 실패하면 시작하지 않음 → 배포 헬스체크가 이전 버전으로 되돌림
await using (var stream = typeof(AppInfo).Assembly.GetManifestResourceStream("schema.sql")!)
using (var reader = new StreamReader(stream))
{
    await using var conn = await app.Services.GetRequiredService<NpgsqlDataSource>().OpenConnectionAsync();
    await using var cmd = new NpgsqlCommand(await reader.ReadToEndAsync(), conn);
    await cmd.ExecuteNonQueryAsync();
}

app.UseRateLimiter();

app.MapGet("/erp/health", async (NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    await conn.ExecuteScalarAsync<int>("SELECT 1");
    return Results.Ok(new { status = "ok", system = "Mock ERP", version = AppInfo.Version, failureRate = options.FailureRate, slowRate = options.SlowRate });
});

var v1 = app.MapGroup("/erp/v1");

// 1) API 키 인증  2) 가상 장애 주입 (일시 장애 503 · 응답 지연)
v1.AddEndpointFilter(async (ctx, next) =>
{
    var http = ctx.HttpContext;
    if (http.Request.Headers["X-Api-Key"] != options.ApiKey)
        return Results.Json(new { message = "인증 실패: API 키가 올바르지 않습니다" }, statusCode: 401);

    var roll = Random.Shared.NextDouble();
    if (roll < options.FailureRate)
        return Results.Json(new { message = "ERP 서버 일시 장애 (가상)" }, statusCode: 503);
    if (roll < options.FailureRate + options.SlowRate)
        await Task.Delay(TimeSpan.FromSeconds(8), http.RequestAborted);   // MES 타임아웃(5초) 유도
    return await next(ctx);
});

// 기준정보: 관리내역(공통코드) · 품목 · 거래처 (ERP 가 원본)
v1.MapGet("/codes", async (DateTimeOffset? updatedSince, ErpStore store) =>
    Results.Ok(await store.ListCodeGroupsAsync(updatedSince?.ToUniversalTime())));

v1.MapGet("/items", async (DateTimeOffset? updatedSince, ErpStore store) =>
    Results.Ok(await store.ListItemsAsync(updatedSince?.ToUniversalTime())));

v1.MapGet("/partners", async (DateTimeOffset? updatedSince, ErpStore store) =>
    Results.Ok(await store.ListPartnersAsync(updatedSince?.ToUniversalTime())));

v1.MapGet("/purchase-orders", async (DateTimeOffset? updatedSince, ErpStore store) =>
    Results.Ok(await store.ListOrdersAsync(OrderKind.Purchase, updatedSince?.ToUniversalTime())));

v1.MapGet("/sales-orders", async (DateTimeOffset? updatedSince, ErpStore store) =>
    Results.Ok(await store.ListOrdersAsync(OrderKind.Sales, updatedSince?.ToUniversalTime())));

// MES 문서 수신 (생산실적 · 입고 · 출고). docNo 기준 멱등 처리
v1.MapPost("/documents", async (MesDocument doc, ErpStore store) =>
{
    var error = await store.ValidateAsync(doc);
    if (error is not null) return Results.Json(new { message = error }, statusCode: 422);

    var (erpDocNo, duplicate) = await store.ReceiveAsync(doc);
    return Results.Json(new { erpDocNo, duplicate }, statusCode: duplicate ? 200 : 201);
});

v1.MapGet("/documents", async (int? limit, ErpStore store) =>
    Results.Ok(await store.ListDocumentsAsync(Math.Clamp(limit ?? 50, 1, 200))));

// ── ERP 화면(erp.cloudheat.kr)용 API ─────────────────────────
// API 키 · 가상 장애 없음. 공개 데모라 쓰기 요청은 IP 당 분당 60회로 제한
var ui = app.MapGroup("/erp/ui");
ui.AddEndpointFilter(async (ctx, next) =>
{
    try { return await next(ctx); }
    catch (UiException ex) { return Results.Json(new { message = ex.Message }, statusCode: ex.Status); }
    catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ForeignKeyViolation)
    { return Results.Json(new { message = "다른 전표나 데이터에서 사용 중이라 삭제하거나 바꿀 수 없어요" }, statusCode: 409); }
    catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
    { return Results.Json(new { message = "이미 등록된 코드예요" }, statusCode: 409); }
    catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.CheckViolation)
    { return Results.Json(new { message = $"입력값 범위를 확인하세요 ({ex.ConstraintName})" }, statusCode: 400); }
});
ui.MapGet("/health", () => Results.Ok(new { status = "ok", version = AppInfo.Version }));
ui.MapGet("/codes", async (ErpUiStore s) => Results.Ok(await s.CodesAsync()));
ui.MapPost("/codes/groups", async (CodeGroupInput body, ErpUiStore s) =>
{ await s.CreateCodeGroupAsync(body); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapPut("/codes/groups/{groupCode}", async (string groupCode, CodeGroupInput body, ErpUiStore s) =>
{ await s.UpdateCodeGroupAsync(groupCode, body); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapPost("/codes/{groupCode}", async (string groupCode, CommonCodeInput body, ErpUiStore s) =>
{ await s.CreateCodeAsync(groupCode, body); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapPut("/codes/{groupCode}/{*code}", async (string groupCode, string code, CommonCodeInput body, ErpUiStore s) =>
{ await s.UpdateCodeAsync(groupCode, code, body); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapDelete("/codes/{groupCode}/{*code}", async (string groupCode, string code, ErpUiStore s) =>
{ await s.DeleteCodeAsync(groupCode, code); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapGet("/items", async (ErpUiStore s) => Results.Ok(await s.ItemsAsync()));
ui.MapGet("/partners", async (ErpUiStore s) => Results.Ok(await s.PartnersAsync()));
ui.MapGet("/orders/{kind}", async (string kind, ErpUiStore s) => Results.Ok(await s.ListAsync(kind)));
ui.MapPost("/orders/{kind}", async (string kind, OrderInput body, ErpUiStore s) =>
    Results.Ok(new { orderNo = await s.CreateAsync(kind, body) })).RequireRateLimiting("writes");
ui.MapPut("/orders/{kind}/{no}", async (string kind, string no, OrderInput body, ErpUiStore s) =>
{ await s.UpdateAsync(kind, no, body); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapPost("/orders/{kind}/{no}/cancel", async (string kind, string no, ErpUiStore s) =>
{ await s.CancelAsync(kind, no); return Results.Ok(); }).RequireRateLimiting("writes");
ui.MapGet("/documents", async (ErpUiStore s) => Results.Ok(await s.DocumentsAsync()));

app.Run();

namespace Cloudheat.MockErp
{
    public sealed class ErpOptions
    {
        public string ApiKey { get; set; } = "";
        public double FailureRate { get; set; } = 0.15;
        public double SlowRate { get; set; } = 0.05;
    }
}
