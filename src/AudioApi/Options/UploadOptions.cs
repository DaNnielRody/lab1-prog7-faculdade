namespace AudioApi.Options;

public class UploadOptions
{
    public const string SectionName = "Upload";

    public static readonly string[] DefaultExtensions =
        [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".webm"];

    public long MaxSizeBytes { get; set; } = 50L * 1024 * 1024;

    public string[] AllowedExtensions { get; set; } = [];

    public IReadOnlyList<string> EffectiveExtensions =>
        AllowedExtensions.Length > 0 ? AllowedExtensions : DefaultExtensions;
}
