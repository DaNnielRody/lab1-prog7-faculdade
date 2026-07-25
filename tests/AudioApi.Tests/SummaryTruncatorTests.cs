using AudioApi.Options;
using AudioApi.Summarization;

namespace AudioApi.Tests;

public class SummaryTruncatorTests
{
    private const int Max = SummarizationOptions.MaxSummaryCharsCeiling;

    private static string LoremSentences(int sentences)
        => string.Join(" ", Enumerable.Range(0, sentences)
            .Select(i => $"Esta é a frase número {i} do áudio transcrito e ela existe apenas para gerar volume de texto."));

    [Fact]
    public void Clamp_LongTranscript_ProducesSummaryWithin500Chars()
    {
        var summary = SummaryTruncator.Clamp(LoremSentences(200), Max);

        Assert.True(summary.Length <= Max, $"Resumo tem {summary.Length} caracteres, acima do limite de {Max}.");
        Assert.NotEmpty(summary);
    }

    [Fact]
    public void Clamp_TextOfExactlyTheLimit_IsNotTruncated()
    {
        var exact = new string('a', Max);

        var summary = SummaryTruncator.Clamp(exact, Max);

        Assert.Equal(Max, summary.Length);
        Assert.Equal(exact, summary);
    }

    [Fact]
    public void Clamp_TextOneCharOverTheLimit_FitsWithin500Chars()
    {
        var summary = SummaryTruncator.Clamp(new string('a', Max + 1), Max);

        Assert.True(summary.Length <= Max);
    }

    [Fact]
    public void Clamp_ShortText_IsReturnedUnchanged()
    {
        var summary = SummaryTruncator.Clamp("Resumo curto do áudio.", Max);

        Assert.Equal("Resumo curto do áudio.", summary);
        Assert.True(summary.Length <= Max);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n\t  \r\n")]
    public void Clamp_NullOrBlank_ReturnsEmpty(string? input)
    {
        Assert.Equal(string.Empty, SummaryTruncator.Clamp(input, Max));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(10)]
    [InlineData(64)]
    [InlineData(120)]
    [InlineData(499)]
    [InlineData(500)]
    public void Clamp_NeverExceedsTheGivenCeiling(int maxChars)
    {
        var summary = SummaryTruncator.Clamp(LoremSentences(300), maxChars);

        Assert.True(summary.Length <= maxChars, $"Resumo tem {summary.Length} caracteres, acima do limite de {maxChars}.");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Clamp_NonPositiveCeiling_ReturnsEmpty(int maxChars)
    {
        Assert.Equal(string.Empty, SummaryTruncator.Clamp(LoremSentences(10), maxChars));
    }

    [Fact]
    public void Clamp_CollapsesWhitespaceFromTheTranscript()
    {
        var summary = SummaryTruncator.Clamp("  Primeira   linha.\n\n\tSegunda linha.  ", Max);

        Assert.Equal("Primeira linha. Segunda linha.", summary);
    }

    [Fact]
    public void Clamp_PrefersCuttingAtASentenceBoundary()
    {
        var text = "Primeira frase completa. Segunda frase que estoura o limite disponível para o resumo.";

        var summary = SummaryTruncator.Clamp(text, 40);

        Assert.Equal("Primeira frase completa.", summary);
        Assert.True(summary.Length <= 40);
    }

    [Fact]
    public void Clamp_WithoutUsableSentenceBoundary_CutsAtWordBoundaryAndAppendsEllipsis()
    {
        var text = "palavra " + string.Join(' ', Enumerable.Repeat("repetida", 200));

        var summary = SummaryTruncator.Clamp(text, 50);

        Assert.True(summary.Length <= 50);
        Assert.EndsWith("…", summary);
        Assert.DoesNotContain("  ", summary);
    }

    [Fact]
    public void Clamp_DoesNotSplitSurrogatePairs()
    {
        var text = string.Concat(Enumerable.Repeat("🎧", 400));

        var summary = SummaryTruncator.Clamp(text, 51);

        Assert.True(summary.Length <= 51);
        Assert.False(char.IsHighSurrogate(summary[^1]), "O corte deixou um substituto alto órfão no fim do resumo.");
    }
}
