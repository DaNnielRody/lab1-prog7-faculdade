namespace AudioApi.Storage;

public sealed record StoredFile(string StoredFileName, string Url, long SizeBytes);

public sealed record FileContent(Stream Stream, string ContentType);

public interface IFileStore
{
    Task<StoredFile> SaveAsync(Guid id, string extension, Stream content, string baseUrl, CancellationToken ct = default);

    Task<FileContent?> OpenReadAsync(string storedFileName, string contentType, CancellationToken ct = default);
}
