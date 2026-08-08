namespace AudioApi.Data;

/// <summary>
/// Serializa as escritas no banco vindas dos serviços de background — o SQLite aceita um único
/// escritor por vez. O gate executa o delegate; ele nunca entrega um token de liberação, então
/// não há como esquecer de liberá-lo.
/// </summary>
public interface IDbWriteGate
{
    Task<T> WriteAsync<T>(Func<CancellationToken, Task<T>> write, CancellationToken ct = default);
}
