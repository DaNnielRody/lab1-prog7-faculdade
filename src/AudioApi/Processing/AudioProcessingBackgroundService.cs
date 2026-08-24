using System.Diagnostics;
using AudioApi.Compression;
using AudioApi.Data;
using AudioApi.Models;
using AudioApi.Options;
using AudioApi.Storage;
using AudioApi.Summarization;
using Microsoft.EntityFrameworkCore;
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
            await RecoverUnfinishedJobsAsync(stoppingToken);

            await Parallel.ForEachAsync(
                _queue.ReadAllAsync(stoppingToken),
                new ParallelOptions
                {
                    MaxDegreeOfParallelism = _options.EffectiveMaxConcurrency,
                    CancellationToken = stoppingToken,
                },
                async (audioId, ct) => await ProcessGuardedAsync(audioId, ct, stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Worker de compressão encerrando por cancelamento do host.");
        }
        catch (Exception ex)
        {
            // An exception outside the known item-failure matrix means an invariant, dependency,
            // database or configuration failure. Do not silently turn a programming bug into an
            // ordinary audio failure: fail every in-memory job best-effort, log only safe context,
            // then rethrow so BackgroundServiceExceptionBehavior applies (StopHost by default).
            _logger.LogCritical(
                "Worker de compressão interrompido por falha fatal {ExceptionType}.",
                ex.GetType().Name);
            await FailUnfinishedJobsAsync("O processamento foi interrompido por uma falha interna.");
            throw ex is FatalAudioProcessingException ? ex : new FatalAudioProcessingException();
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        // This service uses immediate rejection rather than waiting producers. Completing the
        // writer makes any producer racing with shutdown receive a truthful admission failure.
        _queue.Complete();
        await base.StopAsync(cancellationToken);
    }

    private async Task ProcessGuardedAsync(
        Guid audioId, CancellationToken operationToken, CancellationToken hostToken)
    {
        try
        {
            await ProcessAsync(audioId, operationToken);
        }
        catch (OperationCanceledException) when (hostToken.IsCancellationRequested)
        {
            // Host cancellation is not an item failure. Revert Processing to Pending so startup
            // recovery can admit it again; then propagate cancellation to the parallel loop.
            await TryResetForRecoveryAsync(audioId);
            _logger.LogInformation("Compressão de {AudioId} interrompida pelo shutdown do host.", audioId);
            throw;
        }
        catch (Exception ex)
        {
            await TryMarkUnexpectedFailureAsync(audioId);
            _logger.LogCritical(
                "Falha inesperada {ExceptionType} ao processar {AudioId}; o worker será interrompido.",
                ex.GetType().Name, audioId);
            throw new FatalAudioProcessingException();
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
                throw new FileNotFoundException("O arquivo do áudio não está mais presente no file store.");
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
            try
            {
                await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);
            }
            catch
            {
                // If the database commit did not make the new file authoritative, remove that
                // output. The original remains intact and is still the file referenced by the row.
                if (!string.Equals(previousStoredFileName, stored.StoredFileName, StringComparison.Ordinal))
                {
                    try
                    {
                        await fileStore.DeleteAsync(stored.StoredFileName, CancellationToken.None);
                    }
                    catch (Exception cleanupException) when (IsExpectedFileFailure(cleanupException))
                    {
                        _logger.LogCritical(
                            "Não foi possível compensar a saída de {AudioId} após falha de banco ({ExceptionType}).",
                            audioId, cleanupException.GetType().Name);
                    }
                }

                throw;
            }

            // Só depois do commit: até aqui a linha ainda aponta para o arquivo original, e um download
            // concorrente precisa encontrá-lo. Quando o upload já era .m4a, o nome antigo e o novo são o
            // mesmo e apagar destruiria o arquivo recém-comprimido.
            if (!string.Equals(previousStoredFileName, stored.StoredFileName, StringComparison.Ordinal))
            {
                try
                {
                    await fileStore.DeleteAsync(previousStoredFileName, ct);
                }
                catch (Exception ex) when (IsExpectedFileFailure(ex))
                {
                    // A linha já está correta e o áudio já é utilizável: um original órfão no file store
                    // não torna o job malsucedido.
                    _logger.LogWarning(
                        "Não foi possível apagar o arquivo original de {AudioId} ({ExceptionType}).",
                        audioId, ex.GetType().Name);
                }
            }

            _logger.LogInformation(
                "Compressão de {AudioId} concluída em {ElapsedMs}ms ({SizeBytes} bytes).",
                audioId, stopwatch.ElapsedMilliseconds, stored.SizeBytes);

            if (summarizationOptions.Enabled && !summaryQueue.TryEnqueue(audioId))
            {
                const string reason = "A fila de sumarização está cheia; o resumo não foi admitido.";
                entity.SummaryStatus = SummaryStatus.Failed;
                entity.SummaryError = reason;
                entity.SummaryUpdatedAtUtc = DateTime.UtcNow;
                await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
                _logger.LogWarning("Resumo de {AudioId} rejeitado porque a fila está cheia.", audioId);
            }
        }
        catch (Exception ex) when (IsExpectedItemFailure(ex))
        {
            stopwatch.Stop();
            _logger.LogWarning(
                "Falha conhecida {ExceptionType} ao processar {AudioId} após {ElapsedMs}ms.",
                ex.GetType().Name, audioId, stopwatch.ElapsedMilliseconds);

            entity.MarkProcessingFailed(PublicFailureReason(ex));

            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
        }
    }

    private static bool IsExpectedItemFailure(Exception ex) =>
        ex is AudioCompressionException or FileNotFoundException;

    private static bool IsExpectedFileFailure(Exception ex) =>
        ex is IOException or UnauthorizedAccessException;

    private static string PublicFailureReason(Exception ex) => ex switch
    {
        AudioCompressionException => "O ffmpeg não conseguiu decodificar ou comprimir o áudio.",
        FileNotFoundException => "O arquivo do áudio não está disponível no file store.",
        UnauthorizedAccessException => "O file store recusou acesso ao arquivo do áudio.",
        IOException => "Ocorreu uma falha de I/O durante o processamento do áudio.",
        _ => "O processamento do áudio falhou.",
    };

    private async Task RecoverUnfinishedJobsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var unfinished = await db.AudioFiles
            .Where(audio => audio.ProcessingStatus == ProcessingStatus.Pending
                || audio.ProcessingStatus == ProcessingStatus.Processing)
            .OrderBy(audio => audio.CreatedAtUtc)
            .ToListAsync(ct);

        foreach (var entity in unfinished)
        {
            entity.ProcessingStatus = ProcessingStatus.Pending;
            entity.ProcessingError = null;
            entity.ProcessingUpdatedAtUtc = DateTime.UtcNow;

            if (!_queue.TryEnqueue(entity.Id))
            {
                entity.MarkProcessingFailed(
                    "O job não pôde ser recuperado porque a fila de processamento está cheia.");
            }
        }

        if (unfinished.Count > 0)
        {
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);
            _logger.LogInformation("Recuperados {JobCount} jobs de compressão interrompidos.", unfinished.Count);
        }
    }

    private async Task TryResetForRecoveryAsync(Guid audioId)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.AudioFiles.FindAsync([audioId], CancellationToken.None);
            if (entity is null || entity.ProcessingStatus != ProcessingStatus.Processing) return;
            entity.ProcessingStatus = ProcessingStatus.Pending;
            entity.ProcessingError = null;
            entity.ProcessingUpdatedAtUtc = DateTime.UtcNow;
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogCritical("Falha ao preparar {AudioId} para recuperação ({ExceptionType}).", audioId, ex.GetType().Name);
        }
    }

    private async Task TryMarkUnexpectedFailureAsync(Guid audioId)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entity = await db.AudioFiles.FindAsync([audioId], CancellationToken.None);
            if (entity is null) return;
            entity.MarkProcessingFailed("O processamento encontrou uma falha interna inesperada.");
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogCritical("Falha ao terminalizar {AudioId} ({ExceptionType}).", audioId, ex.GetType().Name);
        }
    }

    private async Task FailUnfinishedJobsAsync(string reason)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var unfinished = await db.AudioFiles
                .Where(audio => audio.ProcessingStatus == ProcessingStatus.Pending
                    || audio.ProcessingStatus == ProcessingStatus.Processing)
                .ToListAsync(CancellationToken.None);

            foreach (var entity in unfinished)
            {
                entity.MarkProcessingFailed(reason);
            }

            if (unfinished.Count > 0)
            {
                await _writeGate.WriteAsync(
                    token => db.SaveChangesAsync(token), CancellationToken.None);
            }
        }
        catch (Exception cleanupException)
        {
            _logger.LogCritical(
                "Não foi possível terminalizar jobs após falha fatal ({ExceptionType}).",
                cleanupException.GetType().Name);
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
