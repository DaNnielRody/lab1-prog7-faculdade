namespace AudioApi.Compression;

/// <summary>
/// A known, item-scoped ffmpeg failure while applying the voice-enhancement filter chain. Mirrors
/// <see cref="AudioCompressionException"/>: permanent for that upload, so the worker marks only the
/// filter state as Failed and does not retry, and compression/summary are unaffected.
/// </summary>
public sealed class AudioFilterException : Exception
{
    public AudioFilterException(string message) : base(message)
    {
    }
}
