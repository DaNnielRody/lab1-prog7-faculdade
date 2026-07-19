namespace AudioApi.Compression;

public sealed record CompressedAudio(Stream Stream, string Extension, string ContentType);

public interface IAudioCompressor
{
    Task<CompressedAudio> CompressToAacAsync(Stream input, CancellationToken ct = default);
}
