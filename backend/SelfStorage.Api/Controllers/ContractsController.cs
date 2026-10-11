using System.Linq.Expressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

/// <summary>Flow 3: the customer manages rented units, the gate PIN and who may enter on their behalf.</summary>
[ApiController]
[Route("api/contracts")]
[Authorize]
public class ContractsController(SelfStorageDbContext db, AccessService access, TimeProvider clock) : ControllerBase
{
    public static readonly Expression<Func<Contract, ContractDto>> ToDto = c => new ContractDto(
        c.ContractId, c.ContractNumber, c.Unit.FacilityId, c.Unit.Facility.FacilityName, c.Unit.UnitCode,
        c.StartDate, c.EndDate, c.MonthlyRentFee, c.Status, c.AccessPinHash != null, c.PinLockedUntil);

    [HttpGet("my")]
    [Authorize(Roles = AppRoles.Customer)]
    public Task<List<ContractDto>> Mine(CancellationToken ct)
    {
        var me = User.GetUserId();
        return db.Contracts.Where(c => c.CustomerId == me).OrderByDescending(c => c.StartDate).Select(ToDto).ToListAsync(ct);
    }

    /// <summary>Set or change the 6-digit gate PIN for this unit.</summary>
    [HttpPut("{id:int}/pin")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<IActionResult> SetPin(int id, SetPinRequest req, CancellationToken ct)
    {
        await access.SetPinAsync(User.GetUserId(), id, req, ct);
        return NoContent();
    }

    [HttpGet("{id:int}/authorized-persons")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<List<PersonDto>> AuthorizedPersons(int id, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        return await db.AuthorizedPersons.Where(p => p.ContractId == id && p.Status == "Active")
            .Select(p => new PersonDto(p.AuthorizedPersonId, p.FullName, p.CitizenId, p.PhoneNumber, p.Relationship))
            .ToListAsync(ct);
    }

    [HttpPost("{id:int}/authorized-persons")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<PersonDto> AddAuthorizedPerson(int id, AddAuthorizedPersonRequest req, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        var person = await db.AuthorizedPersons.FirstOrDefaultAsync(p => p.ContractId == id && p.CitizenId == req.CitizenId, ct);
        if (person is null)
        {
            person = new AuthorizedPerson { ContractId = id, CitizenId = req.CitizenId };
            db.AuthorizedPersons.Add(person);
        }
        else if (person.Status == "Active")
        {
            throw AppException.Conflict("Người này đã có trong danh sách");
        }
        // Re-adding a revoked person reactivates the same row (ContractID + CitizenID is unique).
        person.FullName = req.FullName;
        person.PhoneNumber = req.PhoneNumber;
        person.Relationship = req.Relationship;
        person.Status = "Active";
        person.RevokedAt = null;
        await db.SaveChangesAsync(ct);
        return new PersonDto(person.AuthorizedPersonId, person.FullName, person.CitizenId, person.PhoneNumber, person.Relationship);
    }

    [HttpDelete("{id:int}/authorized-persons/{personId:int}")]
    [Authorize(Roles = AppRoles.Customer)]
    public async Task<IActionResult> RevokeAuthorizedPerson(int id, int personId, CancellationToken ct)
    {
        await LoadOwnAsync(id, ct);
        var person = await db.AuthorizedPersons.FirstOrDefaultAsync(p => p.ContractId == id && p.AuthorizedPersonId == personId, ct)
                     ?? throw AppException.NotFound("Không tìm thấy người được ủy quyền");
        person.Status = "Revoked";
        person.RevokedAt = clock.GetLocalNow().DateTime;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Entry/exit history of this unit (customer: own contracts; staff: their facility).</summary>
    [HttpGet("{id:int}/access-history")]
    public async Task<List<AccessRecordDto>> AccessHistory(int id, CancellationToken ct)
    {
        var contract = await db.Contracts.Include(c => c.Unit).FirstOrDefaultAsync(c => c.ContractId == id, ct)
                       ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
        if (User.IsInRole(AppRoles.Customer))
        {
            if (contract.CustomerId != User.GetUserId()) throw AppException.NotFound("Không tìm thấy hợp đồng");
        }
        else
        {
            await access.EnsureAssignedAsync(User.GetUserId(), contract.Unit.FacilityId, ct);
        }
        return await access.GetHistoryAsync(id, ct);
    }

    private async Task<Contract> LoadOwnAsync(int id, CancellationToken ct)
    {
        var me = User.GetUserId();
        return await db.Contracts.FirstOrDefaultAsync(c => c.ContractId == id && c.CustomerId == me, ct)
               ?? throw AppException.NotFound("Không tìm thấy hợp đồng");
    }
}
