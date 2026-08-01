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

    public string? Summary { get; set; }

    public SummaryStatus SummaryStatus { get; set; } = SummaryStatus.Disabled;

    public string? SummaryLanguage { get; set; }

    public string? SummaryError { get; set; }

    public DateTime? SummaryUpdatedAtUtc { get; set; }
}
