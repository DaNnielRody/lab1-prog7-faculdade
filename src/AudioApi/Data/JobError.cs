namespace AudioApi.Data;

/// <summary>
/// O motivo de um job de background ter falhado, do jeito que ele cabe nas colunas
/// <c>ProcessingError</c>/<c>SummaryError</c>. O teto vive aqui e é o mesmo que o
/// <see cref="AppDbContext"/> configura nas duas colunas, então ele não tem como divergir.
/// </summary>
public static class JobError
{
    public const int MaxChars = 1024;

    public static string Clamp(string message) =>
        message.Length <= MaxChars ? message : message[..MaxChars];
}
