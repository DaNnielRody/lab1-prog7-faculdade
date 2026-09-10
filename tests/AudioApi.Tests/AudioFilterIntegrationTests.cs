using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using AudioApi.Compression;
using AudioApi.Dtos;
using AudioApi.Models;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace AudioApi.Tests;

/// <summary>
/// Tickets 01/02 (#26, #27): after compression commits, the background job runs the ffmpeg
/// voice-enhancement filter chain on the already-compressed audio, persists the result as an
/// extra file for the same id, and exposes it through its own state machine, DTO fields and
/// download route — without ever regressing <see cref="ProcessingStatus"/> or the summary.
/// </summary>
[Collection(IntegrationCollection.Name)]
public class AudioFilterIntegrationTests
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

    /// <summary>Poll até a compressão chegar a um estado terminal (Completed ou Failed).</summary>
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

    /// <summary>Poll até o filtro chegar a um estado terminal (Completed ou Failed).</summary>
    private static async Task<AudioFileDto> PollUntilFilterSettledAsync(HttpClient client, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);

        while (DateTime.UtcNow < deadline)
        {
            var response = await client.GetAsync($"/api/audios/{id}");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var dto = await response.Content.ReadFromJsonAsync<AudioFileDto>();
            Assert.NotNull(dto);

            if (dto!.FilterStatus is FilterStatus.Completed or FilterStatus.Failed)
            {
                return dto;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException($"O filtro do áudio {id} não foi concluído em 60s.");
    }

    [Fact]
    public async Task Filter_ValidCompressedAudio_ReachesCompleted_AndFileExistsInTheStore()
    {
        using var factory = new FilterAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        var processed = await PollUntilProcessedAsync(client, created.Id);
        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);

        var filtered = await PollUntilFilterSettledAsync(client, created.Id);
        Assert.Equal(FilterStatus.Completed, filtered.FilterStatus);
        Assert.Null(filtered.FilterError);
        Assert.NotNull(filtered.FilterUpdatedAtUtc);

        var storedPath = Path.Combine(factory.TempDirectory, "filestore", $"{created.Id:N}.filtered.m4a");
        Assert.True(File.Exists(storedPath), $"Arquivo filtrado não encontrado em {storedPath}.");
    }

    [Fact]
    public async Task DownloadFiltered_WhenCompleted_Returns200WithFilteredBytesAndContentType()
    {
        using var factory = new FilterAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        await PollUntilProcessedAsync(client, created.Id);
        var filtered = await PollUntilFilterSettledAsync(client, created.Id);
        Assert.Equal(FilterStatus.Completed, filtered.FilterStatus);

        var download = await client.GetAsync($"/api/audios/{created.Id}/download/filtered");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("audio/mp4", download.Content.Headers.ContentType?.MediaType);

        var downloaded = await download.Content.ReadAsByteArrayAsync();
        Assert.True(downloaded.Length > 0, "O download filtrado devolveu 0 bytes.");
        Assert.Equal(filtered.FilteredSizeBytes, downloaded.Length);
    }

    [Fact]
    public async Task DownloadFiltered_UnknownId_Returns404()
    {
        using var factory = new FilterAppFactory();
        var client = factory.CreateClient();

        var download = await client.GetAsync($"/api/audios/{Guid.NewGuid()}/download/filtered");
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task DownloadFiltered_BeforeFilterHasCompleted_Returns404()
    {
        var filter = new BlockingAudioFilter();
        using var factory = new FilterAppFactory(filter: filter);

        try
        {
            var client = factory.CreateClient();
            var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");

            // A compressão termina e libera o download original; o filtro fica bloqueado de propósito.
            var processed = await PollUntilProcessedAsync(client, created.Id);
            Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
            await filter.Started.WaitAsync(TimeSpan.FromSeconds(10));

            var download = await client.GetAsync($"/api/audios/{created.Id}/download/filtered");
            Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
        }
        finally
        {
            filter.Release();
        }
    }

    [Fact]
    public async Task DownloadFiltered_FileMissingFromStore_Returns404()
    {
        using var factory = new FilterAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        await PollUntilProcessedAsync(client, created.Id);
        var filtered = await PollUntilFilterSettledAsync(client, created.Id);
        Assert.Equal(FilterStatus.Completed, filtered.FilterStatus);

        var storedPath = Path.Combine(factory.TempDirectory, "filestore", $"{created.Id:N}.filtered.m4a");
        Assert.True(File.Exists(storedPath));
        File.Delete(storedPath);

        var download = await client.GetAsync($"/api/audios/{created.Id}/download/filtered");
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task AudioFileDto_ExposesFilterFields_OnGetAndList_WithoutChangingExistingFields()
    {
        using var factory = new FilterAppFactory();
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        var processed = await PollUntilProcessedAsync(client, created.Id);
        var filtered = await PollUntilFilterSettledAsync(client, created.Id);

        Assert.Equal(FilterStatus.Completed, filtered.FilterStatus);
        Assert.Null(filtered.FilterError);
        Assert.NotNull(filtered.FilteredUrl);
        Assert.Contains($"/api/audios/{filtered.Id}/download/filtered", filtered.FilteredUrl);
        Assert.True(filtered.FilteredSizeBytes > 0);
        Assert.Equal("audio/mp4", filtered.FilteredContentType);

        // Existing fields keep their previously fixed contract (mirrors AudioApiIntegrationTests).
        Assert.Equal(created.Id, filtered.Id);
        Assert.Equal("sample.wav", filtered.OriginalFileName);
        Assert.Equal(ProcessingStatus.Completed, filtered.ProcessingStatus);
        Assert.Null(filtered.ProcessingError);
        Assert.EndsWith(".m4a", filtered.StoredFileName);
        Assert.Equal("audio/mp4", filtered.ContentType);
        Assert.Contains($"/api/audios/{filtered.Id}/download", filtered.Url);

        var list = await client.GetFromJsonAsync<List<AudioFileDto>>("/api/audios");
        Assert.NotNull(list);
        var listed = Assert.Single(list!, a => a.Id == created.Id);
        Assert.Equal(FilterStatus.Completed, listed.FilterStatus);
        Assert.Equal(filtered.FilteredUrl, listed.FilteredUrl);
        Assert.Equal(filtered.FilteredSizeBytes, listed.FilteredSizeBytes);
        Assert.Equal(filtered.FilteredContentType, listed.FilteredContentType);
    }

    [Fact]
    public async Task FilterFailure_DoesNotRegressCompression_ProcessingStaysCompleted()
    {
        var filter = new AlwaysFailingAudioFilter("O ffmpeg não conseguiu aplicar o filtro de realce de voz.");
        using var factory = new FilterAppFactory(filter: filter);
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        var processed = await PollUntilProcessedAsync(client, created.Id);
        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
        Assert.Null(processed.ProcessingError);

        var filtered = await PollUntilFilterSettledAsync(client, created.Id);
        Assert.Equal(FilterStatus.Failed, filtered.FilterStatus);
        Assert.False(string.IsNullOrWhiteSpace(filtered.FilterError));

        // A falha do filtro é isolada: a compressão continua Completed depois do filtro terminar.
        var refetched = await client.GetFromJsonAsync<AudioFileDto>($"/api/audios/{created.Id}");
        Assert.NotNull(refetched);
        Assert.Equal(ProcessingStatus.Completed, refetched!.ProcessingStatus);
        Assert.Null(refetched.ProcessingError);
    }

    [Fact]
    public async Task CompressionFailure_TerminalizesFilterStatusAsFailed_WithTheSameReason()
    {
        using var factory = new FilterAppFactory(compressor: new AlwaysFailingCompressor());
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        var processed = await PollUntilProcessedAsync(client, created.Id);

        Assert.Equal(ProcessingStatus.Failed, processed.ProcessingStatus);
        Assert.False(string.IsNullOrWhiteSpace(processed.ProcessingError));

        // Espelha AudioFile.MarkProcessingFailed: sem .m4a não há o que filtrar, mesmo motivo.
        Assert.Equal(FilterStatus.Failed, processed.FilterStatus);
        Assert.Equal(processed.ProcessingError, processed.FilterError);
    }

    /// <summary>
    /// Pins the CONCLAVE correction: an exception OUTSIDE the known filter taxonomy (here
    /// InvalidOperationException, standing in for a DbUpdateException from either commit inside
    /// ApplyFilterAsync) must still only terminalize FilterStatus as Failed. It must never regress
    /// ProcessingStatus/summary, and — the part that proves the worker itself was not killed — a
    /// SUBSEQUENT upload on the SAME host must still process normally afterwards.
    /// </summary>
    [Fact]
    public async Task FilterFailure_OutsideKnownTaxonomy_DoesNotRegressCompression_AndWorkerSurvives()
    {
        var filter = new UnexpectedlyFailingAudioFilter();
        using var factory = new FilterAppFactory(filter: filter);
        var client = factory.CreateClient();

        var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample.wav", "audio/wav");
        var processed = await PollUntilProcessedAsync(client, created.Id);
        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
        Assert.Null(processed.ProcessingError);

        var filtered = await PollUntilFilterSettledAsync(client, created.Id);
        Assert.Equal(FilterStatus.Failed, filtered.FilterStatus);
        Assert.False(string.IsNullOrWhiteSpace(filtered.FilterError));

        // A falha fora da taxonomia conhecida não regride a compressão nem toca o resumo.
        var refetched = await client.GetFromJsonAsync<AudioFileDto>($"/api/audios/{created.Id}");
        Assert.NotNull(refetched);
        Assert.Equal(ProcessingStatus.Completed, refetched!.ProcessingStatus);
        Assert.Null(refetched.ProcessingError);
        Assert.Equal(processed.SummaryStatus, refetched.SummaryStatus);

        // Prova de que o worker não foi derrubado: um segundo upload no MESMO host, depois da
        // falha inesperada do filtro, ainda é processado normalmente.
        var second = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "sample2.wav", "audio/wav");
        var secondProcessed = await PollUntilProcessedAsync(client, second.Id);
        Assert.Equal(ProcessingStatus.Completed, secondProcessed.ProcessingStatus);
        Assert.Null(secondProcessed.ProcessingError);
    }

    /// <summary>
    /// While the filter is in flight, the row is observably FilterStatus.Processing — mirroring
    /// how ProcessingStatus.Processing is visible during compression — not stuck at Pending.
    /// </summary>
    [Fact]
    public async Task Filter_WhileInFlight_IsObservablyProcessing()
    {
        var filter = new BlockingAudioFilter();
        using var factory = new FilterAppFactory(filter: filter);

        try
        {
            var client = factory.CreateClient();
            var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "inflight.wav", "audio/wav");

            var processed = await PollUntilProcessedAsync(client, created.Id);
            Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
            await filter.Started.WaitAsync(TimeSpan.FromSeconds(10));

            var response = await client.GetAsync($"/api/audios/{created.Id}");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var dto = await response.Content.ReadFromJsonAsync<AudioFileDto>();
            Assert.NotNull(dto);
            Assert.Equal(FilterStatus.Processing, dto!.FilterStatus);
        }
        finally
        {
            filter.Release();
        }
    }

    /// <summary>
    /// A host shutdown while the filter step is running leaves FilterStatus at Processing (it is
    /// committed before the filter work begins, mirroring ProcessingStatus.Processing) even
    /// though ProcessingStatus already reached Completed. Pins that a restart recovers it:
    /// RecoverUnfinishedJobsAsync must re-run the filter for rows the primary ProcessingStatus
    /// recovery does not touch.
    /// </summary>
    [Fact]
    public async Task Filter_HostShutdownMidFilter_RecoversAndCompletesOnRestart()
    {
        var filter = new BlockingAudioFilter();
        var factory = new FilterAppFactory(filter: filter, deleteTempOnDispose: false);
        Guid audioId;

        try
        {
            var client = factory.CreateClient();
            var created = await UploadAsync(client, TestAudio.CreateValidWavBytes(), "shutdown.wav", "audio/wav");
            audioId = created.Id;

            var processed = await PollUntilProcessedAsync(client, created.Id);
            Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
            await filter.Started.WaitAsync(TimeSpan.FromSeconds(10));

            // Shut the host down while the filter is still mid-run (blocked awaiting Release()).
            // Host shutdown cancels the operation token, which unblocks the filter via
            // OperationCanceledException rather than a normal Release() completion.
            var shutdown = Task.Run(factory.Dispose);
            await filter.CancellationObserved.WaitAsync(TimeSpan.FromSeconds(10));
            await shutdown.WaitAsync(TimeSpan.FromSeconds(10));

            await using var connection = new SqliteConnection($"Data Source={factory.DatabasePath}");
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT FilterStatus FROM AudioFiles";
            var storedStatus = await command.ExecuteScalarAsync();
            Assert.Equal("Processing", storedStatus);

            using var recoveryFactory = new FilterAppFactory(tempDirectory: factory.TempDirectory);
            var recoveryClient = recoveryFactory.CreateClient();
            var recovered = await PollUntilFilterSettledAsync(recoveryClient, audioId);
            Assert.Equal(FilterStatus.Completed, recovered.FilterStatus);
            Assert.NotNull(recovered.FilteredUrl);
        }
        finally
        {
            filter.Release();
            if (Directory.Exists(factory.TempDirectory))
            {
                Directory.Delete(factory.TempDirectory, recursive: true);
            }
        }
    }

    private sealed class AlwaysFailingCompressor : IAudioCompressor
    {
        public async Task<CompressedAudio> CompressToAacAsync(Stream input, CancellationToken ct = default)
        {
            await input.CopyToAsync(Stream.Null, ct);
            throw new AudioCompressionException("O ffmpeg não conseguiu decodificar ou comprimir o áudio.");
        }
    }

    private sealed class AlwaysFailingAudioFilter : IAudioFilter
    {
        private readonly string _reason;

        public AlwaysFailingAudioFilter(string reason) => _reason = reason;

        public async Task<FilteredAudio> ApplyAsync(Stream input, CancellationToken ct = default)
        {
            await input.CopyToAsync(Stream.Null, ct);
            throw new AudioFilterException(_reason);
        }
    }

    private sealed class UnexpectedlyFailingAudioFilter : IAudioFilter
    {
        public async Task<FilteredAudio> ApplyAsync(Stream input, CancellationToken ct = default)
        {
            await input.CopyToAsync(Stream.Null, ct);
            throw new InvalidOperationException("Falha fora da taxonomia conhecida do filtro.");
        }
    }

    private sealed class BlockingAudioFilter : IAudioFilter
    {
        private readonly TaskCompletionSource<bool> _release =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _started =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<bool> _cancellationObserved =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task Started => _started.Task;

        public Task CancellationObserved => _cancellationObserved.Task;

        public void Release() => _release.TrySetResult(true);

        public async Task<FilteredAudio> ApplyAsync(Stream input, CancellationToken ct = default)
        {
            _started.TrySetResult(true);
            await input.CopyToAsync(Stream.Null, ct);
            try
            {
                await _release.Task.WaitAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                _cancellationObserved.TrySetResult(true);
                throw;
            }
            return new FilteredAudio(new MemoryStream([0x4D, 0x34, 0x41]), ".m4a", "audio/mp4");
        }
    }

    private sealed class FilterAppFactory : WebApplicationFactory<Program>
    {
        private readonly string _tempDir;
        private readonly IAudioFilter? _filter;
        private readonly IAudioCompressor? _compressor;
        private readonly bool _deleteTempOnDispose;

        public FilterAppFactory(
            IAudioFilter? filter = null,
            IAudioCompressor? compressor = null,
            string? tempDirectory = null,
            bool deleteTempOnDispose = true)
        {
            _tempDir = tempDirectory
                ?? Path.Combine(Path.GetTempPath(), "audioapi-filter-tests-" + Guid.NewGuid().ToString("N"));
            _filter = filter;
            _compressor = compressor;
            _deleteTempOnDispose = deleteTempOnDispose;
            Directory.CreateDirectory(_tempDir);
        }

        public string TempDirectory => _tempDir;

        public string DatabasePath => Path.Combine(_tempDir, "audios.db");

        protected override IHost CreateHost(IHostBuilder builder)
        {
            TestEnvironment.Apply(_tempDir, new Dictionary<string, string?>
            {
                ["Processing__MaxConcurrency"] = "1",
            });

            builder.UseEnvironment("Development");
            return base.CreateHost(builder);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureServices(services =>
            {
                if (_filter is not null)
                {
                    services.RemoveAll<IAudioFilter>();
                    services.AddSingleton(_filter);
                }

                if (_compressor is not null)
                {
                    services.RemoveAll<IAudioCompressor>();
                    services.AddSingleton(_compressor);
                }
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
