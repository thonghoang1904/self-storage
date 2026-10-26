namespace SelfStorage.Api.Services;

/// <summary>
/// A contract expires at 20:00 on its end date; the unit is locked later, after the rental policy's
/// MaxOverdueDaysBeforeLock. Handover (check-in) and return themselves can happen at any hour (24/7).
/// </summary>
public static class ContractSchedule
{
    public static readonly TimeOnly ExpiryTime = new(20, 0);

    public static DateTime ExpiresAt(DateOnly endDate) => endDate.ToDateTime(ExpiryTime);

    public static DateTime LocksAt(DateOnly endDate, int maxOverdueDaysBeforeLock) =>
        ExpiresAt(endDate).AddDays(maxOverdueDaysBeforeLock);
}
