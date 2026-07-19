using AudioApi.Compression;
using AudioApi.Data;
using AudioApi.Endpoints;
using AudioApi.Options;
using AudioApi.Storage;
using AudioApi.Validation;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection(UploadOptions.SectionName));
builder.Services.Configure<CompressionOptions>(builder.Configuration.GetSection(CompressionOptions.SectionName));

var uploadOptions = builder.Configuration.GetSection(UploadOptions.SectionName).Get<UploadOptions>() ?? new UploadOptions();

var bodyLimit = uploadOptions.MaxSizeBytes + (1L * 1024 * 1024);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = bodyLimit);
builder.Services.Configure<FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = bodyLimit;
});

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=./data/audios.db";
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString));

builder.Services.AddSingleton<IFileStore, LocalFileStore>();
builder.Services.AddSingleton<IAudioCompressor, FfmpegAudioCompressor>();
builder.Services.AddScoped<AudioFileValidator>();

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Audio Upload API",
        Version = "v1",
        Description = "API para receber arquivos de áudio, armazená-los em um File Store e registrar seus metadados."
    });
});

var app = builder.Build();

EnsureDatabaseDirectory(connectionString, app.Environment.ContentRootPath);
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Audio Upload API v1"));
}

app.MapGet("/health", () => Results.Ok(new { status = "healthy", timeUtc = DateTime.UtcNow }))
    .WithTags("System")
    .WithSummary("Verificação de saúde da aplicação.");

app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

app.MapAudioEndpoints();

app.Run();

static void EnsureDatabaseDirectory(string connectionString, string contentRoot)
{
    var conn = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString);
    var dataSource = conn.DataSource;
    if (string.IsNullOrWhiteSpace(dataSource) || dataSource == ":memory:")
    {
        return;
    }

    var fullPath = Path.IsPathRooted(dataSource)
        ? dataSource
        : Path.GetFullPath(Path.Combine(contentRoot, dataSource));
    var dir = Path.GetDirectoryName(fullPath);
    if (!string.IsNullOrEmpty(dir))
    {
        Directory.CreateDirectory(dir);
    }
}

public partial class Program { }
