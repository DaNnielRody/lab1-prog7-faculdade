using AudioApi.Models;

namespace AudioApi.Dtos;

public sealed record AudioFileDto(
    Guid Id,
    string OriginalFileName,
    string StoredFileName,
    string Url,
    string ContentType,
    long SizeBytes,
    DateTime CreatedAtUtc)
{
    public static AudioFileDto FromEntity(AudioFile e) => new(
        e.Id,
        e.OriginalFileName,
        e.StoredFileName,
        e.Url,
        e.ContentType,
        e.SizeBytes,
        e.CreatedAtUtc);
}
