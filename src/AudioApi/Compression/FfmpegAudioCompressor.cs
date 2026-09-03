using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Compression;

public class FfmpegAudioCompressor : IAudioCompressor
{
    private readonly CompressionOptions _options;
    private readonly ILogger<FfmpegAudioCompressor> _logger;

    public FfmpegAudioCompressor(IOptions<CompressionOptions> options, ILogger<FfmpegAudioCompressor> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task<CompressedAudio> CompressToAacAsync(Stream input, CancellationToken ct = default)
    {
        var result = await FfmpegProcessRunner.RunAsync(
            _options.FfmpegPath,
            input,
            (inputPath, outputPath) =>
            [
                "-y", "-i", inputPath, "-vn",
                "-c:a", "aac", "-b:a", $"{_options.BitrateKbps}k",
                "-movflags", "+faststart", outputPath,
            ],
            ".m4a",
            _logger,
            ct);

        if (result.ExitCode != 0)
        {
            _logger.LogError(
                "Falha ao comprimir áudio para AAC: ffmpeg saiu com código {ExitCode} em {ElapsedMs}ms.",
                result.ExitCode, result.ElapsedMs);
            throw new AudioCompressionException(
                $"O ffmpeg não conseguiu decodificar ou comprimir o áudio (código {result.ExitCode}).");
        }

        _logger.LogInformation(
            "Áudio comprimido para AAC em {ElapsedMs}ms (entrada: {InputBytes} bytes, saída: {OutputBytes} bytes, taxa: {BitrateKbps}kbps)",
            result.ElapsedMs, result.InputSizeBytes, result.OutputSizeBytes, _options.BitrateKbps);

        return new CompressedAudio(result.OutputStream!, ".m4a", "audio/mp4");
    }
}
