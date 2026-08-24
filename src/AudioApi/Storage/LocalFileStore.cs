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
        var temporaryPath = Path.Combine(
            _rootPath, $".{storedFileName}.{Guid.NewGuid():N}.uploading");

        try
        {
            await using (var target = new FileStream(
                temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await content.CopyToAsync(target, ct);
            }

            File.Move(temporaryPath, fullPath, overwrite: true);
        }
        catch
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
            {
                _logger.LogWarning(
                    "Não foi possível remover um arquivo temporário incompleto ({ExceptionType}).",
                    cleanupException.GetType().Name);
            }

            throw;
        }

        var size = new FileInfo(fullPath).Length;
        var url = $"{baseUrl.TrimEnd('/')}/api/audios/{id}/download";

        _logger.LogInformation("Stored file {StoredFileName} ({Size} bytes)", storedFileName, size);
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

    public Task DeleteAsync(string storedFileName, CancellationToken ct = default)
    {
        var safeName = Path.GetFileName(storedFileName);
        var fullPath = Path.Combine(_rootPath, safeName);

        if (!File.Exists(fullPath))
        {
            return Task.CompletedTask;
        }

        File.Delete(fullPath);
        _logger.LogInformation("Deleted file {StoredFileName}", safeName);
        return Task.CompletedTask;
    }
}
