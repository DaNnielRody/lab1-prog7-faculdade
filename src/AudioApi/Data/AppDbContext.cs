using AudioApi.Models;
using AudioApi.Options;
using Microsoft.EntityFrameworkCore;

namespace AudioApi.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<AudioFile> AudioFiles => Set<AudioFile>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AudioFile>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.OriginalFileName).IsRequired().HasMaxLength(1024);
            entity.Property(e => e.StoredFileName).IsRequired().HasMaxLength(512);
            entity.Property(e => e.Url).IsRequired().HasMaxLength(2048);
            entity.Property(e => e.ContentType).IsRequired().HasMaxLength(256);
            entity.Property(e => e.ProcessingStatus).IsRequired().HasConversion<string>().HasMaxLength(16);
            entity.Property(e => e.ProcessingError).HasMaxLength(JobError.MaxChars);
            entity.Property(e => e.Summary).HasMaxLength(SummarizationOptions.MaxSummaryCharsCeiling);
            entity.Property(e => e.SummaryStatus).IsRequired().HasConversion<string>().HasMaxLength(16);
            entity.Property(e => e.SummaryLanguage).HasMaxLength(16);
            entity.Property(e => e.SummaryError).HasMaxLength(JobError.MaxChars);
            entity.Property(e => e.FilterStatus).IsRequired().HasConversion<string>().HasMaxLength(16);
            entity.Property(e => e.FilterError).HasMaxLength(JobError.MaxChars);
            entity.Property(e => e.FilteredStoredFileName).HasMaxLength(512);
            entity.Property(e => e.FilteredContentType).HasMaxLength(256);
            entity.Property(e => e.FilteredUrl).HasMaxLength(2048);
        });
    }
}
