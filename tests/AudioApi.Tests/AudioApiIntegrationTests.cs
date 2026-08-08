using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using AudioApi.Dtos;
using AudioApi.Models;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace AudioApi.Tests;

[Collection(IntegrationCollection.Name)]
public class AudioApiIntegrationTests : IClassFixture<AudioApiIntegrationTests.TempAppFactory>
{
    private readonly TempAppFactory _factory;

    public AudioApiIntegrationTests(TempAppFactory factory) => _factory = factory;

    /// <summary>Poll até o processamento em background chegar a um estado terminal.</summary>
    private static async Task<AudioFileDto> PollUntilProcessedAsync(HttpClient client, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);

        while (DateTime.UtcNow < deadline)
        {
            var response = await client.GetAsync($"/api/audios/{id}");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var dto = await response.Content.ReadFromJsonAsync<AudioFileDto>();
            Assert.NotNull(dto);

            if (dto!.ProcessingStatus is ProcessingStatus.Completed or ProcessingStatus.Failed)
            {
                return dto;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException($"O processamento do áudio {id} não foi concluído em 60s.");
    }

    [Fact]
    public async Task Post_Wav_Returns201_AndAudioIsStoredCompressedAsAac()
    {
        var client = _factory.CreateClient();

        var bytes = TestAudio.CreateValidWavBytes();

        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        content.Add(fileContent, "file", "sample.wav");

        var post = await client.PostAsync("/api/audios", content);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<AudioFileDto>();
        Assert.NotNull(created);
        Assert.NotEqual(Guid.Empty, created!.Id);
        Assert.Equal("sample.wav", created.OriginalFileName);
        Assert.Equal($"/api/audios/{created.Id}", post.Headers.Location?.ToString());

        // A compressão saiu da requisição: o .m4a aparece depois da resposta.
        var processed = await PollUntilProcessedAsync(client, created.Id);
        Assert.Equal(ProcessingStatus.Completed, processed.ProcessingStatus);
        Assert.EndsWith(".m4a", processed.StoredFileName);
        Assert.Equal("audio/mp4", processed.ContentType);
        Assert.Contains($"/api/audios/{processed.Id}/download", processed.Url);

        var get = await client.GetAsync($"/api/audios/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var fetched = await get.Content.ReadFromJsonAsync<AudioFileDto>();
        Assert.NotNull(fetched);
        Assert.Equal(created.Id, fetched!.Id);

        var download = await client.GetAsync($"/api/audios/{created.Id}/download");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        var downloaded = await download.Content.ReadAsByteArrayAsync();

        // Downloaded file must be the AAC/M4A (MP4 container) output, not the original WAV bytes.
        Assert.NotEqual(bytes, downloaded);
        Assert.Equal(processed.SizeBytes, downloaded.Length);
        var header = System.Text.Encoding.ASCII.GetString(downloaded, 4, 8);
        Assert.Contains("ftyp", header);
    }

    [Fact]
    public async Task Post_AudioContentTypeButNotDecodable_Returns201ThenProcessingFails()
    {
        var client = _factory.CreateClient();

        var bytes = new byte[2048];
        new Random(42).NextBytes(bytes);

        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        content.Add(fileContent, "file", "garbage.wav");

        // A requisição não decodifica mais nada, então não pode mais recusar com 422.
        var post = await client.PostAsync("/api/audios", content);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<AudioFileDto>();
        Assert.NotNull(created);
        Assert.Equal(ProcessingStatus.Pending, created!.ProcessingStatus);

        var processed = await PollUntilProcessedAsync(client, created.Id);
        Assert.Equal(ProcessingStatus.Failed, processed.ProcessingStatus);
        Assert.False(
            string.IsNullOrWhiteSpace(processed.ProcessingError),
            $"O áudio {created.Id} falhou na compressão sem registrar o motivo em ProcessingError.");
    }

    [Fact]
    public async Task Post_TxtFile_Returns400()
    {
        var client = _factory.CreateClient();

        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[] { 1, 2, 3, 4 });
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        content.Add(fileContent, "file", "notes.txt");

        var post = await client.PostAsync("/api/audios", content);
        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
    }

    [Fact]
    public async Task Get_MissingId_Returns404()
    {
        var client = _factory.CreateClient();
        var get = await client.GetAsync($"/api/audios/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    public sealed class TempAppFactory : WebApplicationFactory<Program>, IDisposable
    {
        private readonly string _tempDir =
            Path.Combine(Path.GetTempPath(), "audioapi-tests-" + Guid.NewGuid().ToString("N"));

        public TempAppFactory() => Directory.CreateDirectory(_tempDir);

        protected override IHost CreateHost(IHostBuilder builder)
        {
            TestEnvironment.Apply(_tempDir);

            builder.UseEnvironment("Development");
            return base.CreateHost(builder);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try
            {
                if (Directory.Exists(_tempDir))
                {
                    Directory.Delete(_tempDir, recursive: true);
                }
            }
            catch
            {
            }
        }
    }
}
