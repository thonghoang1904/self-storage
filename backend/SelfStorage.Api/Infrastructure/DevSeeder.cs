using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Infrastructure;

/// <summary>
/// Development only: fills an empty database with one facility, demo accounts and a rented unit with a PIN,
/// so the whole entry/exit flow can be tried right away. Runs only when there is no facility yet.
/// </summary>
public static class DevSeeder
{
    public const string DemoPassword = "Demo@12345";
    public const string DemoPin = "246810";

    public static async Task SeedAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SelfStorageDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
        var pins = scope.ServiceProvider.GetRequiredService<PinService>();
        var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DevSeeder");

        if (await db.Facilities.AnyAsync()) return;

        var roles = await db.Roles.ToDictionaryAsync(r => r.RoleName);
        var unitTypes = await db.UnitTypes.OrderBy(t => t.BaseMonthlyRate).ToListAsync();

        var facility = new Facility
        {
            FacilityName = "Self Storage Quận 7",
            Address = "123 Nguyễn Thị Thập",
            City = "TP. Hồ Chí Minh",
            District = "Quận 7",
            Hotline = "02812345678",
            OperatingHours = "06:00 - 22:00",
        };
        db.Facilities.Add(facility);

        var units = new List<StorageUnit>();
        for (var i = 0; i < unitTypes.Count; i++)
        for (var n = 1; n <= 3; n++)
        {
            var unit = new StorageUnit
            {
                Facility = facility,
                UnitTypeId = unitTypes[i].UnitTypeId,
                UnitCode = $"{(char)('A' + i)}-{n:00}",
                FloorNumber = 1,
                ZoneArea = $"Khu {(char)('A' + i)}",
                MonthlyPrice = unitTypes[i].BaseMonthlyRate,
            };
            units.Add(unit);
        }
        db.StorageUnits.AddRange(units);

        User NewUser(string username, string role, string fullName, string citizenId)
        {
            var u = new User
            {
                RoleId = roles[role].RoleId,
                Username = username,
                FullName = fullName,
                Email = $"{username}@example.com",
                PhoneNumber = "0900000000",
                CitizenId = citizenId,
            };
            u.PasswordHash = hasher.HashPassword(u, DemoPassword);
            db.Users.Add(u);
            return u;
        }

        var admin = NewUser("admin", AppRoles.Admin, "Quản trị hệ thống", "079000000001");
        var manager = NewUser("manager1", AppRoles.Manager, "Trần Quản Lý", "079000000002");
        var staff = NewUser("staff1", AppRoles.Staff, "Lê Nhân Viên", "079000000003");
        var customer = NewUser("customer1", AppRoles.Customer, "Nguyễn Văn Khách", "079200000123");
        await db.SaveChangesAsync();

        db.FacilityStaffAssignments.AddRange(
            new FacilityStaffAssignment { FacilityId = facility.FacilityId, StaffId = manager.UserId },
            new FacilityStaffAssignment { FacilityId = facility.FacilityId, StaffId = staff.UserId });

        var rentedUnit = units[3];   // B-01
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
            PinUpdatedAt = DateTime.Now,
        };
        contract.AccessPinHash = pins.Hash(contract, DemoPin);
        contract.AuthorizedPersons.Add(new AuthorizedPerson
        {
            FullName = "Nguyễn Thị Người Nhà",
            PhoneNumber = "0911111111",
            CitizenId = "079300000456",
            Relationship = "Vợ",
        });
        db.Contracts.Add(contract);
        await db.SaveChangesAsync();

        log.LogInformation(
            "Seeded demo data. Accounts (password {Password}): admin, manager1, staff1, customer1. " +
            "Facility {FacilityId}, unit {Unit} with PIN {Pin}.",
            DemoPassword, facility.FacilityId, rentedUnit.UnitCode, DemoPin);
        _ = admin;
    }
}
