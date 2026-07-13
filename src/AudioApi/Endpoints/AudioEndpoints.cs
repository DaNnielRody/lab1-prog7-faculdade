using AudioApi.Data;
using AudioApi.Dtos;
using AudioApi.Models;
using AudioApi.Storage;
using AudioApi.Validation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AudioApi.Endpoints;

public static class AudioEndpoints
{
    public static RouteGroupBuilder MapAudioEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/audios").WithTags("Audios");

        group.MapPost("/", UploadAsync)
            .WithName("UploadAudio")
            .WithSummary("Envia um arquivo de áudio (multipart/form-data, campo 'file').")
            .DisableAntiforgery()
            .Accepts<IFormFile>("multipart/form-data")
            .Produces<AudioFileDto>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest);

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

        return group;
    }

    private static async Task<IResult> UploadAsync(
        IFormFile? file,
        HttpRequest request,
        AppDbContext db,
        IFileStore fileStore,
        AudioFileValidator validator,
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

        var id = Guid.NewGuid();
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var baseUrl = $"{request.Scheme}://{request.Host}{request.PathBase}";

        var contentType = string.IsNullOrWhiteSpace(file.ContentType)
            ? "application/octet-stream"
            : file.ContentType;

        StoredFile stored;
        await using (var stream = file.OpenReadStream())
        {
            stored = await fileStore.SaveAsync(id, extension, stream, baseUrl, ct);
        }

        var entity = new AudioFile
        {
            Id = id,
            OriginalFileName = file.FileName,
            StoredFileName = stored.StoredFileName,
            Url = stored.Url,
            ContentType = contentType,
            SizeBytes = stored.SizeBytes,
            CreatedAtUtc = DateTime.UtcNow,
        };

        db.AudioFiles.Add(entity);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Áudio armazenado: {Id} ({FileName})", id, file.FileName);

        var dto = AudioFileDto.FromEntity(entity);
        return Results.Created($"/api/audios/{id}", dto);
    }

    private static async Task<Ok<List<AudioFileDto>>> ListAsync(AppDbContext db, CancellationToken ct)
    {
        var items = await db.AudioFiles
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
