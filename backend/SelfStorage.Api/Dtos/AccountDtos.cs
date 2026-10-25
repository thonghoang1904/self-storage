using System.ComponentModel.DataAnnotations;

namespace SelfStorage.Api.Dtos;

public record UserProfileDto(int UserId, string Username, string FullName, string Email, string PhoneNumber,
    string? CitizenId, string? Address, string Role, string Status, DateTime CreatedAt);

/// <summary>CitizenId is not editable here: staff verify it at the gate.</summary>
public record UpdateProfileRequest(
    [Required, StringLength(100)] string FullName,
    [Required, EmailAddress, StringLength(100)] string Email,
    [Required, StringLength(20)] string PhoneNumber,
    [StringLength(255)] string? Address);

public record ChangePasswordRequest(
    [Required, StringLength(100)] string CurrentPassword,
    [Required, StringLength(100, MinimumLength = 8)] string NewPassword);
