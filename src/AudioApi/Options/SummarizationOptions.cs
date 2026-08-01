namespace AudioApi.Options;

public class SummarizationOptions
{
    public const string SectionName = "Summarization";

    public const int MaxSummaryCharsCeiling = 500;

    public bool Enabled { get; set; }

    public string Endpoint { get; set; } = "http://localhost:9000";

    public string ApiKey { get; set; } = string.Empty;

    public int TimeoutSeconds { get; set; } = 300;

    public int MaxSummaryChars { get; set; } = MaxSummaryCharsCeiling;

    public int MaxConcurrency { get; set; } = 1;

    public int QueueCapacity { get; set; } = 100;

    public int EffectiveMaxSummaryChars =>
        Math.Clamp(MaxSummaryChars <= 0 ? MaxSummaryCharsCeiling : MaxSummaryChars, 1, MaxSummaryCharsCeiling);
}
