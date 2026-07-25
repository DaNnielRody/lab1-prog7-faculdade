namespace AudioApi.Options;

public class CompressionOptions
{
    public const string SectionName = "Compression";

    public string FfmpegPath { get; set; } = "ffmpeg";

    public int BitrateKbps { get; set; } = 128;
}
