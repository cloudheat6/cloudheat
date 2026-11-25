using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Cloudheat.Api.Erp;

public sealed class ErpOptions
{
    public string BaseUrl { get; set; } = "http://127.0.0.1:5090";
    public string ApiKey { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 5;
    public bool Enabled => !string.IsNullOrWhiteSpace(ApiKey);
}

// ── ERP 가 주는 데이터 ─────────────────────────────────────
public sealed record ErpOrderLine(short LineNo, string ItemCode, string ItemName, string Unit, int Qty, decimal UnitPrice);

public sealed record ErpOrder(
    string OrderNo, string OrderDate, string PartnerCode, string PartnerName,
    string DueDate, string Status, DateTime UpdatedAt, List<ErpOrderLine> Lines);

public sealed record ErpDocument(string DocNo, string DocType, string ErpDocNo, DateTime ReceivedAt, int LineCount, int TotalQty);

// ── 전송 결과 ──────────────────────────────────────────────
public sealed record SendResult(bool Ok, string? ErpDocNo, bool Duplicate, string? Error, bool Retryable);

public sealed class ErpException(string message, bool retryable) : Exception(message)
{
    public bool Retryable { get; } = retryable;
}

/// <summary>가상 ERP REST API 클라이언트. 타임아웃 · 일시 장애 · 검증 오류를 구분해서 돌려줌</summary>
public sealed class ErpClient(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task<List<ErpOrder>> GetPurchaseOrdersAsync(DateTime? since, CancellationToken ct) =>
        GetOrdersAsync("erp/v1/purchase-orders", since, ct);

    public Task<List<ErpOrder>> GetSalesOrdersAsync(DateTime? since, CancellationToken ct) =>
        GetOrdersAsync("erp/v1/sales-orders", since, ct);

    private async Task<List<ErpOrder>> GetOrdersAsync(string path, DateTime? since, CancellationToken ct)
    {
        var url = since is null ? path : $"{path}?updatedSince={Uri.EscapeDataString(since.Value.ToUniversalTime().ToString("O"))}";
        using var res = await SendAsync(() => new HttpRequestMessage(HttpMethod.Get, url), ct);
        return await res.Content.ReadFromJsonAsync<List<ErpOrder>>(Json, ct) ?? [];
    }

    public async Task<List<ErpDocument>> GetDocumentsAsync(int limit, CancellationToken ct)
    {
        using var res = await SendAsync(() => new HttpRequestMessage(HttpMethod.Get, $"erp/v1/documents?limit={limit}"), ct);
        return await res.Content.ReadFromJsonAsync<List<ErpDocument>>(Json, ct) ?? [];
    }

    public async Task<bool> PingAsync(CancellationToken ct)
    {
        try
        {
            using var res = await http.GetAsync("erp/health", ct);
            return res.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    /// <summary>MES 문서 전송. payload 는 outbox 에 저장된 JSON 그대로</summary>
    public async Task<SendResult> SendDocumentAsync(string payloadJson, CancellationToken ct)
    {
        try
        {
            using var res = await SendAsync(() => new HttpRequestMessage(HttpMethod.Post, "erp/v1/documents")
            {
                Content = new StringContent(payloadJson, Encoding.UTF8, "application/json"),
            }, ct);
            var body = await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
            return new SendResult(true, body.GetProperty("erpDocNo").GetString(),
                body.TryGetProperty("duplicate", out var d) && d.GetBoolean(), null, false);
        }
        catch (ErpException ex)
        {
            return new SendResult(false, null, false, ex.Message, ex.Retryable);
        }
    }

    private async Task<HttpResponseMessage> SendAsync(Func<HttpRequestMessage> build, CancellationToken ct)
    {
        HttpResponseMessage res;
        try
        {
            res = await http.SendAsync(build(), ct);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ErpException($"ERP 응답 시간 초과 ({http.Timeout.TotalSeconds:0}초)", retryable: true);
        }
        catch (HttpRequestException ex)
        {
            throw new ErpException($"ERP 연결 실패: {ex.Message}", retryable: true);
        }

        if (res.IsSuccessStatusCode) return res;

        var message = await ReadMessageAsync(res, ct);
        var code = (int)res.StatusCode;
        res.Dispose();
        // 5xx · 429 는 잠시 후 다시 시도, 4xx(검증 · 인증)는 데이터나 설정을 고쳐야 하므로 재시도 안 함
        var retryable = code >= 500 || code == (int)HttpStatusCode.TooManyRequests;
        throw new ErpException($"ERP {code}: {message}", retryable);
    }

    private static async Task<string> ReadMessageAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            var body = await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("message", out var m))
                return m.GetString() ?? res.ReasonPhrase ?? "";
        }
        catch (JsonException) { }
        return res.ReasonPhrase ?? "";
    }
}
