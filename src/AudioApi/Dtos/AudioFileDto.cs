using AudioApi.Models;

namespace AudioApi.Dtos;

public sealed record AudioFileDto(
    Guid Id,
    string OriginalFileName,
    string StoredFileName,
    string Url,
    string ContentType,
    long SizeBytes,
    DateTime CreatedAtUtc,
    SummaryStatus SummaryStatus,
    string? Summary,
    string? SummaryLanguage,
    string? SummaryError,
    DateTime? SummaryUpdatedAtUtc,
    ProcessingStatus ProcessingStatus,
    string? ProcessingError,
    DateTime? ProcessingUpdatedAtUtc,
    FilterStatus FilterStatus,
    string? FilterError,
    DateTime? FilterUpdatedAtUtc,
    string? FilteredUrl,
    string? FilteredContentType,
    long? FilteredSizeBytes)
{
    public static AudioFileDto FromEntity(AudioFile e) => new(
        e.Id,
        e.OriginalFileName,
        e.StoredFileName,
        e.Url,
        e.ContentType,
        e.SizeBytes,
        e.CreatedAtUtc,
        e.SummaryStatus,
        e.Summary,
        e.SummaryLanguage,
        e.SummaryError,
        e.SummaryUpdatedAtUtc,
        e.ProcessingStatus,
        e.ProcessingError,
        e.ProcessingUpdatedAtUtc,
        e.FilterStatus,
        e.FilterError,
        e.FilterUpdatedAtUtc,
        e.FilteredUrl,
        e.FilteredContentType,
        e.FilteredSizeBytes);
}
