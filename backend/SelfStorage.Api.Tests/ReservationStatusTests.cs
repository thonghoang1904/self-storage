using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Tests;

public class ReservationStatusTests
{
    [Theory]
    [InlineData("PendingDeposit", ReservationStatus.PendingDeposit)]
    [InlineData("confirmed", ReservationStatus.Confirmed)]
    [InlineData(" CheckedIn ", ReservationStatus.CheckedIn)]
    [InlineData("Cancelled", ReservationStatus.Cancelled)]
    [InlineData("Expired", ReservationStatus.Expired)]
    public void NormalizeReturnsCanonicalReservationStatus(string input, string expected)
    {
        Assert.Equal(expected, ReservationStatus.Normalize(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void NormalizeTreatsMissingStatusAsNoFilter(string? input)
    {
        Assert.Null(ReservationStatus.Normalize(input));
    }

    [Fact]
    public void NormalizeRejectsUnknownStatus()
    {
        Assert.Null(ReservationStatus.Normalize("NotAReservationStatus"));
    }

    [Fact]
    public void BusinessTimeProviderUsesConfiguredTimeZone()
    {
        var businessZone = TimeZoneInfo.CreateCustomTimeZone(
            "Vietnam Business Time", TimeSpan.FromHours(7), "Vietnam Business Time", "Vietnam Business Time");
        var clock = new BusinessTimeProvider(businessZone);

        Assert.Equal(businessZone, clock.LocalTimeZone);
        Assert.Equal(TimeSpan.FromHours(7), clock.GetLocalNow().Offset);
    }

    [Fact]
    public void VietnamBusinessTimeZoneIsAvailableOnCurrentHost()
    {
        var businessZone = TimeZoneInfo.FindSystemTimeZoneById(BusinessTimeProvider.VietnamTimeZoneId);

        Assert.Equal(TimeSpan.FromHours(7), businessZone.GetUtcOffset(DateTime.UtcNow));
    }
}
