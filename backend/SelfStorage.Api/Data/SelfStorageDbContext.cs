using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data.Entities;

namespace SelfStorage.Api.Data;

/// <summary>
/// Maps the API entities onto the SQL schema maintained by database scripts, not EF migrations.
/// Keep entity mappings and the ordered SQL migrations in sync.
/// </summary>
public class SelfStorageDbContext(DbContextOptions<SelfStorageDbContext> options) : DbContext(options)
{
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<User> Users => Set<User>();
    public DbSet<FacilityStaffAssignment> FacilityStaffAssignments => Set<FacilityStaffAssignment>();
    public DbSet<Facility> Facilities => Set<Facility>();
    public DbSet<RentalPolicy> RentalPolicies => Set<RentalPolicy>();
    public DbSet<FeeConfiguration> FeeConfigurations => Set<FeeConfiguration>();
    public DbSet<Promotion> Promotions => Set<Promotion>();
    public DbSet<UnitType> UnitTypes => Set<UnitType>();
    public DbSet<StorageUnit> StorageUnits => Set<StorageUnit>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<ReservationCancellationRequest> ReservationCancellationRequests => Set<ReservationCancellationRequest>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<AuthorizedPerson> AuthorizedPersons => Set<AuthorizedPerson>();
    public DbSet<AccessRecord> AccessRecords => Set<AccessRecord>();
    public DbSet<VisitRegistration> VisitRegistrations => Set<VisitRegistration>();
    public DbSet<EarlyReturnRequest> EarlyReturnRequests => Set<EarlyReturnRequest>();
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();
    public DbSet<EmailOutboxMessage> EmailOutboxMessages => Set<EmailOutboxMessage>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceDetail> InvoiceDetails => Set<InvoiceDetail>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<HandoverRecord> HandoverRecords => Set<HandoverRecord>();
    public DbSet<ContractRenewal> ContractRenewals => Set<ContractRenewal>();
    public DbSet<OverdueRecord> OverdueRecords => Set<OverdueRecord>();
    public DbSet<SupportRequest> SupportRequests => Set<SupportRequest>();
    public DbSet<SupportChecklistItem> SupportChecklistItems => Set<SupportChecklistItem>();
    public DbSet<SupportUpdate> SupportUpdates => Set<SupportUpdate>();

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
            e.Property(x => x.GoogleSubject).HasMaxLength(255).IsUnicode(false);
            e.HasIndex(x => x.GoogleSubject).IsUnique().HasFilter("[GoogleSubject] IS NOT NULL");
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

        b.Entity<RentalPolicy>(e =>
        {
            e.ToTable("RentalPolicies");
            e.HasKey(x => x.PolicyId);
            e.HasOne<Facility>().WithMany().HasForeignKey(x => x.FacilityId);
        });

        b.Entity<FeeConfiguration>(e =>
        {
            e.ToTable("FeeConfigurations");
            e.HasKey(x => x.FeeTypeId);
        });

        b.Entity<Promotion>(e =>
        {
            e.ToTable("Promotions");
            e.HasKey(x => x.PromotionId);
            e.HasIndex(x => x.PromoCode).IsUnique();
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
            e.HasOne(x => x.Promotion).WithMany().HasForeignKey(x => x.PromotionId);
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
            e.HasOne<Promotion>().WithMany().HasForeignKey(x => x.PromotionId);
            e.HasIndex(x => x.CustomerId).IsUnique().HasFilter("[PromotionID] IS NOT NULL");
        });

        b.Entity<ReservationCancellationRequest>(e =>
        {
            e.ToTable("ReservationCancellationRequests");
            e.HasKey(x => x.CancellationRequestId);
            e.Property(x => x.RequestedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasIndex(x => x.ReservationId).IsUnique().HasFilter("[Status] = 'Pending'");
            e.HasOne(x => x.Reservation).WithMany().HasForeignKey(x => x.ReservationId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.ResolvedByStaffId);
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
            e.HasIndex(x => x.VisitRegistrationId);
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne(x => x.VisitRegistration).WithMany().HasForeignKey(x => x.VisitRegistrationId);
            e.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId);
            e.HasOne<Facility>().WithMany().HasForeignKey(x => x.FacilityId);
            e.HasOne(x => x.AuthorizedPerson).WithMany().HasForeignKey(x => x.AuthorizedPersonId);
            e.HasOne(x => x.VerifiedByStaff).WithMany().HasForeignKey(x => x.VerifiedByStaffId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.ExitConfirmedByStaffId);
        });

        b.Entity<EarlyReturnRequest>(e =>
        {
            e.ToTable("EarlyReturnRequests");
            e.HasKey(x => x.RequestId);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.Status).HasMaxLength(20).IsUnicode(false);
            e.Property(x => x.EarlyReturnFee).HasColumnType("decimal(18,2)");
            e.Property(x => x.RequestedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasIndex(x => new { x.ContractId, x.Status });
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.CompletedByStaffId);
        });

        b.Entity<VisitRegistration>(e =>
        {
            e.ToTable("VisitRegistrations");
            e.HasKey(x => x.VisitRegistrationId);
            e.Property(x => x.Purpose).HasMaxLength(255);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.RequestedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasIndex(x => new { x.ContractId, x.ScheduledEntryAt });
            e.HasIndex(x => new { x.Status, x.ScheduledEntryAt });
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.AuthorizedPerson).WithMany().HasForeignKey(x => x.AuthorizedPersonId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.ReviewedByStaffId);
        });

        b.Entity<ActivityLog>(e =>
        {
            e.ToTable("ActivityLogs");
            e.HasKey(x => x.LogId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId);
        });

        b.Entity<EmailOutboxMessage>(e =>
        {
            e.ToTable("EmailOutboxMessages");
            e.HasKey(x => x.EmailOutboxMessageId);
            e.Property(x => x.EventKey).HasMaxLength(150).IsUnicode(false);
            e.Property(x => x.RecipientEmail).HasMaxLength(254).IsUnicode(false);
            e.Property(x => x.RecipientName).HasMaxLength(200);
            e.Property(x => x.Subject).HasMaxLength(200);
            e.Property(x => x.Status).HasMaxLength(20).IsUnicode(false);
            e.Property(x => x.LastError).HasMaxLength(2000);
            e.HasIndex(x => x.EventKey).IsUnique();
            e.HasIndex(x => new { x.Status, x.NextAttemptAt, x.EmailOutboxMessageId });
        });

        b.Entity<Invoice>(e =>
        {
            e.ToTable("Invoices");
            e.HasKey(x => x.InvoiceId);
            e.Property(x => x.TotalAmount).HasComputedColumnSql("[SubTotal] - [DiscountAmount]", stored: true);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.Property(x => x.DiscountAmount).HasDefaultValue(0m);
            e.Property(x => x.Status).HasDefaultValue("Unpaid");
            e.HasIndex(x => new { x.ContractId, x.BillingPeriodStart })
                .IsUnique()
                .HasFilter("[InvoiceType] = 'MONTHLY_RENT' AND [ContractID] IS NOT NULL AND [BillingPeriodStart] IS NOT NULL");
            e.HasOne<Contract>().WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne<Reservation>().WithMany().HasForeignKey(x => x.ReservationId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
        });

        b.Entity<InvoiceDetail>(e =>
        {
            e.ToTable("InvoiceDetails");
            e.HasKey(x => x.DetailId);
            e.Property(x => x.LineTotal).HasComputedColumnSql("[Quantity] * [UnitPrice]", stored: true);
            e.Property(x => x.Quantity).HasDefaultValue(1);
            e.HasOne<Invoice>().WithMany(x => x.Details).HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Payment>(e =>
        {
            e.ToTable("Payments");
            e.HasKey(x => x.PaymentId);
            e.Property(x => x.GatewayPaymentUrl).HasMaxLength(2048);
            e.Property(x => x.GatewayQrCodeUrl).HasMaxLength(4000);
            e.Property(x => x.GatewayDeepLink).HasMaxLength(2048);
            e.Property(x => x.GatewayDeepLinkWebInApp).HasMaxLength(2048);
            e.Property(x => x.PaymentDate).HasDefaultValueSql("SYSDATETIME()");
            e.Property(x => x.Status).HasDefaultValue("Success");
            e.HasOne<Invoice>().WithMany(x => x.Payments).HasForeignKey(x => x.InvoiceId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.ReceivedByStaffId);
        });

        b.Entity<HandoverRecord>(e =>
        {
            e.ToTable("HandoverRecords");
            e.HasKey(x => x.HandoverId);
            e.Property(x => x.HandoverDateTime).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.StaffId);
        });

        b.Entity<ContractRenewal>(e =>
        {
            e.ToTable("ContractRenewals");
            e.HasKey(x => x.RenewalId);
            e.Property(x => x.RequestedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne<Contract>().WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.ApprovedByStaffId);
            e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId);
        });

        b.Entity<OverdueRecord>(e =>
        {
            e.ToTable("OverdueRecords");
            e.HasKey(x => x.OverdueId);
            e.Property(x => x.AccumulatedLateFee).HasDefaultValue(0m);
            e.Property(x => x.ActionTaken).HasDefaultValue("NoticeSent");
            e.HasOne<Contract>().WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.HandledByStaffId);
        });

        b.Entity<SupportRequest>(e =>
        {
            e.ToTable("SupportRequests");
            e.HasKey(x => x.RequestId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.Property(x => x.Status).HasDefaultValue("Open");
            e.HasOne(x => x.Contract).WithMany().HasForeignKey(x => x.ContractId);
            e.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.AssignedStaff).WithMany().HasForeignKey(x => x.AssignedStaffId);
            e.HasOne<Facility>().WithMany().HasForeignKey(x => x.FacilityId);
        });

        b.Entity<SupportUpdate>(e =>
        {
            e.ToTable("SupportUpdates");
            e.HasKey(x => x.UpdateId);
            e.Property(x => x.CreatedAt).HasDefaultValueSql("SYSDATETIME()");
            e.HasOne(x => x.Request).WithMany().HasForeignKey(x => x.RequestId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UpdatedByUserId);
        });

        b.Entity<SupportChecklistItem>(e =>
        {
            e.ToTable("SupportChecklistItems");
            e.HasKey(x => x.ChecklistItemId);
            e.Property(x => x.IsCompleted).HasDefaultValue(false);
            e.HasOne(x => x.Request).WithMany(x => x.ChecklistItems)
                .HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CompletedByStaff).WithMany().HasForeignKey(x => x.CompletedByStaffId);
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
