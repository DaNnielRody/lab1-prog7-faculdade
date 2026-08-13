using System.Threading.Channels;
using AudioApi.Options;
using AudioApi.Processing;
using AudioApi.Summarization;
using Microsoft.Extensions.Options;

namespace AudioApi.Tests;

public sealed class ProcessingQueueTests
{
    [Fact]
    public async Task DropWrite_TryWriteReturnsTrueEvenThoughFullChannelDiscardsItem()
    {
        var channel = Channel.CreateBounded<Guid>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
        });
        var first = Guid.NewGuid();
        var silentlyDiscarded = Guid.NewGuid();

        Assert.True(channel.Writer.TryWrite(first));
        Assert.True(channel.Writer.TryWrite(silentlyDiscarded));
        channel.Writer.Complete();

        var observed = new List<Guid>();
        await foreach (var item in channel.Reader.ReadAllAsync())
        {
            observed.Add(item);
        }

        Assert.Equal([first], observed);
        Assert.DoesNotContain(silentlyDiscarded, observed);
    }

    [Fact]
    public async Task ProcessingQueue_FullRejectsTruthfully_ThenRecoversAfterCapacityIsReleased()
    {
        var queue = new ProcessingQueue(
            Microsoft.Extensions.Options.Options.Create(new ProcessingOptions { QueueCapacity = 1 }));
        var first = Guid.NewGuid();
        var rejected = Guid.NewGuid();
        var admittedAfterRead = Guid.NewGuid();

        Assert.True(queue.TryEnqueue(first));
        Assert.False(queue.TryEnqueue(rejected));

        await using var reader = queue.ReadAllAsync(CancellationToken.None).GetAsyncEnumerator();
        Assert.True(await reader.MoveNextAsync());
        Assert.Equal(first, reader.Current);

        Assert.True(queue.TryEnqueue(admittedAfterRead));
        Assert.True(await reader.MoveNextAsync());
        Assert.Equal(admittedAfterRead, reader.Current);

        queue.Complete();
        Assert.False(await reader.MoveNextAsync());
    }

    [Fact]
    public void ProcessingQueue_CompletionRejectsProducerRacingWithShutdown()
    {
        var queue = new ProcessingQueue(
            Microsoft.Extensions.Options.Options.Create(new ProcessingOptions { QueueCapacity = 1 }));

        queue.Complete();

        Assert.False(queue.TryEnqueue(Guid.NewGuid()));
    }

    [Fact]
    public async Task SummaryQueue_AlsoRejectsInsteadOfSilentlyDroppingWhenFull()
    {
        var queue = new SummaryQueue(
            Microsoft.Extensions.Options.Options.Create(new SummarizationOptions { QueueCapacity = 1 }));
        var first = Guid.NewGuid();

        Assert.True(queue.TryEnqueue(first));
        Assert.False(queue.TryEnqueue(Guid.NewGuid()));

        await using var reader = queue.ReadAllAsync(CancellationToken.None).GetAsyncEnumerator();
        Assert.True(await reader.MoveNextAsync());
        Assert.Equal(first, reader.Current);
    }
}
