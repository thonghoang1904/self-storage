using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

/// <summary>Staff on duty at the gate: verify the visitor's identity, record entry or denial, confirm exit.</summary>
[ApiController]
[Route("api/gate")]
[Authorize(Roles = AppRoles.GateRoles)]
public class GateController(AccessService access) : ControllerBase
{
    /// <summary>Facilities the signed-in staff member is assigned to.</summary>
    [HttpGet("my-facilities")]
    public Task<List<FacilityDto>> MyFacilities(CancellationToken ct) =>
        access.GetAssignedFacilitiesAsync(User.GetUserId(), ct);

    /// <summary>Find the visitor's contract by unit code, contract number, CCCD or phone (customer or authorized person).</summary>
    [HttpGet("facilities/{facilityId:int}/lookup")]
    public Task<IReadOnlyList<VisitCandidateDto>> Lookup(int facilityId, [FromQuery] string q, CancellationToken ct) =>
        access.LookupAsync(User.GetUserId(), facilityId, q, ct);

    /// <summary>ID checked and matches: record entry (Granted).</summary>
    [HttpPost("facilities/{facilityId:int}/entries")]
    public Task<AccessRecordDto> GrantEntry(int facilityId, GrantEntryRequest req, CancellationToken ct) =>
        access.GrantEntryAsync(User.GetUserId(), facilityId, req, ct);

    /// <summary>Refuse entry. Reason: IdentityMismatch, NotAuthorized, ContractEnded, OverdueLocked, OutsideOperatingHours, UnitUnderMaintenance, Other.</summary>
    [HttpPost("facilities/{facilityId:int}/denials")]
    public Task<AccessRecordDto> DenyEntry(int facilityId, DenyEntryRequest req, CancellationToken ct) =>
        access.DenyEntryAsync(User.GetUserId(), facilityId, req, ct);

    /// <summary>Visitors currently inside the facility.</summary>
    [HttpGet("facilities/{facilityId:int}/inside")]
    public Task<IReadOnlyList<AccessRecordDto>> Inside(int facilityId, CancellationToken ct) =>
        access.GetInsideAsync(User.GetUserId(), facilityId, ct);

    /// <summary>All entries and denials recorded today.</summary>
    [HttpGet("facilities/{facilityId:int}/today")]
    public Task<IReadOnlyList<AccessRecordDto>> Today(int facilityId, CancellationToken ct) =>
        access.GetTodayAsync(User.GetUserId(), facilityId, ct);

    /// <summary>Visitor has left the facility.</summary>
    [HttpPost("access-records/{accessRecordId:long}/exit")]
    public Task<AccessRecordDto> ConfirmExit(long accessRecordId, CancellationToken ct) =>
        access.ConfirmExitAsync(User.GetUserId(), accessRecordId, ct);
}
