using System.ComponentModel.DataAnnotations;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Dtos;

public record UserProfileDto(int UserId, string Username, string FullName, string Email, string PhoneNumber,
    string? CitizenId, string? Address, string Role, string Status, DateTime CreatedAt);

/// <summary>
/// A CCCD already on file cannot be changed here (staff verify it at the gate); an account without one
/// (e.g. created by an administrator) may fill it in once.
/// </summary>
public record UpdateProfileRequest(
    [Required, StringLength(100)] string FullName,
    [Required, StrictEmail] string Email,
    [Required, VnPhone] string PhoneNumber,
    [StringLength(255)] string? Address,
    [CitizenId] string? CitizenId = null);

public record ChangePasswordRequest(
    [Required, StringLength(100)] string CurrentPassword,
    [Required, StringLength(100, MinimumLength = 8)] string NewPassword);
