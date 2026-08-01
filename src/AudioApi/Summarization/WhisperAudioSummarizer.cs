using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Summarization;

public sealed class WhisperAudioSummarizer : IAudioSummarizer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly SummarizationOptions _options;
    private readonly ILogger<WhisperAudioSummarizer> _logger;

    public WhisperAudioSummarizer(
        HttpClient http,
        IOptions<SummarizationOptions> options,
        ILogger<WhisperAudioSummarizer> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<AudioSummary> SummarizeAsync(
        Stream audio,
        string fileName,
        string contentType,
        int maxChars,
        CancellationToken ct = default)
    {
        using var form = new MultipartFormDataContent();

        var fileContent = new StreamContent(audio);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
            string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType);
        form.Add(fileContent, "file", Path.GetFileName(fileName));
        form.Add(new StringContent(maxChars.ToString(CultureInfo.InvariantCulture)), "max_chars");

        using var request = new HttpRequestMessage(HttpMethod.Post, "summarize") { Content = form };
        if (!string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            request.Headers.TryAddWithoutValidation("X-API-Key", _options.ApiKey);
        }

        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await ReadErrorBodyAsync(response, ct);
            _logger.LogError(
                "Worker de resumo respondeu {StatusCode} para {FileName}. Corpo: {Body}",
                (int)response.StatusCode, fileName, body);
            throw new InvalidOperationException(
                $"O worker de resumo respondeu {(int)response.StatusCode}: {body}");
        }

        WorkerResponse? payload;
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            payload = await JsonSerializer.DeserializeAsync<WorkerResponse>(stream, JsonOptions, ct);
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException("O worker de resumo respondeu um JSON inválido.", ex);
        }

        if (payload is null || string.IsNullOrWhiteSpace(payload.Summary))
        {
            throw new InvalidOperationException("O worker de resumo respondeu um resumo vazio.");
        }

        var clamped = SummaryTruncator.Clamp(payload.Summary, maxChars);

        if (clamped.Length < payload.Summary.Trim().Length)
        {
            _logger.LogWarning(
                "Resumo do worker excedia o limite e foi truncado: {WorkerChars} → {ClampedChars} caracteres (limite {MaxChars}).",
                payload.Summary.Length, clamped.Length, maxChars);
        }

        _logger.LogInformation(
            "Resumo gerado para {FileName}: {SummaryChars} caracteres a partir de {TranscriptChars} de transcrição (idioma: {Language}, modelo: {Model}).",
            fileName, clamped.Length, payload.TranscriptChars, payload.Language ?? "?", payload.Model ?? "?");

        return new AudioSummary(clamped, payload.Language, payload.TranscriptChars);
    }

    private static async Task<string> ReadErrorBodyAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length <= 500 ? body : body[..500];
        }
        catch (Exception ex) when (ex is IOException or HttpRequestException or OperationCanceledException)
        {
            return "<corpo indisponível>";
        }
    }

    private sealed record WorkerResponse
    {
        [JsonPropertyName("summary")]
        public string? Summary { get; init; }

        [JsonPropertyName("language")]
        public string? Language { get; init; }

        [JsonPropertyName("transcript_chars")]
        public int TranscriptChars { get; init; }

        [JsonPropertyName("model")]
        public string? Model { get; init; }
    }
}
