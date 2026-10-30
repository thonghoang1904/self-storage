using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;
using System.Text.Json.Serialization;

namespace SelfStorage.Api.Controllers;

[ApiController]
[Route("api/payments")]
[AllowAnonymous]
public sealed class PaymentCallbacksController(
    PaymentGatewayService paymentGateways,
    ILogger<PaymentCallbacksController> logger) : ControllerBase
{
    /// <summary>VNPay always expects HTTP 200 with an RspCode, also when something goes wrong on our side.</summary>
    [HttpGet("vnpay/ipn")]
    public async Task<VnPayIpnResponse> VnPayIpn(CancellationToken ct)
    {
        string code;
        try
        {
            code = await paymentGateways.ProcessVnPayIpnAsync(Request.Query, ct);
        }
        catch (AppException ex)
        {
            logger.LogWarning("VNPay IPN rejected: {Reason}", ex.Message);
            code = ex.StatusCode == StatusCodes.Status404NotFound ? "01" : "99";
        }
        return new VnPayIpnResponse(code, code switch
        {
            "00" => "Confirm Success",
            "01" => "Order not found",
            "02" => "Order already confirmed",
            "04" => "Invalid amount",
            "97" => "Invalid signature",
            _ => "Unknown error",
        });
    }

    /// <summary>Applies the signed result the customer brings back (see ProcessVnPayReturnAsync), then shows the invoices.</summary>
    [HttpGet("vnpay/return")]
    public async Task<IActionResult> VnPayReturn(CancellationToken ct)
    {
        string? result = null;
        try
        {
            result = await paymentGateways.ProcessVnPayReturnAsync(Request.Query, ct);
        }
        catch (AppException ex)
        {
            logger.LogWarning("VNPay return not applied: {Reason}", ex.Message);
        }
        return Redirect(paymentGateways.BuildFrontendReturnUrl("vnpay", result));
    }

    [HttpPost("momo/ipn")]
    public async Task<IActionResult> MomoIpn(MomoIpnRequest request, CancellationToken ct)
    {
        try
        {
            await paymentGateways.ProcessMomoIpnAsync(request, ct);
        }
        catch (AppException ex) when (ex.StatusCode != StatusCodes.Status400BadRequest)
        {
            // Signed and verified, but not applicable (unknown order, amount mismatch): logged for reconciliation;
            // MoMo would otherwise retry the same notification. A bad signature still gets 400.
            logger.LogWarning("MoMo IPN for order {OrderId} not applied: {Reason}", request.OrderId, ex.Message);
        }
        return NoContent();
    }

    [HttpGet("momo/return")]
    public IActionResult MomoReturn() => Redirect(paymentGateways.BuildFrontendReturnUrl("momo"));

    public sealed record VnPayIpnResponse(
        [property: JsonPropertyName("RspCode")] string Code,
        [property: JsonPropertyName("Message")] string Message);
}
