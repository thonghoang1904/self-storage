namespace SelfStorage.Api.Data.Entities;

// String values must match the CHECK constraints in database/01_schema.sql

public static class AppRoles
{
    public const string Customer = "Storage Customer";
    public const string Staff = "Facility Staff";
    public const string Manager = "Facility Manager";
    public const string OpsManager = "Business Operations Manager";
    public const string Admin = "System Administrator";

    /// <summary>Roles that may work the gate (verify identity, confirm exit).</summary>
    public const string GateRoles = Staff + "," + Manager;
}

public static class UnitStatus
{
    public const string Available = "Available";
    public const string Reserved = "Reserved";
    public const string Rented = "Rented";
    public const string UnderMaintenance = "UnderMaintenance";
    public const string OverdueLocked = "OverdueLocked";
}

public static class ReservationStatus
{
    public const string PendingDeposit = "PendingDeposit";
    public const string Confirmed = "Confirmed";
    public const string CheckedIn = "CheckedIn";
    public const string Cancelled = "Cancelled";
    public const string Expired = "Expired";
}

public static class ContractStatus
{
    public const string Active = "Active";
    public const string Renewed = "Renewed";
    public const string Terminated = "Terminated";
    public const string Overdue = "Overdue";
    public const string Liquidated = "Liquidated";
}

public static class AccessResult
{
    public const string Granted = "Granted";
    public const string Denied = "Denied";
}

public static class DenyReasons
{
    public static readonly string[] All =
    [
        "IdentityMismatch", "NotAuthorized", "ContractEnded", "OverdueLocked",
        "OutsideOperatingHours", "UnitUnderMaintenance", "Other",
    ];
}

// Entry is verified by CCCD only.
public static class VerificationMethods
{
    public const string CitizenId = "CitizenID";
}
