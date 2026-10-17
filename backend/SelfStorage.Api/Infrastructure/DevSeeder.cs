using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Infrastructure;

/// <summary>
/// Development only: adds missing demo accounts and creates sample facility data only when needed.
/// Existing users and facility data are never deleted or overwritten.
/// </summary>
public static class DevSeeder
{
    public const string DemoPassword = "Demo@12345";

    public static async Task SeedAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SelfStorageDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
        var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DevSeeder");

        await using var tx = await db.Database.BeginTransactionAsync();

        var roles = await db.Roles.ToDictionaryAsync(r => r.RoleName);
        var unitTypes = await db.UnitTypes.OrderBy(t => t.BaseMonthlyRate).ToListAsync();
        foreach (var requiredRole in new[]
                 {
                     AppRoles.Customer, AppRoles.Staff, AppRoles.Manager, AppRoles.OpsManager, AppRoles.Admin,
                 })
        {
            if (!roles.ContainsKey(requiredRole))
                throw new InvalidOperationException($"Required demo role '{requiredRole}' is missing from Roles.");
        }

        var admin = await EnsureUserAsync("admin", AppRoles.Admin, "Quản trị hệ thống", "079000000001");
        var ops = await EnsureUserAsync("ops1", AppRoles.OpsManager, "Quản lý vận hành", "079000000005");
        var manager = await EnsureUserAsync("manager1", AppRoles.Manager, "Trần Quản Lý", "079000000002");
        var staff = await EnsureUserAsync("staff1", AppRoles.Staff, "Lê Nhân Viên", "079000000003");
        var customer = await EnsureUserAsync("customer1", AppRoles.Customer, "Nguyễn Văn Khách", "079200000123");
        await db.SaveChangesAsync();

        var facility = await db.Facilities.OrderBy(f => f.FacilityId).FirstOrDefaultAsync();
        var createdFacility = facility is null;
        if (facility is null)
        {
            facility = new Facility
            {
                FacilityName = "Self Storage Quận 7",
                Address = "123 Nguyễn Thị Thập",
                City = "TP. Hồ Chí Minh",
                District = "Quận 7",
                Hotline = "02812345678",
                OperatingHours = "06:00 - 22:00",
            };
            db.Facilities.Add(facility);
            await db.SaveChangesAsync();

            for (var i = 0; i < unitTypes.Count; i++)
            for (var n = 1; n <= 3; n++)
            {
                db.StorageUnits.Add(new StorageUnit
                {
                    FacilityId = facility.FacilityId,
                    UnitTypeId = unitTypes[i].UnitTypeId,
                    UnitCode = $"{(char)('A' + i)}-{n:00}",
                    FloorNumber = 1,
                    ZoneArea = $"Khu {(char)('A' + i)}",
                    MonthlyPrice = unitTypes[i].BaseMonthlyRate,
                });
            }
            await db.SaveChangesAsync();
        }

        foreach (var user in new[] { manager, staff }.Where(user => user is not null))
        {
            if (!await db.FacilityStaffAssignments.AnyAsync(a =>
                    a.FacilityId == facility.FacilityId && a.StaffId == user!.UserId))
            {
                db.FacilityStaffAssignments.Add(new FacilityStaffAssignment
                {
                    FacilityId = facility.FacilityId,
                    StaffId = user!.UserId,
                });
            }
        }

        if (createdFacility && customer is not null && manager is not null
            && !await db.Contracts.AnyAsync(c => c.ContractNumber == "HD-DEMO-0001"))
        {
            var rentedUnit = await db.StorageUnits
                .Where(u => u.FacilityId == facility.FacilityId)
                .OrderBy(u => u.UnitId)
                .Skip(3)
                .FirstOrDefaultAsync();
            if (rentedUnit is not null)
            {
                rentedUnit.Status = UnitStatus.Rented;
                var today = DateOnly.FromDateTime(DateTime.Now);
                var contract = new Contract
                {
                    ContractNumber = "HD-DEMO-0001",
                    CustomerId = customer.UserId,
                    UnitId = rentedUnit.UnitId,
                    StaffCreatedId = manager.UserId,
                    StartDate = today.AddDays(-7),
                    EndDate = today.AddMonths(6),
                    MonthlyRentFee = rentedUnit.MonthlyPrice,
                    DepositPaid = rentedUnit.MonthlyPrice,
                };
                contract.AuthorizedPersons.Add(new AuthorizedPerson
                {
                    FullName = "Nguyễn Thị Người Nhà",
                    PhoneNumber = "0911111111",
                    CitizenId = "079300000456",
                    Relationship = "Vợ",
                });
                db.Contracts.Add(contract);

                // A second contract that ends in 5 days, so the renewal flow (open 7 days before the end) can be tried.
                var endingUnit = await db.StorageUnits
                    .Where(u => u.FacilityId == facility.FacilityId)
                    .OrderBy(u => u.UnitId)
                    .Skip(1)
                    .FirstOrDefaultAsync();
                if (endingUnit is not null)
                {
                    endingUnit.Status = UnitStatus.Rented;
                    db.Contracts.Add(new Contract
                    {
                        ContractNumber = "HD-DEMO-0002",
                        CustomerId = customer.UserId,
                        UnitId = endingUnit.UnitId,
                        StaffCreatedId = manager.UserId,
                        StartDate = today.AddMonths(-3).AddDays(5),
                        EndDate = today.AddDays(5),
                        MonthlyRentFee = endingUnit.MonthlyPrice,
                        DepositPaid = endingUnit.MonthlyPrice,
                    });
                }
            }
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();

        log.LogInformation("Ensured local demo accounts for customer, staff, facility manager, operations manager, and administrator. Demo password: {Password}.",
            DemoPassword);
        if (createdFacility)
            log.LogInformation("Created sample facility {FacilityId}.", facility.FacilityId);

        async Task<User?> EnsureUserAsync(string username, string role, string fullName, string citizenId)
        {
            var existing = await db.Users.Include(user => user.Role)
                .SingleOrDefaultAsync(user => user.Username == username);
            if (existing is not null)
            {
                if (existing.Role.RoleName != role)
                {
                    log.LogWarning("Demo account {Username} exists with role {ActualRole}; expected {ExpectedRole}. It was left unchanged.",
                        username, existing.Role.RoleName, role);
                    return null;
                }
                return existing;
            }

            var email = $"{username}@example.com";
            if (await db.Users.AnyAsync(user => user.Email == email || user.CitizenId == citizenId))
            {
                log.LogWarning("Demo account {Username} was not created because its email or citizen ID is already in use.",
                    username);
                return null;
            }

            var user = new User
            {
                RoleId = roles[role].RoleId,
                Username = username,
                FullName = fullName,
                Email = email,
                PhoneNumber = "0900000000",
                CitizenId = citizenId,
            };
            user.PasswordHash = hasher.HashPassword(user, DemoPassword);
            db.Users.Add(user);
            return user;
        }
    }
}
