namespace SelfStorage.Api.Infrastructure;

public sealed class BusinessTimeProvider(TimeZoneInfo businessTimeZone) : TimeProvider
{
    public const string VietnamTimeZoneId = "Asia/Ho_Chi_Minh";

    public override TimeZoneInfo LocalTimeZone => businessTimeZone;

    public override DateTimeOffset GetUtcNow() => TimeProvider.System.GetUtcNow();
}
