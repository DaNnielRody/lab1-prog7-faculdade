namespace AudioApi.Summarization;

public interface ISummaryQueue
{
    bool TryEnqueue(Guid audioId);

    IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct);
}
