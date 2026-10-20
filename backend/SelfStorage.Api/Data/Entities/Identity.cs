namespace SelfStorage.Api.Data.Entities;

public class Role
{
    public int RoleId { get; set; }
    public string RoleName { get; set; } = null!;
    public string? Description { get; set; }
}

public class User
{
    public int UserId { get; set; }
    public int RoleId { get; set; }
    public string Username { get; set; } = null!;
    public string PasswordHash { get; set; } = null!;
    public string FullName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string? GoogleSubject { get; set; }
    public string PhoneNumber { get; set; } = null!;
    public string? CitizenId { get; set; }
    public string? Address { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Role Role { get; set; } = null!;
}

public class FacilityStaffAssignment
{
    public int AssignmentId { get; set; }
    public int FacilityId { get; set; }
    public int StaffId { get; set; }
    public DateOnly AssignedDate { get; set; }
    public string Status { get; set; } = "Active";

    public Facility Facility { get; set; } = null!;
    public User Staff { get; set; } = null!;
}
