using AudioApi.Models;

namespace AudioApi.Dtos;

public sealed record AudioSummaryDto(
    Guid Id,
    SummaryStatus Status,
    string? Summary,
    int SummaryLength,
    int MaxSummaryLength,
    string? Language,
    string? Error,
    DateTime? UpdatedAtUtc,
    ProcessingStatus ProcessingStatus,
    string? ProcessingError)
{
    public static AudioSummaryDto FromEntity(AudioFile e, int maxSummaryLength) => new(
        e.Id,
        e.SummaryStatus,
        e.Summary,
        e.Summary?.Length ?? 0,
        maxSummaryLength,
        e.SummaryLanguage,
        e.SummaryError,
        e.SummaryUpdatedAtUtc,
        e.ProcessingStatus,
        e.ProcessingError);
}
