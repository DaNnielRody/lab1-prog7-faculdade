using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Validation;

public class AudioFileValidator
{
    private readonly UploadOptions _options;

    public AudioFileValidator(IOptions<UploadOptions> options)
    {
        _options = options.Value;
    }

    public long MaxSizeBytes => _options.MaxSizeBytes;

    public IReadOnlyList<string> AllowedExtensions => _options.EffectiveExtensions;

    public string? Validate(string? fileName, string? contentType, long sizeBytes)
    {
        if (sizeBytes <= 0)
        {
            return "O arquivo enviado está vazio.";
        }

        if (sizeBytes > _options.MaxSizeBytes)
        {
            var maxMb = _options.MaxSizeBytes / (1024d * 1024d);
            return $"O arquivo excede o tamanho máximo permitido de {maxMb:0.#} MB.";
        }

        var extension = Path.GetExtension(fileName ?? string.Empty).ToLowerInvariant();
        var contentTypeIsAudio = !string.IsNullOrWhiteSpace(contentType)
            && contentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase);
        var extensionIsAllowed = _options.EffectiveExtensions.Contains(extension);

        if (!contentTypeIsAudio && !extensionIsAllowed)
        {
            var allowed = string.Join(", ", _options.EffectiveExtensions);
            return $"O arquivo não é um áudio válido. Use um content-type 'audio/*' ou uma das extensões: {allowed}.";
        }

        return null;
    }
}
