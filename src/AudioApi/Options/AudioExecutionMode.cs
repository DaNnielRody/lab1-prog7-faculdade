namespace AudioApi.Options;

/// <summary>
/// Selects how background jobs are consumed. The default is parallel because the production
/// pipeline is designed to use all configured compression workers. <see cref="Sequential"/>
/// exists as a first-class, reproducible baseline for performance comparisons and low-resource
/// deployments.
/// </summary>
public enum AudioExecutionMode
{
    Parallel,
    Sequential,
}
