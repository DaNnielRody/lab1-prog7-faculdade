using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace AudioApi.Tests;

[Collection(IntegrationCollection.Name)]
public class CorsTests : IClassFixture<CorsTests.CorsAppFactory>
{
    private const string AllowedOrigin = "http://localhost:3000";
    private const string DisallowedOrigin = "http://evil.example";

    private readonly CorsAppFactory _factory;

    public CorsTests(CorsAppFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_Health_AllowedOrigin_ReturnsAccessControlAllowOriginHeader()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", AllowedOrigin);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(
            response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values),
            "Resposta para origem permitida deveria conter Access-Control-Allow-Origin.");
        Assert.Contains(AllowedOrigin, values!);
    }

    [Fact]
    public async Task Get_Health_DisallowedOrigin_DoesNotReturnAccessControlAllowOriginHeader()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", DisallowedOrigin);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin"),
            $"Origem não permitida ({DisallowedOrigin}) não deveria receber Access-Control-Allow-Origin.");
    }

    public sealed class CorsAppFactory : WebApplicationFactory<Program>, IDisposable
    {
        private readonly string _tempDir =
            Path.Combine(Path.GetTempPath(), "audioapi-cors-tests-" + Guid.NewGuid().ToString("N"));

        public CorsAppFactory() => Directory.CreateDirectory(_tempDir);

        protected override IHost CreateHost(IHostBuilder builder)
        {
            TestEnvironment.Apply(_tempDir, new Dictionary<string, string?>
            {
                ["Cors__AllowedOrigins__0"] = AllowedOrigin
            });

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
