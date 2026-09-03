using AudioApi.Compression;
using AudioApi.Options;
using Microsoft.Extensions.Logging.Abstractions;

namespace AudioApi.Tests;

/// <summary>
/// Mirrors <see cref="FfmpegAudioCompressorTests"/>: a real ffmpeg run of the voice-enhancement
/// filter chain against the deterministic WAV fixture, same shape as the compressor's own tests.
/// </summary>
public class FfmpegAudioFilterTests
{
    private static FfmpegAudioFilter CreateFilter() =>
        new(Microsoft.Extensions.Options.Options.Create(new AudioFilterOptions()), NullLogger<FfmpegAudioFilter>.Instance);

    [Fact]
    public async Task ApplyAsync_ValidWav_ProducesAacM4aOutput()
    {
        var filter = CreateFilter();
        var wavBytes = TestAudio.CreateValidWavBytes();

        using var input = new MemoryStream(wavBytes);
        var result = await filter.ApplyAsync(input);

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
    public async Task ApplyAsync_NotDecodableAudio_Throws()
    {
        var filter = CreateFilter();
        var garbage = new byte[1024];
        new Random(7).NextBytes(garbage);

        using var input = new MemoryStream(garbage);

        await Assert.ThrowsAsync<AudioFilterException>(() => filter.ApplyAsync(input));
    }
}
