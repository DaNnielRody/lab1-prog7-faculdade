using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using AudioApi.Dtos;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace AudioApi.Tests;

public class AudioApiIntegrationTests : IClassFixture<AudioApiIntegrationTests.TempAppFactory>
{
    private readonly TempAppFactory _factory;

    public AudioApiIntegrationTests(TempAppFactory factory) => _factory = factory;

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
        Assert.EndsWith(".m4a", created.StoredFileName);
        Assert.Equal("audio/mp4", created.ContentType);
        Assert.Contains($"/api/audios/{created.Id}/download", created.Url);
        Assert.Equal($"/api/audios/{created.Id}", post.Headers.Location?.ToString());

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
        Assert.Equal(created.SizeBytes, downloaded.Length);
        var header = System.Text.Encoding.ASCII.GetString(downloaded, 4, 8);
        Assert.Contains("ftyp", header);
    }

    [Fact]
    public async Task Post_AudioContentTypeButNotDecodable_Returns422()
    {
        var client = _factory.CreateClient();

        var bytes = new byte[2048];
        new Random(42).NextBytes(bytes);

        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        content.Add(fileContent, "file", "garbage.wav");

        var post = await client.PostAsync("/api/audios", content);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, post.StatusCode);
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

        public TempAppFactory()
        {
            Directory.CreateDirectory(_tempDir);

            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
            Environment.SetEnvironmentVariable("Storage__LocalPath", Path.Combine(_tempDir, "filestore"));
            Environment.SetEnvironmentVariable(
                "ConnectionStrings__Default", $"Data Source={Path.Combine(_tempDir, "audios.db")}");
        }

        protected override IHost CreateHost(IHostBuilder builder)
        {
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
