using AudioApi.Options;
using AudioApi.Validation;
using Microsoft.Extensions.Options;

namespace AudioApi.Tests;

public class AudioFileValidatorTests
{
    private static AudioFileValidator CreateValidator()
        => new(Microsoft.Extensions.Options.Options.Create(new UploadOptions()));

    [Fact]
    public void Rejects_NonAudio_TxtFile()
    {
        var validator = CreateValidator();

        var error = validator.Validate("notes.txt", "text/plain", sizeBytes: 1234);

        Assert.NotNull(error);
        Assert.Contains("áudio", error);
    }

    [Fact]
    public void Accepts_Wav_ByExtension_EvenWithGenericContentType()
    {
        var validator = CreateValidator();

        var error = validator.Validate("clip.wav", "application/octet-stream", sizeBytes: 1234);

        Assert.Null(error);
    }

    [Fact]
    public void Accepts_ByAudioContentType_EvenWithUnknownExtension()
    {
        var validator = CreateValidator();

        var error = validator.Validate("clip.bin", "audio/wav", sizeBytes: 1234);

        Assert.Null(error);
    }

    [Fact]
    public void Rejects_EmptyFile()
    {
        var validator = CreateValidator();

        var error = validator.Validate("clip.wav", "audio/wav", sizeBytes: 0);

        Assert.NotNull(error);
    }

    [Fact]
    public void Rejects_FileExceedingMaxSize()
    {
        var validator = new AudioFileValidator(Microsoft.Extensions.Options.Options.Create(new UploadOptions { MaxSizeBytes = 10 }));

        var error = validator.Validate("clip.wav", "audio/wav", sizeBytes: 100);

        Assert.NotNull(error);
        Assert.Contains("máximo", error);
    }
}
