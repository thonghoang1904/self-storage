using Microsoft.AspNetCore.Identity;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

/// <summary>Hashing and strength rules for the 6-digit gate PIN. PINs are never stored in plain text.</summary>
public class PinService
{
    public const int PinLength = 6;
    private readonly PasswordHasher<Contract> _hasher = new();

    public string Hash(Contract contract, string pin) => _hasher.HashPassword(contract, pin);

    public bool Verify(Contract contract, string pin) =>
        contract.AccessPinHash is not null &&
        _hasher.VerifyHashedPassword(contract, contract.AccessPinHash, pin) != PasswordVerificationResult.Failed;

    public void EnsureStrong(string pin)
    {
        if (pin.Length != PinLength || !pin.All(char.IsAsciiDigit))
            throw AppException.BadRequest($"PIN phải gồm đúng {PinLength} chữ số");
        if (pin.Distinct().Count() == 1)
            throw AppException.BadRequest("PIN không được gồm toàn một chữ số");

        var ascending = Enumerable.Range(0, PinLength - 1).All(i => pin[i + 1] - pin[i] == 1);
        var descending = Enumerable.Range(0, PinLength - 1).All(i => pin[i] - pin[i + 1] == 1);
        if (ascending || descending)
            throw AppException.BadRequest("PIN không được là dãy số liên tiếp");
    }
}
