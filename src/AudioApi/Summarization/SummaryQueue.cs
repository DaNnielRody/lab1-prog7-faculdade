using System.Threading.Channels;
using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Summarization;

public sealed class SummaryQueue : ISummaryQueue
{
    private readonly Channel<Guid> _channel;

    public SummaryQueue(IOptions<SummarizationOptions> options)
    {
        var capacity = Math.Max(1, options.Value.QueueCapacity);

        _channel = Channel.CreateBounded<Guid>(new BoundedChannelOptions(capacity)
        {
            // Keep TryEnqueue truthful: unlike DropWrite, Wait makes TryWrite return false when
            // the bounded buffer has no admission capacity.
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false,
        });
    }

    public bool TryEnqueue(Guid audioId) => _channel.Writer.TryWrite(audioId);

    public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);
}
