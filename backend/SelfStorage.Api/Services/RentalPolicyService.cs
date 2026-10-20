using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;

namespace SelfStorage.Api.Services;

public sealed record EffectiveRentalPolicy(
    decimal DepositPercent,
    int CancellationGraceHours,
    decimal CancellationFeePercent,
    int RenewalNoticeDays,
    int MaxOverdueDaysBeforeLock);

public sealed class RentalPolicyService(SelfStorageDbContext db, TimeProvider clock)
{
    private static readonly EffectiveRentalPolicy Defaults = new(100m, 24, 10m, 7, 1);

    public async Task<EffectiveRentalPolicy> ForFacilityAsync(int facilityId, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var policy = await db.RentalPolicies
            .Where(p => p.IsActive && p.EffectiveDate <= today
                && (p.FacilityId == null || p.FacilityId == facilityId))
            .OrderBy(p => p.FacilityId == facilityId ? 0 : 1)
            .ThenByDescending(p => p.EffectiveDate)
            .FirstOrDefaultAsync(ct);
        return policy is null
            ? Defaults
            : new EffectiveRentalPolicy(
                policy.DepositPercent,
                policy.CancellationGraceHours,
                policy.CancellationFeePercent,
                policy.RenewalNoticeDays,
                policy.MaxOverdueDaysBeforeLock);
    }
}
