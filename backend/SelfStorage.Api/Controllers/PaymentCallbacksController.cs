using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SelfStorage.Api.Services;
using System.Text.Json.Serialization;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/payments")]
[AllowAnonymous]
public sealed class PaymentCallbacksController(PaymentGatewayService paymentGateways) : ControllerBase
{
    [HttpGet("vnpay/ipn")]
    public async Task<VnPayIpnResponse> VnPayIpn(CancellationToken ct)
    {
        var code = await paymentGateways.ProcessVnPayIpnAsync(Request.Query, ct);
        return new VnPayIpnResponse(code, code == "00" ? "Confirm Success" : "Invalid signature or transaction");
    }

    [HttpGet("vnpay/return")]
    public IActionResult VnPayReturn() => Redirect(paymentGateways.BuildFrontendReturnUrl("vnpay"));

    [HttpPost("momo/ipn")]
    public async Task<IActionResult> MomoIpn(MomoIpnRequest request, CancellationToken ct)
    {
        await paymentGateways.ProcessMomoIpnAsync(request, ct);
        return NoContent();
    }

    [HttpGet("momo/return")]
    public IActionResult MomoReturn() => Redirect(paymentGateways.BuildFrontendReturnUrl("momo"));

    public sealed record VnPayIpnResponse(
        [property: JsonPropertyName("RspCode")] string Code,
        [property: JsonPropertyName("Message")] string Message);
}
