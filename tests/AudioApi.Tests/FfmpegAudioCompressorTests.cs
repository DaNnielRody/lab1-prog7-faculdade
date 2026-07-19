using AudioApi.Compression;
using CompressionOptions = AudioApi.Options.CompressionOptions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AudioApi.Tests;

public class FfmpegAudioCompressorTests
{
    private static FfmpegAudioCompressor CreateCompressor() =>
        new(Microsoft.Extensions.Options.Options.Create(new CompressionOptions()), NullLogger<FfmpegAudioCompressor>.Instance);

    [Fact]
    public async Task CompressToAacAsync_ValidWav_ProducesAacM4aOutput()
    {
        var compressor = CreateCompressor();
        var wavBytes = TestAudio.CreateValidWavBytes();

        using var input = new MemoryStream(wavBytes);
        var result = await compressor.CompressToAacAsync(input);

        try
        {
            Assert.Equal(".m4a", result.Extension);
            Assert.Equal("audio/mp4", result.ContentType);

            using var output = new MemoryStream();
            await result.Stream.CopyToAsync(output);
            var outputBytes = output.ToArray();

            Assert.True(outputBytes.Length > 0);
            var header = System.Text.Encoding.ASCII.GetString(outputBytes, 4, 8);
            Assert.Contains("ftyp", header);
        }
        finally
        {
            await result.Stream.DisposeAsync();
        }
    }

    [Fact]
    public async Task CompressToAacAsync_NotDecodableAudio_Throws()
    {
        var compressor = CreateCompressor();
        var garbage = new byte[1024];
        new Random(7).NextBytes(garbage);

        using var input = new MemoryStream(garbage);

        await Assert.ThrowsAsync<InvalidOperationException>(() => compressor.CompressToAacAsync(input));
    }
}
