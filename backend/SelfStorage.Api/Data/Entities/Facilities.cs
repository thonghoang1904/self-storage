namespace SelfStorage.Api.Data.Entities;

public class Facility
{
    public int FacilityId { get; set; }
    public string FacilityName { get; set; } = null!;
    public string Address { get; set; } = null!;
    public string City { get; set; } = null!;
    public string District { get; set; } = null!;
    public string Hotline { get; set; } = null!;
    public string OperatingHours { get; set; } = "24/7 Access";
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; }

    public ICollection<StorageUnit> Units { get; set; } = new List<StorageUnit>();
}

public class UnitType
{
    public int UnitTypeId { get; set; }
    public string TypeName { get; set; } = null!;
    public decimal LengthMeters { get; set; }
    public decimal WidthMeters { get; set; }
    public decimal HeightMeters { get; set; }
    public decimal VolumeCubicMeters { get; set; }   // computed column in SQL
    public bool HasClimateControl { get; set; }
    public decimal BaseDailyRate { get; set; }
    public decimal BaseMonthlyRate { get; set; }
    public string? Description { get; set; }
}

public class StorageUnit
{
    public int UnitId { get; set; }
    public int FacilityId { get; set; }
    public int UnitTypeId { get; set; }
    public string UnitCode { get; set; } = null!;
    public int FloorNumber { get; set; } = 1;
    public string? ZoneArea { get; set; }
    public decimal MonthlyPrice { get; set; }
    public string? SmartLockCode { get; set; }
    public string Status { get; set; } = UnitStatus.Available;
    public DateTime CreatedAt { get; set; }

    public Facility Facility { get; set; } = null!;
    public UnitType UnitType { get; set; } = null!;
}
