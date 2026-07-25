using System.Diagnostics;
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
        var inputPath = Path.GetTempFileName();
        var outputPath = Path.ChangeExtension(Path.GetTempFileName(), ".m4a");

        try
        {
            await using (var inputFile = new FileStream(inputPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                await input.CopyToAsync(inputFile, ct);
            }

            var inputSizeBytes = new FileInfo(inputPath).Length;
            var stopwatch = Stopwatch.StartNew();

            var startInfo = new ProcessStartInfo
            {
                FileName = _options.FfmpegPath,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add("-y");
            startInfo.ArgumentList.Add("-i");
            startInfo.ArgumentList.Add(inputPath);
            startInfo.ArgumentList.Add("-vn");
            startInfo.ArgumentList.Add("-c:a");
            startInfo.ArgumentList.Add("aac");
            startInfo.ArgumentList.Add("-b:a");
            startInfo.ArgumentList.Add($"{_options.BitrateKbps}k");
            startInfo.ArgumentList.Add("-movflags");
            startInfo.ArgumentList.Add("+faststart");
            startInfo.ArgumentList.Add(outputPath);

            using var process = new Process { StartInfo = startInfo };
            process.Start();

            var stderrTask = process.StandardError.ReadToEndAsync(ct);
            var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            var stderr = await stderrTask;
            await stdoutTask;

            stopwatch.Stop();

            if (process.ExitCode != 0)
            {
                _logger.LogError(
                    "Falha ao comprimir áudio para AAC (ffmpeg saiu com código {ExitCode}) em {ElapsedMs}ms. Stderr: {Stderr}",
                    process.ExitCode, stopwatch.ElapsedMilliseconds, stderr);
                throw new InvalidOperationException($"ffmpeg falhou ao comprimir o áudio (código {process.ExitCode}).");
            }

            var outputSizeBytes = new FileInfo(outputPath).Length;
            _logger.LogInformation(
                "Áudio comprimido para AAC em {ElapsedMs}ms (entrada: {InputBytes} bytes, saída: {OutputBytes} bytes, taxa: {BitrateKbps}kbps)",
                stopwatch.ElapsedMilliseconds, inputSizeBytes, outputSizeBytes, _options.BitrateKbps);

            var outputStream = new FileStream(
                outputPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 4096,
                FileOptions.DeleteOnClose);

            return new CompressedAudio(outputStream, ".m4a", "audio/mp4");
        }
        catch
        {
            if (File.Exists(outputPath))
            {
                File.Delete(outputPath);
            }

            throw;
        }
        finally
        {
            if (File.Exists(inputPath))
            {
                File.Delete(inputPath);
            }
        }
    }
}
