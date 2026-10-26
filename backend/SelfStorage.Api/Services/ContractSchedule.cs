namespace SelfStorage.Api.Services;

/// <summary>
/// Facilities run 24/7, so a contract runs to the minute: it expires on its end date at the time of day it was
/// handed over (Contract.SignedDate), and the unit is locked MaxOverdueDaysBeforeLock days after that.
/// Handover (check-in) and return themselves can happen at any hour.
/// </summary>
public static class ContractSchedule
{
    public static DateTime ExpiresAt(DateOnly endDate, DateTime handedOverAt) =>
        endDate.ToDateTime(TimeOnly.FromDateTime(handedOverAt));

    public static DateTime LocksAt(DateOnly endDate, DateTime handedOverAt, int maxOverdueDaysBeforeLock) =>
        ExpiresAt(endDate, handedOverAt).AddDays(maxOverdueDaysBeforeLock);

    /// <summary>A rent period starts at the handover time of day on its start date, like the contract itself.</summary>
    public static DateTime PeriodStartsAt(DateOnly periodStart, DateTime handedOverAt) =>
        periodStart.ToDateTime(TimeOnly.FromDateTime(handedOverAt));
}

/// <summary>
/// A confirmed reservation holds a unit until the customer picks it up. If nobody comes by
/// ExpectedStartDate + NoShowGraceDays, the reservation expires and the deposit is refunded minus the
/// cancellation fee, so the unit does not stay held forever.
/// </summary>
public static class ReservationSchedule
{
    public const int NoShowGraceDays = 7;

    public static DateOnly LastCheckInDate(DateOnly expectedStartDate) => expectedStartDate.AddDays(NoShowGraceDays);
}

/// <summary>Monthly rent periods: StartDate + k months up to the next one, the last cut at the contract end date.</summary>
public static class RentSchedule
{
    public static IEnumerable<(DateOnly Start, DateOnly End)> Periods(DateOnly startDate, DateOnly endDate)
    {
        for (var month = 0; ; month++)
        {
            var start = startDate.AddMonths(month);
            if (start >= endDate) yield break;
            // From the contract start each time, so a 31st start does not drift (Jan 31 -> Feb 28 -> Mar 31).
            var end = startDate.AddMonths(month + 1);
            yield return (start, end > endDate ? endDate : end);
        }
    }

    public static string Description(DateOnly start, DateOnly end, string contractNumber) =>
        $"Tiền thuê kỳ {start:dd/MM/yyyy} - {end:dd/MM/yyyy} cho hợp đồng {contractNumber}";
}
