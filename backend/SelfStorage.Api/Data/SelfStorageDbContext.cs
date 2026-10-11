using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Data;

/// <summary>
/// Maps onto the existing SelfStorageDB schema (database/01_schema.sql + 02_pin_access.sql).
/// The database is created by those scripts, not by EF migrations.
/// Only the tables used by the current API are mapped; add the rest the same way.
/// </summary>
public class SelfStorageDbContext(DbContextOptions<SelfStorageDbContext> options) : DbContext(options)
{
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<User> Users => Set<User>();
    public DbSet<FacilityStaffAssignment> FacilityStaffAssignments => Set<FacilityStaffAssignment>();
    public DbSet<Facility> Facilities => Set<Facility>();
    public DbSet<UnitType> UnitTypes => Set<UnitType>();
    public DbSet<StorageUnit> StorageUnits => Set<StorageUnit>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<AuthorizedPerson> AuthorizedPersons => Set<AuthorizedPerson>();
    public DbSet<AccessRecord> AccessRecords => Set<AccessRecord>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Role>(e =>
        {
            e.ToTable("Roles");
            e.HasKey(x => x.RoleId);
        });

        b.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.HasKey(x => x.UserId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId);
        });

        b.Entity<FacilityStaffAssignment>(e =>
        {
            e.ToTable("FacilityStaffAssignments");
            e.HasKey(x => x.AssignmentId);
            e.Property(x => x.AssignedDate).HasDefaultValueSql("CAST(SYSDATETIME() AS DATE)");
            e.HasOne(x => x.Facility).WithMany().HasForeignKey(x => x.FacilityId);
            e.HasOne(x => x.Staff).WithMany().HasForeignKey(x => x.StaffId);
        });

        b.Entity<Facility>(e =>
        {
            e.ToTable("Facilities");
            e.HasKey(x => x.FacilityId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
        });

        b.Entity<UnitType>(e =>
        {
            e.ToTable("UnitTypes");
            e.HasKey(x => x.UnitTypeId);
            e.Property(x => x.VolumeCubicMeters)
                .HasComputedColumnSql("[LengthMeters] * [WidthMeters] * [HeightMeters]", stored: true);
        });

        b.Entity<StorageUnit>(e =>
        {
            e.ToTable("StorageUnits");
            e.HasKey(x => x.UnitId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Facility).WithMany(f => f.Units).HasForeignKey(x => x.FacilityId);
            e.HasOne(x => x.UnitType).WithMany().HasForeignKey(x => x.UnitTypeId);
        });

        b.Entity<Reservation>(e =>
        {
            e.ToTable("Reservations");
            e.HasKey(x => x.ReservationId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.Facility).WithMany().HasForeignKey(x => x.FacilityId);
            e.HasOne(x => x.UnitType).WithMany().HasForeignKey(x => x.UnitTypeId);
            e.HasOne(x => x.AssignedUnit).WithMany().HasForeignKey(x => x.AssignedUnitId);
        });

        b.Entity<Contract>(e =>
        {
            e.ToTable("Contracts");
            e.HasKey(x => x.ContractId);
            e.Property(x => x.SignedDate).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.StaffCreatedId);
            e.HasOne<Reservation>().WithMany().HasForeignKey(x => x.ReservationId);
        });

        b.Entity<AuthorizedPerson>(e =>
        {
            e.ToTable("AuthorizedPersons");
            e.HasKey(x => x.AuthorizedPersonId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Contract).WithMany(c => c.AuthorizedPersons).HasForeignKey(x => x.ContractId);
        });

        b.Entity<AccessRecord>(e =>
        {
            e.ToTable("AccessRecords");
            e.HasKey(x => x.AccessRecordId);
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId);
            e.HasOne<Facility>().WithMany().HasForeignKey(x => x.FacilityId);
            e.HasOne(x => x.AuthorizedPerson).WithMany().HasForeignKey(x => x.AuthorizedPersonId);
            e.HasOne(x => x.VerifiedByStaff).WithMany().HasForeignKey(x => x.VerifiedByStaffId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.ExitConfirmedByStaffId);
        });

        // The SQL script names every key/id column "...ID" (UserID, CitizenID, ...).
        foreach (var entity in b.Model.GetEntityTypes())
        foreach (var prop in entity.GetProperties())
        {
            if (prop.Name.EndsWith("Id", StringComparison.Ordinal))
                prop.SetColumnName(prop.Name[..^2] + "ID");
        }

        // All DECIMAL columns in the script have 2 decimal places.
        foreach (var prop in b.Model.GetEntityTypes().SelectMany(t => t.GetProperties())
                     .Where(p => p.ClrType == typeof(decimal)))
        {
            prop.SetPrecision(18);
            prop.SetScale(2);
        }
    }
}
