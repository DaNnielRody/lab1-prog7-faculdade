namespace AudioApi.Options;

public class ProcessingOptions
{
    public const string SectionName = "Processing";

    /// <summary>
    /// Quantos <c>ffmpeg</c> podem rodar ao mesmo tempo. Ausente, nulo ou ≤ 0 significa
    /// "o número de processadores da máquina" — o valor certo depende do host, não do arquivo de
    /// configuração, e é por isso que o padrão não é um literal. Use
    /// <see cref="EffectiveMaxConcurrency"/>, nunca esta propriedade.
    /// </summary>
    public int? MaxConcurrency { get; set; }

    public int QueueCapacity { get; set; } = 100;

    public int EffectiveMaxConcurrency =>
        MaxConcurrency is > 0 ? MaxConcurrency.Value : Math.Max(1, Environment.ProcessorCount);
}
