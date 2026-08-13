namespace AudioApi.Compression;

/// <summary>
/// A known, item-scoped ffmpeg failure. Invalid or unsupported input and a non-zero ffmpeg exit
/// are permanent for that upload, so the worker marks only that audio as Failed and does not retry.
/// Process startup/configuration failures deliberately keep their native exception types and are
/// treated as fatal infrastructure errors by the worker.
/// </summary>
public sealed class AudioCompressionException : Exception
{
    public AudioCompressionException(string message) : base(message)
    {
    }
}
