namespace AudioApi.Data;

public sealed class DbWriteGate : IDbWriteGate, IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<T> WriteAsync<T>(Func<CancellationToken, Task<T>> write, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return await write(ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();
}
