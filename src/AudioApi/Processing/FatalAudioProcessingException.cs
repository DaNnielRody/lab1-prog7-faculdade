namespace AudioApi.Processing;

public sealed class FatalAudioProcessingException : Exception
{
    public FatalAudioProcessingException() : base("The audio processing worker encountered a fatal error.")
    {
    }
}
