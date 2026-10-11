using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

/// <summary>Staff on duty at the gate: confirm visitor identity, then confirm exit.</summary>
[ApiController]
[Route("api/gate")]
[Authorize(Roles = AppRoles.GateRoles)]
public class GateController(AccessService access) : ControllerBase
{
    /// <summary>Facilities the signed-in staff member is assigned to.</summary>
    [HttpGet("my-facilities")]
    public Task<List<FacilityDto>> MyFacilities(CancellationToken ct) =>
        access.GetAssignedFacilitiesAsync(User.GetUserId(), ct);

    /// <summary>Visitors who entered a correct PIN and are waiting for ID check.</summary>
    [HttpGet("facilities/{facilityId:int}/pending")]
    public Task<IReadOnlyList<PendingAccessDto>> Pending(int facilityId, CancellationToken ct) =>
        access.GetPendingAsync(User.GetUserId(), facilityId, ct);

    /// <summary>Visitors currently inside the facility.</summary>
    [HttpGet("facilities/{facilityId:int}/inside")]
    public Task<IReadOnlyList<AccessRecordDto>> Inside(int facilityId, CancellationToken ct) =>
        access.GetInsideAsync(User.GetUserId(), facilityId, ct);

    /// <summary>ID checked and matches: let the visitor in.</summary>
    [HttpPost("requests/{requestId:long}/approve")]
    public Task<AccessRecordDto> Approve(long requestId, ApproveAccessRequest req, CancellationToken ct) =>
        access.ApproveAsync(User.GetUserId(), requestId, req, ct);

    /// <summary>Refuse entry. Reason: IdentityMismatch, NotAuthorized, ContractEnded, OverdueLocked, OutsideOperatingHours, UnitUnderMaintenance, Other.</summary>
    [HttpPost("requests/{requestId:long}/deny")]
    public Task<AccessRecordDto> Deny(long requestId, DenyAccessRequest req, CancellationToken ct) =>
        access.DenyAsync(User.GetUserId(), requestId, req, ct);

    /// <summary>Visitor has left the facility.</summary>
    [HttpPost("requests/{requestId:long}/exit")]
    public Task<AccessRecordDto> ConfirmExit(long requestId, CancellationToken ct) =>
        access.ConfirmExitAsync(User.GetUserId(), requestId, ct);

    /// <summary>Clear a forgotten PIN after checking the customer's ID at the counter.</summary>
    [HttpPost("contracts/{contractId:int}/reset-pin")]
    public async Task<IActionResult> ResetPin(int contractId, CancellationToken ct)
    {
        await access.ResetPinAsync(User.GetUserId(), contractId, ct);
        return NoContent();
    }
}
