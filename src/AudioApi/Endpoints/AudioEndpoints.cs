using AudioApi.Data;
using AudioApi.Dtos;
using AudioApi.Models;
using AudioApi.Options;
using AudioApi.Processing;
using AudioApi.Storage;
using AudioApi.Validation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AudioApi.Endpoints;

public static class AudioEndpoints
{
    private const string DefaultContentType = "application/octet-stream";

    public static RouteGroupBuilder MapAudioEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/audios").WithTags("Audios");

        group.MapPost("/", UploadAsync)
            .WithName("UploadAudio")
            .WithSummary("Envia um arquivo de áudio (multipart/form-data, campo 'file').")
            .DisableAntiforgery()
            .Accepts<IFormFile>("multipart/form-data")
            .Produces<AudioFileDto>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/", ListAsync)
            .WithName("ListAudios")
            .WithSummary("Lista todos os registros de áudio.");

        group.MapGet("/{id:guid}", GetByIdAsync)
            .WithName("GetAudio")
            .WithSummary("Obtém os metadados de um áudio.")
            .Produces<AudioFileDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapGet("/{id:guid}/download", DownloadAsync)
            .WithName("DownloadAudio")
            .WithSummary("Baixa os bytes do arquivo de áudio.")
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapGet("/{id:guid}/summary", GetSummaryAsync)
            .WithName("GetAudioSummary")
            .WithSummary("Obtém o resumo do áudio (no máximo 500 caracteres) e o estado da sumarização.")
            .Produces<AudioSummaryDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        return group;
    }

    private static async Task<IResult> UploadAsync(
        IFormFile? file,
        HttpRequest request,
        AppDbContext db,
        IFileStore fileStore,
        AudioFileValidator validator,
        IProcessingQueue processingQueue,
        IOptions<SummarizationOptions> summarizationOptions,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("AudioApi.Upload");

        if (file is null)
        {
            return Results.Problem(
                title: "Arquivo ausente",
                detail: "Nenhum arquivo foi enviado. Use multipart/form-data com o campo 'file'.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var validationError = validator.Validate(file.FileName, file.ContentType, file.Length);
        if (validationError is not null)
        {
            logger.LogWarning("Upload rejeitado: {Reason} (arquivo: {FileName})", validationError, file.FileName);
            return Results.Problem(
                title: "Arquivo inválido",
                detail: validationError,
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (!processingQueue.TryReserve(out var admission))
        {
            return Results.Problem(
                title: "Processamento temporariamente indisponível",
                detail: "A fila de processamento está cheia; tente enviar o áudio novamente mais tarde.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        using (admission)
        {

        var id = Guid.NewGuid();
        var baseUrl = $"{request.Scheme}://{request.Host}{request.PathBase}";

        var originalExtension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (string.IsNullOrEmpty(originalExtension))
        {
            originalExtension = ".bin";
        }

        StoredFile? stored = null;
        try
        {
            await using (var stream = file.OpenReadStream())
            {
                stored = await fileStore.SaveAsync(id, originalExtension, stream, baseUrl, ct);
            }

        var summarizationEnabled = summarizationOptions.Value.Enabled;

        var entity = new AudioFile
        {
            Id = id,
            OriginalFileName = file.FileName,
            StoredFileName = stored.StoredFileName,
            Url = stored.Url,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType)
                ? DefaultContentType
                : file.ContentType,
            SizeBytes = stored.SizeBytes,
            CreatedAtUtc = DateTime.UtcNow,
            ProcessingStatus = ProcessingStatus.Pending,
            ProcessingUpdatedAtUtc = DateTime.UtcNow,
            SummaryStatus = summarizationEnabled ? SummaryStatus.Pending : SummaryStatus.Disabled,
            SummaryUpdatedAtUtc = summarizationEnabled ? DateTime.UtcNow : null,
        };

            db.AudioFiles.Add(entity);
            await db.SaveChangesAsync(ct);
            admission!.Enqueue(id);

            logger.LogInformation("Áudio armazenado: {Id} ({FileName})", id, file.FileName);

            var dto = AudioFileDto.FromEntity(entity);
            return Results.Created($"/api/audios/{id}", dto);
        }
        catch
        {
            if (stored is not null)
            {
                try
                {
                    await fileStore.DeleteAsync(stored.StoredFileName, CancellationToken.None);
                }
                catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
                {
                    logger.LogCritical(
                        "Não foi possível compensar arquivo do upload {Id} ({ExceptionType}).",
                        id, cleanupException.GetType().Name);
                }
            }
            throw;
        }
        }
    }

    private static async Task<Ok<List<AudioFileDto>>> ListAsync(AppDbContext db, CancellationToken ct)
    {
        var items = await db.AudioFiles
            .AsNoTracking()
            .OrderByDescending(a => a.CreatedAtUtc)
            .Select(a => AudioFileDto.FromEntity(a))
            .ToListAsync(ct);

        return TypedResults.Ok(items);
    }

    private static async Task<Results<Ok<AudioFileDto>, NotFound>> GetByIdAsync(
        Guid id, AppDbContext db, CancellationToken ct)
    {
        var entity = await db.AudioFiles.FindAsync([id], ct);
        return entity is null
            ? TypedResults.NotFound()
            : TypedResults.Ok(AudioFileDto.FromEntity(entity));
    }

    private static async Task<Results<Ok<AudioSummaryDto>, NotFound>> GetSummaryAsync(
        Guid id,
        AppDbContext db,
        IOptions<SummarizationOptions> summarizationOptions,
        CancellationToken ct)
    {
        var entity = await db.AudioFiles.FindAsync([id], ct);
        return entity is null
            ? TypedResults.NotFound()
            : TypedResults.Ok(AudioSummaryDto.FromEntity(entity, summarizationOptions.Value.EffectiveMaxSummaryChars));
    }

    private static async Task<IResult> DownloadAsync(
        Guid id, AppDbContext db, IFileStore fileStore, CancellationToken ct)
    {
        var entity = await db.AudioFiles.FindAsync([id], ct);
        if (entity is null)
        {
            return Results.Problem(
                title: "Áudio não encontrado",
                detail: $"Nenhum áudio com o id {id} foi encontrado.",
                statusCode: StatusCodes.Status404NotFound);
        }

        var content = await fileStore.OpenReadAsync(entity.StoredFileName, entity.ContentType, ct);
        if (content is null)
        {
            return Results.Problem(
                title: "Arquivo não encontrado",
                detail: "O registro existe, mas o arquivo não está mais presente no file store.",
                statusCode: StatusCodes.Status404NotFound);
        }

        return Results.File(content.Stream, content.ContentType, entity.OriginalFileName);
    }
}
