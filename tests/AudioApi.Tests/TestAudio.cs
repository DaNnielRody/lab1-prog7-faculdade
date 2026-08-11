using AudioApi.Compression;
using Microsoft.Extensions.Logging.Abstractions;
using CompressionOptions = AudioApi.Options.CompressionOptions;

namespace AudioApi.Tests;

internal static class TestAudio
{
    /// <summary>
    /// Builds a real AAC/M4A file by running the same ffmpeg pipeline the API uses, so a test can
    /// upload an audio whose extension already equals the compressed output extension.
    /// </summary>
    public static async Task<byte[]> CreateValidM4aBytesAsync(int sampleCount = 4000, int sampleRateHz = 8000)
    {
        var compressor = new FfmpegAudioCompressor(
            Microsoft.Extensions.Options.Options.Create(new CompressionOptions()),
            NullLogger<FfmpegAudioCompressor>.Instance);

        using var input = new MemoryStream(CreateValidWavBytes(sampleCount, sampleRateHz));
        var result = await compressor.CompressToAacAsync(input);

        await using (result.Stream)
        {
            using var output = new MemoryStream();
            await result.Stream.CopyToAsync(output);
            return output.ToArray();
        }
    }

    /// <summary>Builds a minimal valid PCM WAV file (mono, 16-bit, silence) so ffmpeg can decode it.</summary>
    public static byte[] CreateValidWavBytes(int sampleCount = 4000, int sampleRateHz = 8000)
    {
        const short channels = 1;
        const short bitsPerSample = 16;
        var blockAlign = (short)(channels * (bitsPerSample / 8));
        var byteRate = sampleRateHz * blockAlign;
        var dataSize = sampleCount * blockAlign;

        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);

        writer.Write("RIFF"u8.ToArray());
        writer.Write(36 + dataSize);
        writer.Write("WAVE"u8.ToArray());

        writer.Write("fmt "u8.ToArray());
        writer.Write(16);
        writer.Write((short)1); // PCM
        writer.Write(channels);
        writer.Write(sampleRateHz);
        writer.Write(byteRate);
        writer.Write(blockAlign);
        writer.Write(bitsPerSample);

        writer.Write("data"u8.ToArray());
        writer.Write(dataSize);

        var rng = new Random(1234);
        for (var i = 0; i < sampleCount; i++)
        {
            writer.Write((short)rng.Next(short.MinValue / 4, short.MaxValue / 4));
        }

        writer.Flush();
        return stream.ToArray();
    }
}
