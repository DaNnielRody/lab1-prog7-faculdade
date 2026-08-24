using System.Threading.Channels;
using AudioApi.Options;
using Microsoft.Extensions.Options;

namespace AudioApi.Processing;

public sealed class ProcessingQueue : IProcessingQueue
{
    private readonly Channel<Guid> _channel;
    private readonly SemaphoreSlim _capacity;
    private readonly object _sync = new();
    private bool _completing;
    private int _reservations;

    public ProcessingQueue(IOptions<ProcessingOptions> options)
    {
        var capacity = Math.Max(1, options.Value.QueueCapacity);
        _capacity = new SemaphoreSlim(capacity, capacity);

        _channel = Channel.CreateBounded<Guid>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false,
        });
    }

    public bool TryReserve(out IProcessingQueueAdmission? admission)
    {
        lock (_sync)
        {
            if (_completing || !_capacity.Wait(0))
            {
                admission = null;
                return false;
            }

            _reservations++;
            admission = new Admission(this);
            return true;
        }
    }

    public bool TryEnqueue(Guid audioId)
    {
        if (!TryReserve(out var admission))
        {
            return false;
        }

        using (admission)
        {
            admission!.Enqueue(audioId);
            return true;
        }
    }

    public async IAsyncEnumerable<Guid> ReadAllAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        await foreach (var audioId in _channel.Reader.ReadAllAsync(ct))
        {
            _capacity.Release();
            yield return audioId;
        }
    }

    public void Complete()
    {
        lock (_sync)
        {
            _completing = true;
            if (_reservations == 0)
            {
                _channel.Writer.TryComplete();
            }
        }
    }

    private void FinishReservation(Guid? audioId)
    {
        lock (_sync)
        {
            if (audioId.HasValue)
            {
                if (!_channel.Writer.TryWrite(audioId.Value))
                {
                    _capacity.Release();
                    throw new ChannelClosedException();
                }
            }
            else
            {
                _capacity.Release();
            }

            _reservations--;
            if (_completing && _reservations == 0)
            {
                _channel.Writer.TryComplete();
            }
        }
    }

    private sealed class Admission(ProcessingQueue owner) : IProcessingQueueAdmission
    {
        private Guid? _audioId;
        private int _finished;

        public void Enqueue(Guid audioId) => _audioId = audioId;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _finished, 1) == 0)
            {
                owner.FinishReservation(_audioId);
            }
        }
    }
}
