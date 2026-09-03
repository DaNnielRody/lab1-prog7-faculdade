namespace AudioApi.Compression;

public sealed record FilteredAudio(Stream Stream, string Extension, string ContentType);

public interface IAudioFilter
{
    Task<FilteredAudio> ApplyAsync(Stream input, CancellationToken ct = default);
}
