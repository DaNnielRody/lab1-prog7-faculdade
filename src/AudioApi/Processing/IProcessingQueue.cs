namespace AudioApi.Processing;

public interface IProcessingQueue
{
    bool TryReserve(out IProcessingQueueAdmission? admission);

    bool TryEnqueue(Guid audioId);

    IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct);

    void Complete();
}

public interface IProcessingQueueAdmission : IDisposable
{
    void Enqueue(Guid audioId);
}
