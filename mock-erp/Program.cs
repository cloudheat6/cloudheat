// 가상 ERP 서버 — MES 연동 데모용
// 실제 더존 Amaranth 10 / iCUBE 규격이 아닌, 연동 패턴을 보여주기 위한 범용 API 입니다.
using Cloudheat.MockErp;
using Dapper;
using Npgsql;

DefaultTypeMap.MatchNamesWithUnderscores = true;

var builder = WebApplication.CreateBuilder(args);
var cs = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default 가 설정되지 않았습니다.");
var options = builder.Configuration.GetSection("Erp").Get<ErpOptions>() ?? new ErpOptions();
if (string.IsNullOrWhiteSpace(options.ApiKey)) throw new InvalidOperationException("Erp:ApiKey 가 설정되지 않았습니다.");

builder.Services.AddSingleton(new NpgsqlDataSourceBuilder(cs).Build());
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<ErpStore>();

var app = builder.Build();

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
