using System.Diagnostics;
using AudioApi.Compression;
using AudioApi.Data;
using AudioApi.Models;
using AudioApi.Options;
using AudioApi.Storage;
using AudioApi.Summarization;
using Microsoft.Extensions.Options;

namespace AudioApi.Processing;

public sealed class AudioProcessingBackgroundService : BackgroundService
{
    private readonly IProcessingQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ProcessingOptions _options;
    private readonly IDbWriteGate _writeGate;
    private readonly ILogger<AudioProcessingBackgroundService> _logger;

    public AudioProcessingBackgroundService(
        IProcessingQueue queue,
        IServiceScopeFactory scopeFactory,
        IOptions<ProcessingOptions> options,
        IDbWriteGate writeGate,
        ILogger<AudioProcessingBackgroundService> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _options = options.Value;
        _writeGate = writeGate;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Worker de compressão iniciado (concorrência: {MaxConcurrency}, capacidade da fila: {QueueCapacity}).",
            _options.EffectiveMaxConcurrency, _options.QueueCapacity);

        try
        {
            await Parallel.ForEachAsync(
                _queue.ReadAllAsync(stoppingToken),
                new ParallelOptions
                {
                    MaxDegreeOfParallelism = _options.EffectiveMaxConcurrency,
                    CancellationToken = stoppingToken,
                },
                async (audioId, ct) => await ProcessGuardedAsync(audioId, ct));
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Worker de compressão encerrando por cancelamento do host.");
        }
    }

    private async Task ProcessGuardedAsync(Guid audioId, CancellationToken ct)
    {
        try
        {
            await ProcessAsync(audioId, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _logger.LogWarning("Compressão de {AudioId} cancelada pelo shutdown da aplicação.", audioId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Falha inesperada ao comprimir {AudioId}.", audioId);
        }
    }

    private async Task ProcessAsync(Guid audioId, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var fileStore = scope.ServiceProvider.GetRequiredService<IFileStore>();
        var compressor = scope.ServiceProvider.GetRequiredService<IAudioCompressor>();
        var summaryQueue = scope.ServiceProvider.GetRequiredService<ISummaryQueue>();
        var summarizationOptions = scope.ServiceProvider.GetRequiredService<IOptions<SummarizationOptions>>().Value;

        var entity = await db.AudioFiles.FindAsync([audioId], ct);
        if (entity is null)
        {
            _logger.LogWarning("Job de compressão descartado: áudio {AudioId} não existe mais.", audioId);
            return;
        }

        entity.ProcessingStatus = ProcessingStatus.Processing;
        entity.ProcessingUpdatedAtUtc = DateTime.UtcNow;
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

            CompressedAudio compressed;
            await using (content.Stream)
            {
                compressed = await compressor.CompressToAacAsync(content.Stream, ct);
            }

            var baseUrl = BaseUrlOf(entity);

            StoredFile stored;
            await using (compressed.Stream)
            {
                stored = await fileStore.SaveAsync(audioId, compressed.Extension, compressed.Stream, baseUrl, ct);
            }

            var previousStoredFileName = entity.StoredFileName;

            stopwatch.Stop();

            entity.StoredFileName = stored.StoredFileName;
            entity.ContentType = compressed.ContentType;
            entity.SizeBytes = stored.SizeBytes;
            entity.ProcessingStatus = ProcessingStatus.Completed;
            entity.ProcessingError = null;
            entity.ProcessingUpdatedAtUtc = DateTime.UtcNow;
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);

            // Só depois do commit: até aqui a linha ainda aponta para o arquivo original, e um download
            // concorrente precisa encontrá-lo. Quando o upload já era .m4a, o nome antigo e o novo são o
            // mesmo e apagar destruiria o arquivo recém-comprimido.
            if (!string.Equals(previousStoredFileName, stored.StoredFileName, StringComparison.Ordinal))
            {
                try
                {
                    await fileStore.DeleteAsync(previousStoredFileName, ct);
                }
                catch (Exception ex)
                {
                    // A linha já está correta e o áudio já é utilizável: um original órfão no file store
                    // não torna o job malsucedido.
                    _logger.LogWarning(
                        ex, "Não foi possível apagar o arquivo original {StoredFileName} de {AudioId}.",
                        previousStoredFileName, audioId);
                }
            }

            _logger.LogInformation(
                "Compressão de {AudioId} concluída em {ElapsedMs}ms ({SizeBytes} bytes).",
                audioId, stopwatch.ElapsedMilliseconds, stored.SizeBytes);

            if (summarizationOptions.Enabled && !summaryQueue.TryEnqueue(audioId))
            {
                _logger.LogWarning("Fila de sumarização cheia; o áudio {AudioId} não será resumido.", audioId);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            stopwatch.Stop();
            _logger.LogError(ex, "Falha ao comprimir {AudioId} após {ElapsedMs}ms.", audioId, stopwatch.ElapsedMilliseconds);

            entity.MarkProcessingFailed(JobError.Clamp(ex.Message));

            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
        }
    }

    /// <summary>
    /// A URL de download é derivada só do id, então a que o upload gravou na linha continua
    /// válida depois da compressão — o worker nunca a reescreve. Este método existe apenas para
    /// devolver ao file store o prefixo que ele mesmo usou, e um prefixo vazio (rota diferente da
    /// esperada) não corrompe nada: a linha mantém a URL que já tinha.
    /// </summary>
    private static string BaseUrlOf(AudioFile entity)
    {
        var suffix = $"/api/audios/{entity.Id}/download";
        return entity.Url.EndsWith(suffix, StringComparison.Ordinal)
            ? entity.Url[..^suffix.Length]
            : string.Empty;
    }
}
