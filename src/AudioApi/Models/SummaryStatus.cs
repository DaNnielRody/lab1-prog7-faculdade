using System.Text.Json.Serialization;

namespace AudioApi.Models;

[JsonConverter(typeof(JsonStringEnumConverter<SummaryStatus>))]
public enum SummaryStatus
{
    Disabled = 0,
    Pending = 1,
    Processing = 2,
    Completed = 3,
    Failed = 4,
}
