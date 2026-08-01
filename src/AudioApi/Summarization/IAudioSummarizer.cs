namespace AudioApi.Summarization;

public sealed record AudioSummary(string Summary, string? Language, int TranscriptChars);

public interface IAudioSummarizer
{
    Task<AudioSummary> SummarizeAsync(
        Stream audio,
        string fileName,
        string contentType,
        int maxChars,
        CancellationToken ct = default);
}
