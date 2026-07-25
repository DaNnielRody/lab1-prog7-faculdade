using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using AudioApi.Dtos;
using AudioApi.Models;
using AudioApi.Options;
using AudioApi.Summarization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace AudioApi.Tests;

[Collection(IntegrationCollection.Name)]
public class AudioSummaryIntegrationTests
{
    private const int Max = SummarizationOptions.MaxSummaryCharsCeiling;

    private static async Task<AudioFileDto> UploadWavAsync(HttpClient client)
    {
        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(TestAudio.CreateValidWavBytes());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        content.Add(fileContent, "file", "sample.wav");

        var post = await client.PostAsync("/api/audios", content);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<AudioFileDto>();
        Assert.NotNull(created);
        return created!;
    }

    private static async Task<AudioSummaryDto> PollUntilSettledAsync(HttpClient client, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);

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

        throw new TimeoutException($"O resumo do áudio {id} não foi concluído em 30s.");
    }

    [Fact]
    public async Task Upload_WithSummarizationEnabled_StoresSummaryWithin500Chars()
    {
        using var factory = new SummaryAppFactory(summarizationEnabled: true, summarizerSummary: new string('x', 5_000));
        var client = factory.CreateClient();

        var created = await UploadWavAsync(client);
        Assert.Equal(SummaryStatus.Pending, created.SummaryStatus);
        Assert.Null(created.Summary);

        var summary = await PollUntilSettledAsync(client, created.Id);

        Assert.Equal(SummaryStatus.Completed, summary.Status);
        Assert.Null(summary.Error);
        Assert.NotNull(summary.Summary);
        Assert.True(
            summary.Summary!.Length <= Max,
            $"Resumo persistido tem {summary.Summary.Length} caracteres, acima do limite de {Max}.");
        Assert.Equal(summary.Summary.Length, summary.SummaryLength);
        Assert.Equal(Max, summary.MaxSummaryLength);
        Assert.Equal("pt", summary.Language);
    }

    [Fact]
    public async Task Upload_WithSummarizationEnabled_ShortSummaryIsStoredIntact()
    {
        const string expected = "O áudio discute a fila de sumarização em background.";

        using var factory = new SummaryAppFactory(summarizationEnabled: true, summarizerSummary: expected);
        var client = factory.CreateClient();

        var created = await UploadWavAsync(client);
        var summary = await PollUntilSettledAsync(client, created.Id);

        Assert.Equal(SummaryStatus.Completed, summary.Status);
        Assert.Equal(expected, summary.Summary);
        Assert.True(summary.Summary!.Length <= Max);
    }

    [Fact]
    public async Task Upload_WithSummarizationEnabled_SummarizerFailureIsRecordedNotThrown()
    {
        using var factory = new SummaryAppFactory(summarizationEnabled: true, summarizerSummary: null);
        var client = factory.CreateClient();

        var created = await UploadWavAsync(client);
        Assert.Equal(SummaryStatus.Pending, created.SummaryStatus);

        var summary = await PollUntilSettledAsync(client, created.Id);

        Assert.Equal(SummaryStatus.Failed, summary.Status);
        Assert.Null(summary.Summary);
        Assert.NotNull(summary.Error);
    }

    [Fact]
    public async Task Upload_WithSummarizationDisabled_ReportsDisabledAndNeverQueues()
    {
        using var factory = new SummaryAppFactory(summarizationEnabled: false, summarizerSummary: null);
        var client = factory.CreateClient();

        var created = await UploadWavAsync(client);

        Assert.Equal(SummaryStatus.Disabled, created.SummaryStatus);
        Assert.Null(created.Summary);

        var response = await client.GetAsync($"/api/audios/{created.Id}/summary");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var summary = await response.Content.ReadFromJsonAsync<AudioSummaryDto>();
        Assert.NotNull(summary);
        Assert.Equal(SummaryStatus.Disabled, summary!.Status);
        Assert.Null(summary.Summary);
        Assert.Equal(0, summary.SummaryLength);
        Assert.Equal(Max, summary.MaxSummaryLength);
    }

    [Fact]
    public async Task GetSummary_MissingId_Returns404()
    {
        using var factory = new SummaryAppFactory(summarizationEnabled: false, summarizerSummary: null);
        var client = factory.CreateClient();

        var response = await client.GetAsync($"/api/audios/{Guid.NewGuid()}/summary");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
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

    private sealed class SummaryAppFactory : WebApplicationFactory<Program>
    {
        private readonly string _tempDir =
            Path.Combine(Path.GetTempPath(), "audioapi-summary-tests-" + Guid.NewGuid().ToString("N"));

        private readonly bool _summarizationEnabled;
        private readonly string? _summarizerSummary;

        public SummaryAppFactory(bool summarizationEnabled, string? summarizerSummary)
        {
            _summarizationEnabled = summarizationEnabled;
            _summarizerSummary = summarizerSummary;
            Directory.CreateDirectory(_tempDir);
        }

        protected override IHost CreateHost(IHostBuilder builder)
        {
            TestEnvironment.Apply(_tempDir, new Dictionary<string, string?>
            {
                ["Summarization__Enabled"] = _summarizationEnabled ? "true" : "false",
                ["Summarization__MaxSummaryChars"] = Max.ToString(),
                ["Summarization__MaxConcurrency"] = "1",
            });

            builder.UseEnvironment("Development");
            return base.CreateHost(builder);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IAudioSummarizer>();
                services.AddSingleton<IAudioSummarizer>(_ => new FakeAudioSummarizer(_summarizerSummary));
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
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
