using Dapper;
using Npgsql;

namespace Cloudheat.Api.Erp;

/// <summary>
/// MES → ERP 송신 (Transactional Outbox).
/// 업무 트랜잭션에서 erp_outbox 에 넣어 둔 문서를 꺼내 ERP 로 보내고,
/// 일시 장애는 5 → 10 → 20 → 40초 간격으로 재시도, 5회 실패 또는 검증 오류는 '실패' 로 두고 수동 재전송을 기다림.
/// </summary>
public sealed class OutboxWorker(NpgsqlDataSource db, ErpClient erp, ErpOptions options, ILogger<OutboxWorker> log) : BackgroundService
{
    public const int MaxAttempts = 5;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled) { log.LogWarning("Erp:ApiKey 가 없어 ERP 송신을 끕니다"); return; }
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                // 대기 중인 문서가 있으면 연속 처리, 없으면 다음 주기까지 쉼
                while (!stoppingToken.IsCancellationRequested && await ProcessOneAsync(stoppingToken)) { }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "ERP 송신 작업 오류");
            }
        }
    }

    private async Task<bool> ProcessOneAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // 여러 인스턴스가 돌아도 같은 문서를 동시에 잡지 않도록 SKIP LOCKED
        var item = await conn.QuerySingleOrDefaultAsync<Claim>("""
            SELECT outbox_id AS id, doc_no, payload::text AS payload, attempts
            FROM mes.erp_outbox
            WHERE status = '대기' AND next_attempt_at <= now()
            ORDER BY outbox_id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """, transaction: tx);
        if (item is null) return false;
        var (id, docNo, payload, attempts) = (item.Id, item.DocNo, item.Payload, item.Attempts);

        var result = await erp.SendDocumentAsync(payload, ct);
        var tries = attempts + 1;

        if (result.Ok)
        {
            await conn.ExecuteAsync("""
                UPDATE mes.erp_outbox
                SET status = '성공', attempts = @tries, erp_doc_no = @erpDocNo, sent_at = now(),
                    last_error = CASE WHEN @duplicate THEN 'ERP 에 이미 수신된 문서 (중복 전송 무시)' END
                WHERE outbox_id = @id
                """, new { id, tries, erpDocNo = result.ErpDocNo, duplicate = result.Duplicate }, tx);
            log.LogInformation("ERP 송신 성공 {DocNo} → {ErpDocNo}", docNo, result.ErpDocNo);
        }
        else
        {
            var giveUp = !result.Retryable || tries >= MaxAttempts;
            var delay = TimeSpan.FromSeconds(5 * Math.Pow(2, tries - 1));
            await conn.ExecuteAsync("""
                UPDATE mes.erp_outbox
                SET status = @status, attempts = @tries, last_error = left(@error, 300),
                    next_attempt_at = now() + @delay
                WHERE outbox_id = @id
                """, new { id, tries, status = giveUp ? "실패" : "대기", error = result.Error, delay }, tx);
            log.LogWarning("ERP 송신 실패 {DocNo} ({Tries}회): {Error}", docNo, tries, result.Error);
        }
        await tx.CommitAsync(ct);
        return true;
    }

    private sealed class Claim
    {
        public long Id { get; init; }
        public string DocNo { get; init; } = "";
        public string Payload { get; init; } = "";
        public int Attempts { get; init; }
    }
}
