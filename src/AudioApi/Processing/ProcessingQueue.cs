using System.Threading.Channels;
using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Processing;

public sealed class ProcessingQueue : IProcessingQueue
{
    private readonly Channel<Guid> _channel;

    public ProcessingQueue(IOptions<ProcessingOptions> options)
    {
        var capacity = Math.Max(1, options.Value.QueueCapacity);

        _channel = Channel.CreateBounded<Guid>(new BoundedChannelOptions(capacity)
        {
            // Wait makes TryWrite an admission check: it returns false when the buffer is full.
            // DropWrite cannot be used here because it returns true even when it discards the
            // new item, which would leave the persisted audio permanently Pending.
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false,
        });
    }

    public bool TryEnqueue(Guid audioId) => _channel.Writer.TryWrite(audioId);

    public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);

    public void Complete() => _channel.Writer.TryComplete();
}
