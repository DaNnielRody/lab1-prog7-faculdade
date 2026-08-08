namespace AudioApi.Models;

public class AudioFile
{
    public Guid Id { get; set; }

    public string OriginalFileName { get; set; } = string.Empty;

    public string StoredFileName { get; set; } = string.Empty;

    public string Url { get; set; } = string.Empty;

    public string ContentType { get; set; } = string.Empty;

    public long SizeBytes { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public ProcessingStatus ProcessingStatus { get; set; } = ProcessingStatus.Pending;

    public string? ProcessingError { get; set; }

    public DateTime? ProcessingUpdatedAtUtc { get; set; }

    public string? Summary { get; set; }

    public SummaryStatus SummaryStatus { get; set; } = SummaryStatus.Disabled;

    public string? SummaryLanguage { get; set; }

    public string? SummaryError { get; set; }

    public DateTime? SummaryUpdatedAtUtc { get; set; }

    /// <summary>
    /// A compressão falhou: sem <c>.m4a</c> nunca haverá o que resumir, então o resumo já nasce
    /// falho com o mesmo motivo. Os dois caminhos que podem falhar a compressão — fila cheia no
    /// upload e erro do worker — escrevem exatamente este estado.
    /// </summary>
    public void MarkProcessingFailed(string reason)
    {
        var now = DateTime.UtcNow;

        ProcessingStatus = ProcessingStatus.Failed;
        ProcessingError = reason;
        ProcessingUpdatedAtUtc = now;

        SummaryStatus = SummaryStatus.Failed;
        SummaryError = reason;
        SummaryUpdatedAtUtc = now;
    }
}
