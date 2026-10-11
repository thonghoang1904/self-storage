using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

namespace SelfStorage.Api.Controllers;

/// <summary>Gate kiosk: the visitor types the unit code and PIN, then waits for staff to check their ID.</summary>
[ApiController]
[Route("api/kiosk")]
[AllowAnonymous]
[KioskAuth]
[EnableRateLimiting("kiosk")]
public class KioskController(AccessService access) : ControllerBase
{
    /// <summary>Visitor enters unit code + PIN. On success a Pending request is created for staff.</summary>
    [HttpPost("pin")]
    public Task<KioskRequestStatus> EnterPin(KioskPinRequest req, CancellationToken ct) =>
        access.EnterPinAsync(HttpContext.GetKioskFacilityId(), req, ct);

    /// <summary>Kiosk polls this until staff grants or denies.</summary>
    [HttpGet("requests/{requestId:long}")]
    public Task<KioskRequestStatus> GetStatus(long requestId, CancellationToken ct) =>
        access.GetKioskStatusAsync(HttpContext.GetKioskFacilityId(), requestId, ct);
}
