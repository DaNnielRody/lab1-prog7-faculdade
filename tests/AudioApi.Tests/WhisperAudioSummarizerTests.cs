using System.Net;
using System.Text;
using System.Text.Json;
using AudioApi.Options;
using AudioApi.Summarization;
using Microsoft.Extensions.Logging.Abstractions;

namespace AudioApi.Tests;

public class WhisperAudioSummarizerTests
{
    private const int Max = SummarizationOptions.MaxSummaryCharsCeiling;

    private static WhisperAudioSummarizer CreateSummarizer(HttpStatusCode status, string body)
    {
        var handler = new StubHandler(status, body);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost:9000/") };

        return new WhisperAudioSummarizer(
            http,
            Microsoft.Extensions.Options.Options.Create(new SummarizationOptions { Enabled = true }),
            NullLogger<WhisperAudioSummarizer>.Instance);
    }

    private static string WorkerJson(string summary, string language = "pt", int transcriptChars = 12_345)
        => JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["summary"] = summary,
            ["language"] = language,
            ["transcript_chars"] = transcriptChars,
            ["model"] = "tiny",
        });

    private static Task<AudioSummary> SummarizeAsync(WhisperAudioSummarizer summarizer)
    {
        var audio = new MemoryStream(TestAudio.CreateValidWavBytes());
        return summarizer.SummarizeAsync(audio, "clip.wav", "audio/mp4", Max);
    }

    [Fact]
    public async Task SummarizeAsync_WorkerReturnsOversizedSummary_ResultIsClampedTo500Chars()
    {
        var oversized = new string('x', 5_000);
        var summarizer = CreateSummarizer(HttpStatusCode.OK, WorkerJson(oversized));

        var result = await SummarizeAsync(summarizer);

        Assert.True(
            result.Summary.Length <= Max,
            $"Resumo tem {result.Summary.Length} caracteres, acima do limite de {Max}.");
    }

    [Fact]
    public async Task SummarizeAsync_WorkerRespectsLimit_SummaryIsPassedThrough()
    {
        var summarizer = CreateSummarizer(HttpStatusCode.OK, WorkerJson("O áudio fala sobre threading em ASP.NET Core."));

        var result = await SummarizeAsync(summarizer);

        Assert.Equal("O áudio fala sobre threading em ASP.NET Core.", result.Summary);
        Assert.Equal("pt", result.Language);
        Assert.Equal(12_345, result.TranscriptChars);
        Assert.True(result.Summary.Length <= Max);
    }

    [Fact]
    public async Task SummarizeAsync_WorkerReturnsError_Throws()
    {
        var summarizer = CreateSummarizer(HttpStatusCode.ServiceUnavailable, "modelo indisponível");

        await Assert.ThrowsAsync<InvalidOperationException>(() => SummarizeAsync(summarizer));
    }

    [Fact]
    public async Task SummarizeAsync_WorkerReturnsEmptySummary_Throws()
    {
        var summarizer = CreateSummarizer(HttpStatusCode.OK, WorkerJson("   "));

        await Assert.ThrowsAsync<InvalidOperationException>(() => SummarizeAsync(summarizer));
    }

    [Fact]
    public async Task SummarizeAsync_WorkerReturnsInvalidJson_Throws()
    {
        var summarizer = CreateSummarizer(HttpStatusCode.OK, "isto não é json");

        await Assert.ThrowsAsync<InvalidOperationException>(() => SummarizeAsync(summarizer));
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _status;
        private readonly string _body;

        public StubHandler(HttpStatusCode status, string body)
        {
            _status = status;
            _body = body;
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Content is not null)
            {
                await request.Content.LoadIntoBufferAsync(cancellationToken);
            }

            return new HttpResponseMessage(_status)
            {
                Content = new StringContent(_body, Encoding.UTF8, "application/json"),
            };
        }
    }
}
