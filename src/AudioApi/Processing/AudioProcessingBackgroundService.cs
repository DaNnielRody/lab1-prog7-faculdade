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
            "Worker de compressão iniciado (modo: {ExecutionMode}, concorrência: {MaxConcurrency}, capacidade da fila: {QueueCapacity}).",
            _options.ExecutionMode, _options.EffectiveMaxConcurrency, _options.QueueCapacity);

        try
        {
            await RecoverUnfinishedJobsAsync(stoppingToken);

            if (_options.ExecutionMode == AudioExecutionMode.Sequential)
            {
                await ConsumeSequentiallyAsync(stoppingToken);
            }
            else
            {
                await Parallel.ForEachAsync(
                    _queue.ReadAllAsync(stoppingToken),
                    new ParallelOptions
                    {
                        MaxDegreeOfParallelism = _options.EffectiveMaxConcurrency,
                        CancellationToken = stoppingToken,
                    },
                    async (audioId, ct) => await ProcessGuardedAsync(audioId, ct, stoppingToken));
            }
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

    private async Task ConsumeSequentiallyAsync(CancellationToken stoppingToken)
    {
        await foreach (var audioId in _queue.ReadAllAsync(stoppingToken))
        {
            // Deliberately await each item before reading the next one. In particular, do not use
            // Task.Run, a semaphore or a fire-and-forget continuation here: this is the true
            // single-worker baseline used by the benchmark.
            await ProcessGuardedAsync(audioId, stoppingToken, stoppingToken);
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
        var audioFilter = scope.ServiceProvider.GetRequiredService<IAudioFilter>();
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

            // Filtro de realce de voz roda depois do commit da compressão, sobre o áudio já
            // comprimido. Isolado em seu próprio try/catch: uma falha aqui só terminaliza
            // FilterStatus, nunca regride ProcessingStatus nem afeta a sumarização.
            await ApplyFilterAsync(audioId, entity, db, fileStore, audioFilter, baseUrl, ct);

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

    /// <summary>
    /// Roda o filtro de realce de voz sobre o áudio já comprimido e persiste o resultado. O corpo
    /// inteiro — inclusive o commit inicial de <see cref="FilterStatus.Processing"/> — está coberto:
    /// qualquer exceção que não seja <see cref="OperationCanceledException"/> (conhecida como
    /// <see cref="AudioFilterException"/>, arquivo ausente, I/O, ou qualquer outra, como uma falha de
    /// banco) só terminaliza <see cref="FilterStatus"/> como Failed — nunca propaga para o catch de
    /// compressão do chamador, que regrediria <see cref="ProcessingStatus"/> ou derrubaria o worker.
    /// Cancelamento continua propagando, para o shutdown do host seguir seu caminho normal.
    /// </summary>
    private async Task ApplyFilterAsync(
        Guid audioId,
        AudioFile entity,
        AppDbContext db,
        IFileStore fileStore,
        IAudioFilter audioFilter,
        string baseUrl,
        CancellationToken ct)
    {
        var filterStopwatch = Stopwatch.StartNew();
        try
        {
            entity.FilterStatus = FilterStatus.Processing;
            entity.FilterUpdatedAtUtc = DateTime.UtcNow;
            await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);

            var content = await fileStore.OpenReadAsync(entity.StoredFileName, entity.ContentType, ct);
            if (content is null)
            {
                throw new FileNotFoundException("O arquivo do áudio não está mais presente no file store para o filtro.");
            }

            FilteredAudio filtered;
            await using (content.Stream)
            {
                filtered = await audioFilter.ApplyAsync(content.Stream, ct);
            }

            StoredFile filteredStored;
            await using (filtered.Stream)
            {
                filteredStored = await fileStore.SaveAsync(
                    audioId, ".filtered" + filtered.Extension, filtered.Stream, baseUrl, ct);
            }

            filterStopwatch.Stop();

            entity.FilteredStoredFileName = filteredStored.StoredFileName;
            entity.FilteredContentType = filtered.ContentType;
            entity.FilteredSizeBytes = filteredStored.SizeBytes;
            entity.FilteredUrl = $"{baseUrl.TrimEnd('/')}/api/audios/{audioId}/download/filtered";
            entity.FilterStatus = FilterStatus.Completed;
            entity.FilterError = null;
            entity.FilterUpdatedAtUtc = DateTime.UtcNow;

            try
            {
                await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);
            }
            catch
            {
                // Espelha a compensação da compressão: sem o commit, o arquivo filtrado é órfão.
                try
                {
                    await fileStore.DeleteAsync(filteredStored.StoredFileName, CancellationToken.None);
                }
                catch (Exception cleanupException) when (IsExpectedFileFailure(cleanupException))
                {
                    _logger.LogCritical(
                        "Não foi possível compensar a saída filtrada de {AudioId} após falha de banco ({ExceptionType}).",
                        audioId, cleanupException.GetType().Name);
                }

                throw;
            }

            _logger.LogInformation(
                "Filtro de {AudioId} concluído em {ElapsedMs}ms ({SizeBytes} bytes).",
                audioId, filterStopwatch.ElapsedMilliseconds, filteredStored.SizeBytes);
        }
        catch (OperationCanceledException)
        {
            // Cancelamento não é falha de item: propaga para o chamador tratar como shutdown do
            // host, exatamente como antes desta reestruturação.
            throw;
        }
        catch (Exception ex)
        {
            filterStopwatch.Stop();

            if (IsExpectedFilterFailure(ex))
            {
                _logger.LogWarning(
                    "Falha conhecida {ExceptionType} ao filtrar {AudioId} após {ElapsedMs}ms.",
                    ex.GetType().Name, audioId, filterStopwatch.ElapsedMilliseconds);
            }
            else
            {
                // Fora da taxonomia conhecida (ex.: DbUpdateException do commit): ainda assim isolado
                // aqui. O invariante do filtro é mais rígido que o da compressão — mesmo uma falha
                // inesperada não pode regredir ProcessingStatus nem derrubar o worker.
                _logger.LogCritical(
                    "Falha inesperada {ExceptionType} ao filtrar {AudioId}; o filtro foi isolado.",
                    ex.GetType().Name, audioId);
            }

            entity.FilterStatus = FilterStatus.Failed;
            entity.FilterError = JobError.Clamp(ex.Message);
            entity.FilterUpdatedAtUtc = DateTime.UtcNow;

            try
            {
                await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), CancellationToken.None);
            }
            catch (Exception persistException)
            {
                _logger.LogCritical(
                    "Não foi possível terminalizar FilterStatus de {AudioId} após falha ({ExceptionType}).",
                    audioId, persistException.GetType().Name);
            }
        }
    }

    private static bool IsExpectedFilterFailure(Exception ex) =>
        ex is AudioFilterException or FileNotFoundException or IOException or UnauthorizedAccessException;

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

        // ApplyFilterAsync agora comita FilterStatus.Processing antes de rodar o filtro, espelhando
        // ProcessAsync. Um shutdown do host enquanto o filtro estava rodando (ou antes de começar)
        // deixa a linha presa em Pending ou Processing para sempre, já que ProcessingStatus está
        // Completed: a linha nunca reentra na fila acima, e nada mais chama ApplyFilterAsync de
        // novo para ela. Recupera essas linhas do mesmo jeito — direto, já que só o passo de
        // filtro (não uma recompressão completa) é devido.
        var unfinishedFilters = await db.AudioFiles
            .Where(audio => audio.ProcessingStatus == ProcessingStatus.Completed
                && (audio.FilterStatus == FilterStatus.Pending
                    || audio.FilterStatus == FilterStatus.Processing))
            .OrderBy(audio => audio.CreatedAtUtc)
            .ToListAsync(ct);

        if (unfinishedFilters.Count > 0)
        {
            var fileStore = scope.ServiceProvider.GetRequiredService<IFileStore>();
            var audioFilter = scope.ServiceProvider.GetRequiredService<IAudioFilter>();

            foreach (var entity in unfinishedFilters)
            {
                await ApplyFilterAsync(entity.Id, entity, db, fileStore, audioFilter, BaseUrlOf(entity), ct);
            }

            _logger.LogInformation("Recuperados {JobCount} jobs de filtro interrompidos.", unfinishedFilters.Count);
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
