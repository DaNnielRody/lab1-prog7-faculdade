using System.Diagnostics;

namespace AudioApi.Compression;

/// <summary>
/// Shared ffmpeg-process plumbing for <see cref="FfmpegAudioCompressor"/> and
/// <see cref="FfmpegAudioFilter"/>: stages the input to a temp file, runs ffmpeg with the
/// caller-built argument list, drains stdout/stderr, kills the process tree on cancellation, and
/// hands back the output as a DeleteOnClose stream. What legitimately varies between compression
/// and filtering — the arguments themselves, the options type, the exception thrown on a non-zero
/// exit, and the log message text — stays with each caller.
/// </summary>
internal static class FfmpegProcessRunner
{
    public readonly record struct Result(
        int ExitCode, Stream? OutputStream, long InputSizeBytes, long OutputSizeBytes, long ElapsedMs);

    public static async Task<Result> RunAsync(
        string ffmpegPath,
        Stream input,
        Func<string, string, IEnumerable<string>> buildArguments,
        string outputExtension,
        ILogger logger,
        CancellationToken ct)
    {
        var inputPath = Path.GetTempFileName();
        var outputPath = Path.ChangeExtension(Path.GetTempFileName(), outputExtension);

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
                FileName = ffmpegPath,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            foreach (var arg in buildArguments(inputPath, outputPath))
            {
                startInfo.ArgumentList.Add(arg);
            }

            using var process = new Process { StartInfo = startInfo };
            process.Start();

            var stderrTask = process.StandardError.ReadToEndAsync(ct);
            var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
            try
            {
                await process.WaitForExitAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync(CancellationToken.None);
                }
                throw;
            }
            await stderrTask;
            await stdoutTask;

            stopwatch.Stop();

            if (process.ExitCode != 0)
            {
                return new Result(process.ExitCode, null, inputSizeBytes, 0, stopwatch.ElapsedMilliseconds);
            }

            var outputSizeBytes = new FileInfo(outputPath).Length;
            var outputStream = new FileStream(
                outputPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 4096,
                FileOptions.DeleteOnClose);

            return new Result(0, outputStream, inputSizeBytes, outputSizeBytes, stopwatch.ElapsedMilliseconds);
        }
        finally
        {
            DeleteTemporaryFile(outputPath, logger);
            DeleteTemporaryFile(inputPath, logger);
        }
    }

    private static void DeleteTemporaryFile(string path, ILogger logger)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning("Não foi possível remover arquivo temporário ({ExceptionType}).", ex.GetType().Name);
        }
    }
}
