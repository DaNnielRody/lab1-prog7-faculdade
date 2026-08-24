using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using AudioApi.Compression;
using AudioApi.Processing;
using AudioApi.Dtos;
using AudioApi.Models;
using AudioApi.Summarization;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AudioApi.Tests;

/// <summary>
/// O <c>POST /api/audios</c> não roda mais o ffmpeg: ele grava os bytes originais, cria a linha
/// com <see cref="ProcessingStatus.Pending"/> e responde 201. A compressão acontece depois, em
/// background. Estes testes fixam esse contrato.
/// </summary>
[Collection(IntegrationCollection.Name)]
public class AudioProcessingIntegrationTests
{
    private static async Task<AudioFileDto> UploadAsync(
        HttpClient client, byte[] bytes, string fileName, string contentType)
    {
        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(fileContent, "file", fileName);

        var post = await client.PostAsync("/api/audios", content);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<AudioFileDto>();
        Assert.NotNull(created);
        return created!;
    }

    /// <summary>Poll até o processamento chegar a um estado terminal (Completed ou Failed).</summary>
    private static async Task<AudioFileDto> PollUntilProcessedAsync(HttpClient client, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);

        while (DateTime.UtcNow < deadline)
        {
            var response = await client.GetAsync($"/api/audios/{id}");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var dto = await response.Content.ReadFromJsonAsync<AudioFileDto>();
            Assert.NotNull(dto);

            if (dto!.ProcessingStatus is ProcessingStatus.Completed or ProcessingStatus.Failed)
            {
                return dto;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException($"O processamento do áudio {id} não foi concluído em 60s.");
    }

    /// <summary>Poll no endpoint de resumo até a sumarização chegar a um estado terminal.</summary>
    private static async Task<AudioSummaryDto> PollUntilSettledAsync(HttpClient client, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);

        while (DateTime.UtcNow < deadline)
        {
            var response = await client.GetAsync($"/api/audios/{id}/summary");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var summary = await response.Content.ReadFromJsonAsync<AudioSummaryDto>();
            Assert.NotNull(summary);

            if (summary!.Status is SummaryStatus.Completed or SummaryStatus.Failed)
            {
                return summary;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException($"O resumo do áudio {id} não foi concluído em 60s.");
    }

    [Fact]
    public async Task Post_Wav_Returns201Immediately_WithPendingProcessingAndOriginalExtension()
    {
        using var factory = new ProcessingAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");

        Assert.Equal(ProcessingStatus.Pending, created.ProcessingStatus);
        Assert.Null(created.ProcessingError);
        Assert.EndsWith(".wav", created.StoredFileName);
        Assert.False(
            created.StoredFileName.EndsWith(".m4a", StringComparison.OrdinalIgnoreCase),
            $"A resposta do upload já veio comprimida ({created.StoredFileName}); o ffmpeg não deveria rodar na requisição.");
    }

    [Fact]
    public async Task Processing_ValidWav_CompletesAsAacAndReplacesTheStoredFile()
    {
        using var factory = new ProcessingAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        var processed = await PollUntilProcessedAsync(client, created.Id);

        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
        Assert.Null(processed.ProcessingError);
        Assert.NotNull(processed.ProcessingUpdatedAtUtc);
        Assert.EndsWith(".m4a", processed.StoredFileName);
        Assert.Equal("audio/mp4", processed.ContentType);
        Assert.Contains($"/api/audios/{processed.Id}/download", processed.Url);

        var download = await client.GetAsync($"/api/audios/{processed.Id}/download");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);

        var downloaded = await download.Content.ReadAsByteArrayAsync();
        Assert.True(downloaded.Length > 12, $"O download devolveu apenas {downloaded.Length} bytes.");

        var header = System.Text.Encoding.ASCII.GetString(downloaded, 4, 8);
        Assert.Contains("ftyp", header);

        Assert.Equal(processed.SizeBytes, downloaded.Length);
    }

    [Fact]
    public async Task Processing_GarbageBytes_Returns201ThenFailsProcessingAndSummary()
    {
        using var factory = new ProcessingAppFactory(summarizationEnabled: true, summarizerSummary: "resumo qualquer");
        var client = factory.CreateClient();

        var garbage = new byte[2048];
        new Random(42).NextBytes(garbage);

        var created = await UploadAsync(client, garbage, "garbage.wav", "audio/wav");
        Assert.Equal(ProcessingStatus.Pending, created.ProcessingStatus);

        var processed = await PollUntilProcessedAsync(client, created.Id);

        Assert.Equal(ProcessingStatus.Failed, processed.ProcessingStatus);
        Assert.False(
            string.IsNullOrWhiteSpace(processed.ProcessingError),
            $"O áudio {created.Id} falhou na compressão sem registrar o motivo em ProcessingError.");

        // Sem .m4a nunca haverá o que resumir: a sumarização também termina em Failed.
        var summary = await PollUntilSettledAsync(client, created.Id);
        Assert.Equal(SummaryStatus.Failed, summary.Status);
        Assert.Null(summary.Summary);
        Assert.False(
            string.IsNullOrWhiteSpace(summary.Error),
            $"A sumarização do áudio {created.Id} falhou sem registrar o motivo.");
    }

    [Fact]
    public async Task Download_WhileProcessingIsNotFinished_Returns200WithTheOriginalBytes()
    {
        using var factory = new ProcessingAppFactory(maxConcurrency: 1);
        var client = factory.CreateClient();

        // Áudio mais longo (~10s) para que a janela Pending/Processing exista de fato.
        var original = TestAudio.CreateValidWavBytes(sampleCount: 80_000);
        var created = await UploadAsync(client, original, "sample.wav", "audio/wav");

        var sawNonTerminalState = false;
        var deadline = DateTime.UtcNow.AddSeconds(60);

        while (DateTime.UtcNow < deadline)
        {
            var download = await client.GetAsync($"/api/audios/{created.Id}/download");
            Assert.True(
                download.StatusCode == HttpStatusCode.OK,
                $"O download do áudio {created.Id} devolveu {(int)download.StatusCode} durante o processamento; "
                + "o arquivo apontado pela linha tem que existir em todo instante (R9).");

            var downloaded = await download.Content.ReadAsByteArrayAsync();
            Assert.True(downloaded.Length > 0, $"O download do áudio {created.Id} devolveu 0 bytes.");

            var metadata = await client.GetFromJsonAsync<AudioFileDto>($"/api/audios/{created.Id}");
            Assert.NotNull(metadata);

            if (metadata!.ProcessingStatus is ProcessingStatus.Pending or ProcessingStatus.Processing)
            {
                sawNonTerminalState = true;
                await Task.Delay(20);
                continue;
            }

            Assert.Equal(ProcessingStatus.Completed, metadata.ProcessingStatus);
            Assert.True(
                sawNonTerminalState,
                $"O áudio {created.Id} nunca foi observado em Pending/Processing; o download durante a compressão não foi exercitado.");
            return;
        }

        throw new TimeoutException($"O processamento do áudio {created.Id} não foi concluído em 60s.");
    }

    [Fact]
    public async Task Processing_M4aUpload_KeepsTheCompressedFileDespiteTheStoredNameCollision()
    {
        using var factory = new ProcessingAppFactory();
        var client = factory.CreateClient();

        // O nome armazenado é {id:N}{extensão}: um .m4a de entrada colide com o .m4a de saída.
        var m4a = await TestAudio.CreateValidM4aBytesAsync();
        var created = await UploadAsync(client, m4a, "sample.m4a", "audio/mp4");
        Assert.EndsWith(".m4a", created.StoredFileName);

        var processed = await PollUntilProcessedAsync(client, created.Id);

        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
        Assert.Null(processed.ProcessingError);
        Assert.EndsWith(".m4a", processed.StoredFileName);
        Assert.Equal("audio/mp4", processed.ContentType);

        var download = await client.GetAsync($"/api/audios/{processed.Id}/download");
        Assert.Equal(
            HttpStatusCode.OK,
            download.StatusCode);

        var downloaded = await download.Content.ReadAsByteArrayAsync();
        Assert.True(
            downloaded.Length > 12,
            $"O arquivo do áudio {processed.Id} sumiu depois da compressão ({downloaded.Length} bytes): a limpeza do original apagou a saída.");

        var header = System.Text.Encoding.ASCII.GetString(downloaded, 4, 8);
        Assert.Contains("ftyp", header);
        Assert.Equal(processed.SizeBytes, downloaded.Length);
    }

    [Fact]
    public async Task Processing_SixConcurrentUploads_AllReachCompleted()
    {
        const int uploads = 6;

        using var factory = new ProcessingAppFactory(maxConcurrency: 4);
        var client = factory.CreateClient();

        var bytes = TestAudio.CreateValidWavBytes();

        var created = await Task.WhenAll(Enumerable.Range(0, uploads)
            .Select(i => UploadAsync(client, bytes, $"sample-{i}.wav", "audio/wav")));

        Assert.Equal(uploads, created.Length);

        var processed = await Task.WhenAll(created.Select(c => PollUntilProcessedAsync(client, c.Id)));

        foreach (var dto in processed)
        {
            Assert.True(
                dto.ProcessingStatus == ProcessingStatus.Completed,
                $"O áudio {dto.Id} terminou como {dto.ProcessingStatus} em vez de Completed: {dto.ProcessingError}");
            Assert.Null(dto.ProcessingError);
            Assert.EndsWith(".m4a", dto.StoredFileName);
        }

        var failed = processed.Count(d => d.ProcessingStatus == ProcessingStatus.Failed);
        Assert.True(failed == 0, $"{failed} de {uploads} uploads concorrentes falharam no processamento.");
        Assert.Equal(uploads, processed.Select(audio => audio.StoredFileName).Distinct().Count());
        Assert.All(processed, audio =>
            Assert.Equal($"{audio.Id:N}.m4a", audio.StoredFileName));
    }

    [Fact]
    public async Task Processing_ParallelWorker_UsesConfiguredCeiling_AndCompletesAllQueuedJobs()
    {
        const int maxConcurrency = 2;
        const int uploads = 3;
        var compressor = new BlockingAudioCompressor(expectedConcurrentJobs: maxConcurrency);

        using var factory = new ProcessingAppFactory(maxConcurrency: maxConcurrency, compressor: compressor);
        var client = factory.CreateClient();
        var bytes = TestAudio.CreateValidWavBytes();

        var created = await Task.WhenAll(Enumerable.Range(0, uploads)
            .Select(i => UploadAsync(client, bytes, $"parallel-{i}.wav", "audio/wav")));

        await compressor.AllExpectedJobsStarted.WaitAsync(TimeSpan.FromSeconds(10));

        try
        {
            Assert.Equal(maxConcurrency, compressor.MaxObservedConcurrency);
            Assert.Equal(maxConcurrency, compressor.CurrentConcurrency);
            Assert.Equal(maxConcurrency, compressor.StartedJobs);
            Assert.NotSame(
                compressor.UnexpectedJobStarted,
                await Task.WhenAny(
                    compressor.UnexpectedJobStarted,
                    Task.Delay(TimeSpan.FromMilliseconds(250))));
        }
        finally
        {
            compressor.Release();
        }

        var processed = await Task.WhenAll(created.Select(c => PollUntilProcessedAsync(client, c.Id)));

        Assert.All(processed, audio =>
        {
            Assert.Equal(ProcessingStatus.Completed, audio.ProcessingStatus);
            Assert.Null(audio.ProcessingError);
            Assert.EndsWith(".m4a", audio.StoredFileName);
        });
    }

    [Fact]
    public async Task Processing_Shutdown_CancelsActiveCompression_AndDoesNotDeadlock()
    {
        var compressor = new BlockingAudioCompressor(expectedConcurrentJobs: 1);
        var factory = new ProcessingAppFactory(maxConcurrency: 1, compressor: compressor);
        Task? shutdown = null;

        try
        {
            var client = factory.CreateClient();
            await UploadAsync(client, TestAudio.CreateValidWavBytes(), "shutdown.wav", "audio/wav");
            await compressor.AllExpectedJobsStarted.WaitAsync(TimeSpan.FromSeconds(10));

            shutdown = Task.Run(factory.Dispose);
            await compressor.CancellationObserved.WaitAsync(TimeSpan.FromSeconds(10));
            await shutdown.WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally
        {
            compressor.Release();
            if (shutdown is null)
            {
                factory.Dispose();
            }
            else
            {
                await shutdown.WaitAsync(TimeSpan.FromSeconds(10));
            }
        }
    }

    [Fact]
    public async Task Upload_WhenProcessingQueueIsFull_Returns503WithoutPersistingFileOrRecord()
    {
        using var factory = new ProcessingAppFactory(processingQueue: new RejectingProcessingQueue());
        var client = factory.CreateClient();
        using var content = CreateUploadContent(TestAudio.CreateValidWavBytes(), "overload.wav");

        var response = await client.PostAsync("/api/audios", content);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var audios = await client.GetFromJsonAsync<List<AudioFileDto>>("/api/audios");
        Assert.Empty(audios!);
    }

    [Fact]
    public async Task Upload_RealQueueSaturationRejectsExplicitlyThenRecoversCapacity()
    {
        var compressor = new BlockingAudioCompressor(expectedConcurrentJobs: 1);
        using var factory = new ProcessingAppFactory(maxConcurrency: 1, queueCapacity: 1, compressor: compressor);
        var client = factory.CreateClient();
        var bytes = TestAudio.CreateValidWavBytes();

        var active = await UploadAsync(client, bytes, "active.wav", "audio/wav");
        await compressor.AllExpectedJobsStarted.WaitAsync(TimeSpan.FromSeconds(10));
        var buffered = await UploadAsync(client, bytes, "buffered.wav", "audio/wav");
        using var rejectedContent = CreateUploadContent(bytes, "rejected.wav");
        var rejected = await client.PostAsync("/api/audios", rejectedContent);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, rejected.StatusCode);

        compressor.Release();
        Assert.Equal(ProcessingStatus.Completed, (await PollUntilProcessedAsync(client, active.Id)).ProcessingStatus);
        Assert.Equal(ProcessingStatus.Completed, (await PollUntilProcessedAsync(client, buffered.Id)).ProcessingStatus);

        var recovered = await UploadAsync(client, bytes, "recovered.wav", "audio/wav");
        Assert.Equal(ProcessingStatus.Completed, (await PollUntilProcessedAsync(client, recovered.Id)).ProcessingStatus);
        var all = await client.GetFromJsonAsync<List<AudioFileDto>>("/api/audios");
        Assert.Equal(3, all!.Count);
        Assert.DoesNotContain(all, audio => audio.ProcessingStatus == ProcessingStatus.Pending);
    }

    [Fact]
    public async Task Processing_KnownFailureFailsOnlyItsAudio_AndNextJobCompletesWithoutSensitiveLogData()
    {
        var compressor = new FirstKnownFailureThenSuccessCompressor();
        var logs = new RecordingLoggerProvider();
        using var factory = new ProcessingAppFactory(maxConcurrency: 1, compressor: compressor, loggerProvider: logs);
        var client = factory.CreateClient();

        var failedUpload = await UploadAsync(
            client, TestAudio.CreateValidWavBytes(), "known-failure.wav", "audio/wav");
        var failed = await PollUntilProcessedAsync(client, failedUpload.Id);
        var successfulUpload = await UploadAsync(
            client, TestAudio.CreateValidWavBytes(), "next-job.wav", "audio/wav");
        var completed = await PollUntilProcessedAsync(client, successfulUpload.Id);

        Assert.Equal(ProcessingStatus.Failed, failed.ProcessingStatus);
        Assert.Equal("O ffmpeg não conseguiu decodificar ou comprimir o áudio.", failed.ProcessingError);
        Assert.Equal(ProcessingStatus.Completed, completed.ProcessingStatus);
        Assert.Equal(2, compressor.CallCount);

        var workerLogs = logs.Entries.ToList();
        Assert.DoesNotContain(workerLogs, entry => entry.Message.Contains("customer-secret", StringComparison.Ordinal));
        Assert.DoesNotContain(workerLogs, entry => entry.Message.Contains("/private/", StringComparison.Ordinal));
        Assert.DoesNotContain(workerLogs, entry => entry.Exception is not null);
    }

    [Fact]
    public async Task Processing_UnexpectedFailureIsCritical_FailsUnfinishedJobs_AndStopsWorker()
    {
        var compressor = new BlockingFatalCompressor();
        var logs = new RecordingLoggerProvider();
        using var factory = new ProcessingAppFactory(
            maxConcurrency: 1,
            queueCapacity: 1,
            compressor: compressor,
            loggerProvider: logs,
            ignoreBackgroundServiceExceptions: true);
        var client = factory.CreateClient();

        var fatalUpload = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "fatal.wav", "audio/wav");
        await compressor.Started.WaitAsync(TimeSpan.FromSeconds(10));
        var queuedUpload = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "queued.wav", "audio/wav");

        compressor.Release();
        await logs.CriticalLogged.WaitAsync(TimeSpan.FromSeconds(10));

        var fatal = await PollUntilProcessedAsync(client, fatalUpload.Id);
        var queued = await PollUntilProcessedAsync(client, queuedUpload.Id);
        Assert.Equal(ProcessingStatus.Failed, fatal.ProcessingStatus);
        Assert.Equal(ProcessingStatus.Failed, queued.ProcessingStatus);
        Assert.DoesNotContain(new[] { fatal, queued }, audio =>
            audio.ProcessingStatus is ProcessingStatus.Pending or ProcessingStatus.Processing);

        var workerLogs = logs.Entries.Where(entry =>
            entry.Category == typeof(AudioProcessingBackgroundService).FullName).ToList();
        Assert.Contains(workerLogs, entry => entry.Level == LogLevel.Critical);
        Assert.DoesNotContain(workerLogs, entry => entry.Message.Contains("fatal-secret", StringComparison.Ordinal));
        Assert.DoesNotContain(workerLogs, entry => entry.Message.Contains("/private/", StringComparison.Ordinal));
        Assert.DoesNotContain(workerLogs, entry => entry.Exception is not null);
    }

    [Fact]
    public async Task Processing_HostCancellationIsPendingForRecovery_NotLoggedOrPersistedAsAudioFailure()
    {
        var compressor = new BlockingAudioCompressor(expectedConcurrentJobs: 1);
        var logs = new RecordingLoggerProvider();
        var factory = new ProcessingAppFactory(
            maxConcurrency: 1,
            compressor: compressor,
            loggerProvider: logs,
            deleteTempOnDispose: false);
        Guid audioId;

        try
        {
            var client = factory.CreateClient();
            var upload = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "shutdown.wav", "audio/wav");
            audioId = upload.Id;
            await compressor.AllExpectedJobsStarted.WaitAsync(TimeSpan.FromSeconds(10));

            var shutdown = Task.Run(factory.Dispose);
            await compressor.CancellationObserved.WaitAsync(TimeSpan.FromSeconds(10));
            await shutdown.WaitAsync(TimeSpan.FromSeconds(10));

            await using var connection = new SqliteConnection($"Data Source={factory.DatabasePath}");
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT ProcessingStatus FROM AudioFiles";
            Assert.Equal("Pending", await command.ExecuteScalarAsync());

            var workerLogs = logs.Entries.Where(entry =>
                entry.Category == typeof(AudioProcessingBackgroundService).FullName).ToList();
            Assert.DoesNotContain(workerLogs, entry =>
                entry.Level >= LogLevel.Warning && entry.Message.Contains(audioId.ToString(), StringComparison.OrdinalIgnoreCase));

            compressor.Release();
            using var recoveryFactory = new ProcessingAppFactory(tempDirectory: factory.TempDirectory);
            var recoveryClient = recoveryFactory.CreateClient();
            var recovered = await PollUntilProcessedAsync(recoveryClient, audioId);
            Assert.Equal(ProcessingStatus.Completed, recovered.ProcessingStatus);
        }
        finally
        {
            compressor.Release();
            if (Directory.Exists(factory.TempDirectory))
            {
                Directory.Delete(factory.TempDirectory, recursive: true);
            }
        }
    }

    [Fact]
    public async Task ProcessingState_IsExposedOnBothAudioFileDtoAndAudioSummaryDto()
    {
        using var factory = new ProcessingAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");

        var summaryWhilePending = await client.GetFromJsonAsync<AudioSummaryDto>($"/api/audios/{created.Id}/summary");
        Assert.NotNull(summaryWhilePending);
        Assert.Null(summaryWhilePending!.ProcessingError);

        var processed = await PollUntilProcessedAsync(client, created.Id);
        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);

        var summaryAfter = await client.GetFromJsonAsync<AudioSummaryDto>($"/api/audios/{created.Id}/summary");
        Assert.NotNull(summaryAfter);
        Assert.Equal(ProcessingStatus.Completed, summaryAfter!.ProcessingStatus);
        Assert.Null(summaryAfter.ProcessingError);
    }

    private static MultipartFormDataContent CreateUploadContent(byte[] bytes, string fileName)
    {
        var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        content.Add(fileContent, "file", fileName);
        return content;
    }

    private sealed class FakeAudioSummarizer : IAudioSummarizer
    {
        private readonly string? _summary;

        public FakeAudioSummarizer(string? summary) => _summary = summary;

        public async Task<AudioSummary> SummarizeAsync(
            Stream audio, string fileName, string contentType, int maxChars, CancellationToken ct = default)
        {
            using var drain = new MemoryStream();
            await audio.CopyToAsync(drain, ct);

            if (_summary is null)
            {
                throw new InvalidOperationException("O worker de resumo está indisponível (fake).");
            }

            return new AudioSummary(SummaryTruncator.Clamp(_summary, maxChars), "pt", _summary.Length);
        }
    }

    private sealed class BlockingAudioCompressor : IAudioCompressor
    {
        private readonly TaskCompletionSource<bool> _release =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _cancellationObserved =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _unexpectedJobStarted =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly int _expectedConcurrentJobs;
        private int _currentConcurrency;
        private int _maxObservedConcurrency;
        private int _startedJobs;

        public BlockingAudioCompressor(int expectedConcurrentJobs)
        {
            _expectedConcurrentJobs = expectedConcurrentJobs;
            AllExpectedJobsStartedSource = new TaskCompletionSource<bool>(
                TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private TaskCompletionSource<bool> AllExpectedJobsStartedSource { get; }

        public Task AllExpectedJobsStarted => AllExpectedJobsStartedSource.Task;

        public Task UnexpectedJobStarted => _unexpectedJobStarted.Task;

        public Task CancellationObserved => _cancellationObserved.Task;

        public int CurrentConcurrency => Volatile.Read(ref _currentConcurrency);

        public int MaxObservedConcurrency => Volatile.Read(ref _maxObservedConcurrency);

        public int StartedJobs => Volatile.Read(ref _startedJobs);

        public void Release() => _release.TrySetResult(true);

        public async Task<CompressedAudio> CompressToAacAsync(
            Stream input,
            CancellationToken ct = default)
        {
            var current = Interlocked.Increment(ref _currentConcurrency);
            UpdateMaximum(current);

            var started = Interlocked.Increment(ref _startedJobs);
            if (started > _expectedConcurrentJobs)
            {
                _unexpectedJobStarted.TrySetResult(true);
            }
            else if (started == _expectedConcurrentJobs)
            {
                AllExpectedJobsStartedSource.TrySetResult(true);
            }

            try
            {
                await _release.Task.WaitAsync(ct);
                await input.CopyToAsync(Stream.Null, ct);
                return new CompressedAudio(new MemoryStream([0x4D, 0x34, 0x41]), ".m4a", "audio/mp4");
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                _cancellationObserved.TrySetResult(true);
                throw;
            }
            finally
            {
                Interlocked.Decrement(ref _currentConcurrency);
            }
        }

        private void UpdateMaximum(int current)
        {
            while (true)
            {
                var observed = Volatile.Read(ref _maxObservedConcurrency);
                if (current <= observed || Interlocked.CompareExchange(
                        ref _maxObservedConcurrency, current, observed) == observed)
                {
                    return;
                }
            }
        }
    }

    private sealed class FirstKnownFailureThenSuccessCompressor : IAudioCompressor
    {
        private int _callCount;

        public int CallCount => Volatile.Read(ref _callCount);

        public async Task<CompressedAudio> CompressToAacAsync(Stream input, CancellationToken ct = default)
        {
            var call = Interlocked.Increment(ref _callCount);
            await input.CopyToAsync(Stream.Null, ct);
            if (call == 1)
            {
                throw new AudioCompressionException(
                    "customer-secret estava em /private/customer-secret.wav");
            }

            return new CompressedAudio(new MemoryStream([0x4D, 0x34, 0x41]), ".m4a", "audio/mp4");
        }
    }

    private sealed class BlockingFatalCompressor : IAudioCompressor
    {
        private readonly TaskCompletionSource<bool> _started =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _release =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task Started => _started.Task;

        public void Release() => _release.TrySetResult(true);

        public async Task<CompressedAudio> CompressToAacAsync(Stream input, CancellationToken ct = default)
        {
            _started.TrySetResult(true);
            await _release.Task.WaitAsync(ct);
            throw new InvalidOperationException("fatal-secret em /private/fatal-secret.wav");
        }
    }

    private sealed class RejectingProcessingQueue : IProcessingQueue
    {
        private readonly System.Threading.Channels.Channel<Guid> _channel =
            System.Threading.Channels.Channel.CreateUnbounded<Guid>();

        public bool TryReserve(out IProcessingQueueAdmission? admission)
        {
            admission = null;
            return false;
        }

        public bool TryEnqueue(Guid audioId) => false;

        public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct) =>
            _channel.Reader.ReadAllAsync(ct);

        public void Complete() => _channel.Writer.TryComplete();
    }

    private sealed record LogEntry(string Category, LogLevel Level, string Message, Exception? Exception);

    private sealed class RecordingLoggerProvider : ILoggerProvider
    {
        private readonly ConcurrentQueue<LogEntry> _entries = new();
        private readonly TaskCompletionSource<bool> _criticalLogged =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public IReadOnlyCollection<LogEntry> Entries => _entries.ToArray();

        public Task CriticalLogged => _criticalLogged.Task;

        public ILogger CreateLogger(string categoryName) => new RecordingLogger(categoryName, this);

        public void Dispose()
        {
        }

        private sealed class RecordingLogger(string category, RecordingLoggerProvider provider) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                provider._entries.Enqueue(new LogEntry(category, logLevel, formatter(state, exception), exception));
                if (logLevel == LogLevel.Critical
                    && category == typeof(AudioProcessingBackgroundService).FullName)
                {
                    provider._criticalLogged.TrySetResult(true);
                }
            }
        }
    }

    private sealed class ProcessingAppFactory : WebApplicationFactory<Program>
    {
        private readonly string _tempDir =
            Path.Combine(Path.GetTempPath(), "audioapi-processing-tests-" + Guid.NewGuid().ToString("N"));

        private readonly bool _summarizationEnabled;
        private readonly string? _summarizerSummary;
        private readonly int _maxConcurrency;
        private readonly int _queueCapacity;
        private readonly IAudioCompressor? _compressor;
        private readonly IProcessingQueue? _processingQueue;
        private readonly ILoggerProvider? _loggerProvider;
        private readonly bool _ignoreBackgroundServiceExceptions;
        private readonly bool _deleteTempOnDispose;

        public ProcessingAppFactory(
            bool summarizationEnabled = false,
            string? summarizerSummary = null,
            int maxConcurrency = 4,
            int queueCapacity = 100,
            IAudioCompressor? compressor = null,
            IProcessingQueue? processingQueue = null,
            ILoggerProvider? loggerProvider = null,
            bool ignoreBackgroundServiceExceptions = false,
            bool deleteTempOnDispose = true,
            string? tempDirectory = null)
        {
            _tempDir = tempDirectory
                ?? Path.Combine(Path.GetTempPath(), "audioapi-processing-tests-" + Guid.NewGuid().ToString("N"));
            _summarizationEnabled = summarizationEnabled;
            _summarizerSummary = summarizerSummary;
            _maxConcurrency = maxConcurrency;
            _queueCapacity = queueCapacity;
            _compressor = compressor;
            _processingQueue = processingQueue;
            _loggerProvider = loggerProvider;
            _ignoreBackgroundServiceExceptions = ignoreBackgroundServiceExceptions;
            _deleteTempOnDispose = deleteTempOnDispose;
            Directory.CreateDirectory(_tempDir);
        }

        public string TempDirectory => _tempDir;

        public string DatabasePath => Path.Combine(_tempDir, "audios.db");

        protected override IHost CreateHost(IHostBuilder builder)
        {
            // Environment.ProcessorCount não é confiável em container com cgroup limitado:
            // a concorrência do teste é explícita.
            TestEnvironment.Apply(_tempDir, new Dictionary<string, string?>
            {
                ["Summarization__Enabled"] = _summarizationEnabled ? "true" : "false",
                ["Summarization__MaxConcurrency"] = "1",
                ["Processing__MaxConcurrency"] = _maxConcurrency.ToString(),
                ["Processing__QueueCapacity"] = _queueCapacity.ToString(),
            });

            builder.UseEnvironment("Development");
            return base.CreateHost(builder);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureServices(services =>
            {
                if (_compressor is not null)
                {
                    services.RemoveAll<IAudioCompressor>();
                    services.AddSingleton(_compressor);
                }

                if (_processingQueue is not null)
                {
                    services.RemoveAll<IProcessingQueue>();
                    services.AddSingleton(_processingQueue);
                }

                if (_loggerProvider is not null)
                {
                    services.AddSingleton(_loggerProvider);
                    services.AddSingleton<ILoggerProvider>(_loggerProvider);
                }

                if (_ignoreBackgroundServiceExceptions)
                {
                    services.Configure<HostOptions>(options =>
                        options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore);
                }

                services.RemoveAll<IAudioSummarizer>();
                services.AddSingleton<IAudioSummarizer>(_ => new FakeAudioSummarizer(_summarizerSummary));
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (!_deleteTempOnDispose)
            {
                return;
            }

            try
            {
                if (Directory.Exists(_tempDir))
                {
                    Directory.Delete(_tempDir, recursive: true);
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
