using System.Text.Json.Serialization;

namespace AudioApi.Models;

[JsonConverter(typeof(JsonStringEnumConverter<ProcessingStatus>))]
public enum ProcessingStatus
{
    Pending = 0,
    Processing = 1,
    Completed = 2,
    Failed = 3,
}
