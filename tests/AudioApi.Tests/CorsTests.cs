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

    // O par (permitida x não permitida) na mesma requisição é o que torna o caso negativo
    // significativo: a ausência do cabeçalho só prova recusa se a origem permitida, no mesmo
    // endpoint e na mesma configuração, recebe o cabeçalho. Sem `UseCors` nenhuma das duas
    // recebe e o teste falha.
    [Fact]
    public async Task Get_Audios_AllowedOriginReceivesHeader_DisallowedOriginDoesNot()
    {
        var client = _factory.CreateClient();

        using var allowedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/audios");
        allowedRequest.Headers.Add("Origin", AllowedOrigin);
        var allowedResponse = await client.SendAsync(allowedRequest);

        Assert.Equal(HttpStatusCode.OK, allowedResponse.StatusCode);
        Assert.True(
            allowedResponse.Headers.TryGetValues("Access-Control-Allow-Origin", out var allowedValues),
            "Política de CORS inativa: origem permitida não recebeu Access-Control-Allow-Origin em /api/audios.");
        Assert.Contains(AllowedOrigin, allowedValues!);

        using var disallowedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/audios");
        disallowedRequest.Headers.Add("Origin", DisallowedOrigin);
        var disallowedResponse = await client.SendAsync(disallowedRequest);

        Assert.Equal(HttpStatusCode.OK, disallowedResponse.StatusCode);
        Assert.False(
            disallowedResponse.Headers.Contains("Access-Control-Allow-Origin"),
            $"Origem não permitida ({DisallowedOrigin}) não deveria receber Access-Control-Allow-Origin.");
    }

    [Fact]
    public async Task Preflight_PostAudios_AllowedOrigin_ReturnsAllowOriginAndAllowMethods()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/audios");
        request.Headers.Add("Origin", AllowedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "POST");

        var response = await client.SendAsync(request);

        Assert.True(
            (int)response.StatusCode is >= 200 and < 300,
            $"Preflight de origem permitida deveria responder 2xx, mas respondeu {(int)response.StatusCode}.");
        Assert.True(
            response.Headers.TryGetValues("Access-Control-Allow-Origin", out var origins),
            "Preflight de origem permitida deveria conter Access-Control-Allow-Origin.");
        Assert.Contains(AllowedOrigin, origins!);
        Assert.True(
            response.Headers.TryGetValues("Access-Control-Allow-Methods", out var methods),
            "Preflight de origem permitida deveria conter Access-Control-Allow-Methods.");
        Assert.Contains(methods!, value => value.Contains("POST", StringComparison.OrdinalIgnoreCase));
    }

    // Aqui a prova de que o middleware rodou é o próprio short-circuit: o CORS responde ao
    // preflight com 204 sem chegar ao endpoint. Sem `UseCors` o OPTIONS cai no roteamento e
    // devolve 405.
    [Fact]
    public async Task Preflight_PostAudios_DisallowedOrigin_IsRefusedByCorsMiddleware()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/audios");
        request.Headers.Add("Origin", DisallowedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "POST");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin"),
            $"Preflight de origem não permitida ({DisallowedOrigin}) não deveria receber Access-Control-Allow-Origin.");
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Methods"),
            $"Preflight de origem não permitida ({DisallowedOrigin}) não deveria receber Access-Control-Allow-Methods.");
    }

    [Fact]
    public async Task Get_Summary_AllowedOrigin_ReturnsAccessControlAllowOriginHeader()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/audios/{Guid.NewGuid()}/summary");
        request.Headers.Add("Origin", AllowedOrigin);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.True(
            response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values),
            "Resposta de /summary para origem permitida deveria conter Access-Control-Allow-Origin.");
        Assert.Contains(AllowedOrigin, values!);
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
