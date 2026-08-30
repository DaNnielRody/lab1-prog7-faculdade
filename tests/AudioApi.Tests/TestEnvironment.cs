namespace AudioApi.Tests;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class IntegrationCollection
{
    public const string Name = "integration";
}

internal static class TestEnvironment
{
    public static void Apply(string tempDir, IReadOnlyDictionary<string, string?>? extra = null)
    {
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("Storage__LocalPath", Path.Combine(tempDir, "filestore"));
        Environment.SetEnvironmentVariable(
            "ConnectionStrings__Default", $"Data Source={Path.Combine(tempDir, "audios.db")}");
        Environment.SetEnvironmentVariable("Summarization__Enabled", "false");
        Environment.SetEnvironmentVariable("Summarization__MaxSummaryChars", null);
        Environment.SetEnvironmentVariable("Summarization__MaxConcurrency", null);
        Environment.SetEnvironmentVariable("Summarization__ExecutionMode", null);
        Environment.SetEnvironmentVariable("Processing__MaxConcurrency", null);
        Environment.SetEnvironmentVariable("Processing__QueueCapacity", null);
        Environment.SetEnvironmentVariable("Processing__ExecutionMode", null);

        if (extra is null)
        {
            return;
        }

        foreach (var (key, value) in extra)
        {
            Environment.SetEnvironmentVariable(key, value);
        }
    }
}
