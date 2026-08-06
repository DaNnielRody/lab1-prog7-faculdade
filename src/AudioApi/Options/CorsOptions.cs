namespace AudioApi.Options;

public class CorsOptions
{
    public const string SectionName = "Cors";

    public const string PolicyName = "Frontend";

    public string[] AllowedOrigins { get; set; } = ["http://localhost:3000"];
}
