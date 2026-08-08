namespace AudioApi.Processing;

public interface IProcessingQueue
{
    bool TryEnqueue(Guid audioId);

    IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct);
}
