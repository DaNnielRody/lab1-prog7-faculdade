using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Storage;

public class LocalFileStore : IFileStore
{
    private readonly string _rootPath;
    private readonly ILogger<LocalFileStore> _logger;

    public LocalFileStore(
        IOptions<StorageOptions> options,
        IHostEnvironment env,
        ILogger<LocalFileStore> logger)
    {
        _logger = logger;

        var configured = options.Value.LocalPath;
        _rootPath = Path.IsPathRooted(configured)
            ? configured
            : Path.GetFullPath(Path.Combine(env.ContentRootPath, configured));

        Directory.CreateDirectory(_rootPath);
        _logger.LogInformation("LocalFileStore root directory: {RootPath}", _rootPath);
    }

    public async Task<StoredFile> SaveAsync(Guid id, string extension, Stream content, string baseUrl, CancellationToken ct = default)
    {
        var storedFileName = $"{id:N}{extension}";
        var fullPath = Path.Combine(_rootPath, storedFileName);

        await using (var target = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            await content.CopyToAsync(target, ct);
        }

        var size = new FileInfo(fullPath).Length;
        var url = $"{baseUrl.TrimEnd('/')}/api/audios/{id}/download";

        _logger.LogInformation("Stored file {StoredFileName} ({Size} bytes) at {Path}", storedFileName, size, fullPath);
        return new StoredFile(storedFileName, url, size);
    }

    public Task<FileContent?> OpenReadAsync(string storedFileName, string contentType, CancellationToken ct = default)
    {
        var safeName = Path.GetFileName(storedFileName);
        var fullPath = Path.Combine(_rootPath, safeName);

        if (!File.Exists(fullPath))
        {
            return Task.FromResult<FileContent?>(null);
        }

        Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Task.FromResult<FileContent?>(new FileContent(stream, contentType));
    }
}
