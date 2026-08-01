using System.Text;

namespace AudioApi.Summarization;

public static class SummaryTruncator
{
    private const char Ellipsis = '…';

    private static readonly char[] SentenceTerminators = ['.', '!', '?', Ellipsis];

    private static readonly char[] DanglingPunctuation = [' ', ',', ';', ':', '-', '–', '—'];

    public static string Clamp(string? text, int maxChars)
    {
        if (maxChars <= 0)
        {
            return string.Empty;
        }

        var normalized = NormalizeWhitespace(text);
        if (normalized.Length <= maxChars)
        {
            return normalized;
        }

        var sentenceEnd = LastSentenceBoundary(normalized, maxChars);
        if (sentenceEnd > 0)
        {
            return normalized[..sentenceEnd];
        }

        var budget = maxChars - 1;
        if (budget <= 0)
        {
            return Ellipsis.ToString();
        }

        var cut = SafeCut(normalized, budget);
        var lastSpace = normalized.LastIndexOf(' ', Math.Max(cut - 1, 0));
        if (lastSpace > 0)
        {
            cut = lastSpace;
        }

        var head = normalized[..cut].TrimEnd(DanglingPunctuation);
        return head.Length == 0
            ? Ellipsis.ToString()
            : head + Ellipsis;
    }

    private static string NormalizeWhitespace(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(text.Length);
        var pendingSpace = false;

        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }

            builder.Append(ch);
        }

        return builder.ToString();
    }

    private static int LastSentenceBoundary(string text, int maxChars)
    {
        var window = Math.Min(text.Length, maxChars);
        var minimumUseful = maxChars / 2;
        var best = 0;

        for (var i = 0; i < window; i++)
        {
            if (Array.IndexOf(SentenceTerminators, text[i]) < 0)
            {
                continue;
            }

            var end = i + 1;
            if (end < text.Length && text[end] != ' ')
            {
                continue;
            }

            if (end <= maxChars)
            {
                best = end;
            }
        }

        return best >= minimumUseful ? best : 0;
    }

    private static int SafeCut(string text, int index)
    {
        var cut = Math.Min(index, text.Length);
        if (cut > 0 && cut < text.Length && char.IsLowSurrogate(text[cut]))
        {
            cut--;
        }

        return cut;
    }
}
