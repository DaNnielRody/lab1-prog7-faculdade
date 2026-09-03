namespace AudioApi.Options;

public class AudioFilterOptions
{
    public const string SectionName = "AudioFilter";

    public string FfmpegPath { get; set; } = "ffmpeg";

    public int BitrateKbps { get; set; } = 128;

    public string FilterChain { get; set; } = "highpass=f=200,lowpass=f=3000,dynaudnorm";
}
