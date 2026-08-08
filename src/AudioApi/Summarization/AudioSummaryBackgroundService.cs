using System.Diagnostics;
using AudioApi.Data;
using AudioApi.Models;
using AudioApi.Options;
using AudioApi.Storage;
using Microsoft.Extensions.Options;

namespace AudioApi.Summarization;

public sealed class AudioSummaryBackgroundService : BackgroundService
{
    private readonly ISummaryQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SummarizationOptions _options;
    private readonly IDbWriteGate _writeGate;
    private readonly ILogger<AudioSummaryBackgroundService> _logger;

    public AudioSummaryBackgroundService(
        ISummaryQueue queue,
        IServiceScopeFactory scopeFactory,
        IOptions<SummarizationOptions> options,
        IDbWriteGate writeGate,
        ILogger<AudioSummaryBackgroundService> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _options = options.Value;
        _writeGate = writeGate;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation(
                "Sumarização de áudio desabilitada (Summarization:Enabled = false); o worker em background não vai consumir a fila.");
            return;
        }

        var maxConcurrency = Math.Max(1, _options.MaxConcurrency);
        using var gate = new SemaphoreSlim(maxConcurrency, maxConcurrency);
        var running = new List<Task>();

        _logger.LogInformation(
            "Worker de resumo iniciado (endpoint: {Endpoint}, concorrência: {MaxConcurrency}, limite: {MaxChars} caracteres).",
            _options.Endpoint, maxConcurrency, _options.EffectiveMaxSummaryChars);

        try
        {
            await foreach (var audioId in _queue.ReadAllAsync(stoppingToken))
            {
                await gate.WaitAsync(stoppingToken);
                running.Add(ProcessGuardedAsync(audioId, gate, stoppingToken));
                running.RemoveAll(task => task.IsCompleted);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Worker de resumo encerrando: {Pending} job(s) em andamento.", running.Count);
        }
        finally
        {
            await Task.WhenAll(running);
        }
    }

    private async Task ProcessGuardedAsync(Guid audioId, SemaphoreSlim gate, CancellationToken ct)
    {
        try
        {
            await ProcessAsync(audioId, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _logger.LogWarning("Sumarização de {AudioId} cancelada pelo shutdown da aplicação.", audioId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha inesperada ao resumir {AudioId}.", audioId);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task ProcessAsync(Guid audioId, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var fileStore = scope.ServiceProvider.GetRequiredService<IFileStore>();
        var summarizer = scope.ServiceProvider.GetRequiredService<IAudioSummarizer>();

        var entity = await db.AudioFiles.FindAsync([audioId], ct);
        if (entity is null)
        {
            _logger.LogWarning("Job de resumo descartado: áudio {AudioId} não existe mais.", audioId);
            return;
        }

        entity.SummaryStatus = SummaryStatus.Processing;
        entity.SummaryUpdatedAtUtc = DateTime.UtcNow;
        await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            var content = await fileStore.OpenReadAsync(entity.StoredFileName, entity.ContentType, ct);
            if (content is null)
            {
                throw new InvalidOperationException(
                    $"O arquivo {entity.StoredFileName} não está mais presente no file store.");
            }

            AudioSummary result;
            await using (content.Stream)
            {
                result = await summarizer.SummarizeAsync(
                    content.Stream,
                    entity.OriginalFileName,
                    entity.ContentType,
                    _options.EffectiveMaxSummaryChars,
                    ct);
            }

            stopwatch.Stop();

            entity.Summary = result.Summary;
            entity.SummaryLanguage = result.Language;
            entity.SummaryError = null;
            entity.SummaryStatus = SummaryStatus.Completed;
            entity.SummaryUpdatedAtUtc = DateTime.UtcNow;
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);

            _logger.LogInformation(
                "Resumo de {AudioId} concluído em {ElapsedMs}ms ({SummaryChars} caracteres).",
                audioId, stopwatch.ElapsedMilliseconds, result.Summary.Length);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            stopwatch.Stop();
            _logger.LogError(ex, "Falha ao resumir {AudioId} após {ElapsedMs}ms.", audioId, stopwatch.ElapsedMilliseconds);

            entity.SummaryStatus = SummaryStatus.Failed;
            entity.SummaryError = JobError.Clamp(ex.Message);
            entity.SummaryUpdatedAtUtc = DateTime.UtcNow;
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
        }
    }
}
