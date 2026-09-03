using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Compression;

public class FfmpegAudioFilter : IAudioFilter
{
    private readonly AudioFilterOptions _options;
    private readonly ILogger<FfmpegAudioFilter> _logger;

    public FfmpegAudioFilter(IOptions<AudioFilterOptions> options, ILogger<FfmpegAudioFilter> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task<FilteredAudio> ApplyAsync(Stream input, CancellationToken ct = default)
    {
        var result = await FfmpegProcessRunner.RunAsync(
            _options.FfmpegPath,
            input,
            (inputPath, outputPath) =>
            [
                "-y", "-i", inputPath, "-vn",
                "-af", _options.FilterChain,
                "-c:a", "aac", "-b:a", $"{_options.BitrateKbps}k",
                "-movflags", "+faststart", outputPath,
            ],
            ".m4a",
            _logger,
            ct);

        if (result.ExitCode != 0)
        {
            _logger.LogError(
                "Falha ao aplicar filtro de realce de voz: ffmpeg saiu com código {ExitCode} em {ElapsedMs}ms.",
                result.ExitCode, result.ElapsedMs);
            throw new AudioFilterException(
                $"O ffmpeg não conseguiu aplicar o filtro de realce de voz (código {result.ExitCode}).");
        }

        _logger.LogInformation(
            "Filtro de realce de voz aplicado em {ElapsedMs}ms (entrada: {InputBytes} bytes, saída: {OutputBytes} bytes, taxa: {BitrateKbps}kbps)",
            result.ElapsedMs, result.InputSizeBytes, result.OutputSizeBytes, _options.BitrateKbps);

        return new FilteredAudio(result.OutputStream!, ".m4a", "audio/mp4");
    }
}
