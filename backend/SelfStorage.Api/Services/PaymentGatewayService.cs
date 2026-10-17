using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Dtos;
using SelfStorage.Api.Infrastructure;

namespace SelfStorage.Api.Services;

public sealed class PaymentGatewayOptions
{
    public const string SectionName = "PaymentGateways";

    public string PublicBaseUrl { get; set; } = "";
    public string FrontendReturnUrl { get; set; } = "";
    public VnPayOptions VnPay { get; set; } = new();
    public MomoOptions Momo { get; set; } = new();
}

public sealed class VnPayOptions
{
    public bool Enabled { get; set; }
    public string PaymentUrl { get; set; } = "";
    public string TmnCode { get; set; } = "";
    public string HashSecret { get; set; } = "";
}

public sealed class MomoOptions
{
    public bool Enabled { get; set; }
    public string CreateUrl { get; set; } = "";
    public string PartnerCode { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
}

public sealed class MomoIpnRequest
{
    [JsonPropertyName("partnerCode")] public string PartnerCode { get; set; } = "";
    [JsonPropertyName("orderId")] public string OrderId { get; set; } = "";
    [JsonPropertyName("requestId")] public string RequestId { get; set; } = "";
    [JsonPropertyName("amount")] public long Amount { get; set; }
    [JsonPropertyName("orderInfo")] public string OrderInfo { get; set; } = "";
    [JsonPropertyName("orderType")] public string OrderType { get; set; } = "";
    [JsonPropertyName("transId")] public long TransactionId { get; set; }
    [JsonPropertyName("resultCode")] public int ResultCode { get; set; }
    [JsonPropertyName("message")] public string Message { get; set; } = "";
    [JsonPropertyName("payType")] public string PayType { get; set; } = "";
    [JsonPropertyName("responseTime")] public long ResponseTime { get; set; }
    [JsonPropertyName("extraData")] public string ExtraData { get; set; } = "";
    [JsonPropertyName("signature")] public string Signature { get; set; } = "";
}

public sealed class PaymentGatewayService(
    HttpClient http,
    IOptions<PaymentGatewayOptions> options,
    SelfStorageDbContext db,
    BillingService billing,
    TimeProvider clock)
{
    private readonly PaymentGatewayOptions settings = options.Value;

    public async Task<CheckoutResponse> StartCheckoutAsync(
        int invoiceId,
        int customerId,
        string provider,
        string? clientIp,
        CancellationToken ct)
    {
        var paymentMethod = provider.ToLowerInvariant() switch
        {
            "vnpay" => "VNPay",
            "momo" => "MoMo",
            _ => throw AppException.BadRequest("Cổng thanh toán chỉ hỗ trợ VNPay hoặc MoMo"),
        };
        EnsureConfigured(paymentMethod);

        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var invoice = await db.Invoices.FirstOrDefaultAsync(i =>
            i.InvoiceId == invoiceId && i.CustomerId == customerId, ct)
            ?? throw AppException.NotFound("Không tìm thấy hóa đơn");
        if (invoice.Status is not ("Unpaid" or "Overdue") || invoice.TotalAmount <= 0)
            throw AppException.Conflict("Hóa đơn không còn chờ thanh toán");
        if (paymentMethod == "MoMo" && invoice.TotalAmount != decimal.Truncate(invoice.TotalAmount))
            throw AppException.BadRequest("MoMo chỉ hỗ trợ hóa đơn có số tiền nguyên VND");
        if (paymentMethod == "VNPay" && invoice.TotalAmount * 100m > 999999999999m)
            throw AppException.BadRequest("Số tiền hóa đơn vượt giới hạn giao dịch của VNPay");
        if (await db.Payments.AnyAsync(p => p.InvoiceId == invoiceId && p.Status == "Pending", ct))
            throw AppException.Conflict("Hóa đơn đang có giao dịch trực tuyến chưa được xác nhận");

        await ValidateInvoiceCanBePaidAsync(invoice, ct);

        var reference = Guid.NewGuid().ToString("N");
        var payment = new Payment
        {
            InvoiceId = invoiceId,
            PaymentMethod = paymentMethod,
            TransactionCode = reference,
            AmountPaid = invoice.TotalAmount,
            PaymentDate = clock.GetLocalNow().DateTime,
            Status = "Pending",
            PaymentNotes = $"Đang chờ thanh toán {paymentMethod}.",
        };
        db.Payments.Add(payment);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        try
        {
            var paymentUrl = paymentMethod == "VNPay"
                ? CreateVnPayUrl(payment, invoice, clientIp)
                : await CreateMomoPaymentUrlAsync(payment, invoice, ct);
            return new CheckoutResponse(paymentMethod, payment.PaymentId, reference, invoice.TotalAmount, paymentUrl);
        }
        catch (HttpRequestException)
        {
            await MarkCheckoutFailedAsync(payment.PaymentId, ct);
            throw new AppException(StatusCodes.Status502BadGateway, "Không thể kết nối cổng thanh toán. Vui lòng thử lại.");
        }
        catch (JsonException)
        {
            await MarkCheckoutFailedAsync(payment.PaymentId, ct);
            throw new AppException(StatusCodes.Status502BadGateway, "Cổng thanh toán trả về phản hồi không hợp lệ.");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            await MarkCheckoutFailedAsync(payment.PaymentId, ct);
            throw new AppException(StatusCodes.Status502BadGateway, "Cổng thanh toán phản hồi quá thời gian.");
        }
    }

    public async Task<string> ProcessVnPayIpnAsync(IQueryCollection query, CancellationToken ct)
    {
        var fields = query.ToDictionary(pair => pair.Key, pair => pair.Value.ToString(), StringComparer.Ordinal);
        var signature = fields.GetValueOrDefault("vnp_SecureHash");
        if (string.IsNullOrWhiteSpace(signature) || !VerifyVnPaySignature(fields, signature))
            return "97";
        if (fields.GetValueOrDefault("vnp_TmnCode") != settings.VnPay.TmnCode
            || fields.GetValueOrDefault("vnp_CurrCode") != "VND"
            || fields.GetValueOrDefault("vnp_Command") != "pay")
            return "97";
        if (!fields.TryGetValue("vnp_TxnRef", out var reference)
            || !fields.TryGetValue("vnp_Amount", out var rawAmount)
            || !long.TryParse(rawAmount, NumberStyles.None, CultureInfo.InvariantCulture, out var amountInMinorUnits))
            return "01";

        var amount = amountInMinorUnits / 100m;
        var expectedAmount = await db.Payments.Where(p =>
                p.PaymentMethod == "VNPay" && p.TransactionCode == reference)
            .Select(p => (decimal?)p.AmountPaid).SingleOrDefaultAsync(ct);
        if (expectedAmount is null) return "01";
        if (expectedAmount.Value != amount) return "04";
        var succeeded = fields.GetValueOrDefault("vnp_ResponseCode") == "00"
            && fields.GetValueOrDefault("vnp_TransactionStatus") == "00";
        await billing.CompleteOnlinePaymentAsync("VNPay", reference, amount, succeeded,
            fields.GetValueOrDefault("vnp_TransactionNo"), ct);
        return "00";
    }

    public async Task ProcessMomoIpnAsync(MomoIpnRequest request, CancellationToken ct)
    {
        if (request.PartnerCode != settings.Momo.PartnerCode
            || !VerifyMomoIpnSignature(request, settings.Momo.AccessKey, settings.Momo.SecretKey))
            throw AppException.BadRequest("Chữ ký hoặc mã đối tác MoMo không hợp lệ");

        await billing.CompleteOnlinePaymentAsync("MoMo", request.OrderId, request.Amount,
            request.ResultCode == 0, request.TransactionId.ToString(CultureInfo.InvariantCulture), ct);
    }

    public string BuildFrontendReturnUrl(string provider)
    {
        var uri = new UriBuilder(RequireAbsoluteUrl(settings.FrontendReturnUrl, "FrontendReturnUrl"));
        var existingQuery = uri.Query.TrimStart('?');
        var status = $"gateway={WebUtility.UrlEncode(provider)}&paymentReturn=1";
        uri.Query = string.IsNullOrEmpty(existingQuery) ? status : $"{existingQuery}&{status}";
        return uri.Uri.AbsoluteUri;
    }

    private async Task ValidateInvoiceCanBePaidAsync(Data.Entities.Invoice invoice, CancellationToken ct)
    {
        var now = clock.GetLocalNow().DateTime;
        if (invoice.InvoiceType == "DEPOSIT")
        {
            if (invoice.ReservationId is not int reservationId)
                throw AppException.Conflict("Hóa đơn cọc không liên kết với đơn đặt kho");
            var reservation = await db.Reservations.FirstOrDefaultAsync(r => r.ReservationId == reservationId, ct)
                ?? throw AppException.NotFound("Không tìm thấy đơn đặt kho");
            if (reservation.Status != ReservationStatus.PendingDeposit || reservation.DepositDeadline <= now
                || reservation.DepositAmount != invoice.TotalAmount)
                throw AppException.Conflict("Đơn đặt kho đã hết hạn hoặc số tiền cọc không còn hợp lệ");
        }
        else if (invoice.InvoiceType == "RENEWAL")
        {
            var renewal = await db.ContractRenewals.FirstOrDefaultAsync(r => r.InvoiceId == invoice.InvoiceId, ct)
                ?? throw AppException.Conflict("Hóa đơn không liên kết với yêu cầu gia hạn");
            if (renewal.Status != "Pending" || renewal.RenewalFee != invoice.TotalAmount)
                throw AppException.Conflict("Yêu cầu gia hạn không còn hợp lệ");
        }
    }

    private void EnsureConfigured(string paymentMethod)
    {
        var enabled = paymentMethod == "VNPay" ? settings.VnPay.Enabled : settings.Momo.Enabled;
        if (!enabled) throw AppException.Conflict($"Thanh toán {paymentMethod} chưa được bật");
        RequireAbsoluteUrl(settings.PublicBaseUrl, "PublicBaseUrl");
        RequireAbsoluteUrl(settings.FrontendReturnUrl, "FrontendReturnUrl");
        if (paymentMethod == "VNPay")
        {
            if (string.IsNullOrWhiteSpace(settings.VnPay.TmnCode)
                || string.IsNullOrWhiteSpace(settings.VnPay.HashSecret))
                throw AppException.Conflict("Thiếu cấu hình mã merchant hoặc hash secret của VNPay");
            RequireAbsoluteUrl(settings.VnPay.PaymentUrl, "VnPay:PaymentUrl");
        }
        else
        {
            if (string.IsNullOrWhiteSpace(settings.Momo.PartnerCode)
                || string.IsNullOrWhiteSpace(settings.Momo.AccessKey)
                || string.IsNullOrWhiteSpace(settings.Momo.SecretKey))
                throw AppException.Conflict("Thiếu cấu hình PartnerCode, AccessKey hoặc SecretKey của MoMo");
            RequireAbsoluteUrl(settings.Momo.CreateUrl, "Momo:CreateUrl");
        }
    }

    private string CreateVnPayUrl(Payment payment, Data.Entities.Invoice invoice, string? clientIp)
    {
        var now = clock.GetUtcNow().ToOffset(TimeSpan.FromHours(7));
        var fields = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["vnp_Version"] = "2.1.0",
            ["vnp_Command"] = "pay",
            ["vnp_TmnCode"] = settings.VnPay.TmnCode,
            ["vnp_Amount"] = checked((long)(payment.AmountPaid * 100m)).ToString(CultureInfo.InvariantCulture),
            ["vnp_CreateDate"] = now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture),
            ["vnp_CurrCode"] = "VND",
            ["vnp_IpAddr"] = string.IsNullOrWhiteSpace(clientIp) ? "127.0.0.1" : clientIp,
            ["vnp_Locale"] = "vn",
            ["vnp_OrderInfo"] = $"Thanh toan hoa don {invoice.InvoiceNumber}",
            ["vnp_OrderType"] = "other",
            ["vnp_ReturnUrl"] = $"{settings.PublicBaseUrl.TrimEnd('/')}/api/payments/vnpay/return",
            ["vnp_TxnRef"] = payment.TransactionCode!,
            ["vnp_ExpireDate"] = now.AddMinutes(15).ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture),
        };
        var hashData = string.Join("&", fields.Select(pair =>
            $"{WebUtility.UrlEncode(pair.Key)}={WebUtility.UrlEncode(pair.Value)}"));
        fields["vnp_SecureHash"] = Convert.ToHexString(HMACSHA512.HashData(
            Encoding.UTF8.GetBytes(settings.VnPay.HashSecret), Encoding.UTF8.GetBytes(hashData))).ToLowerInvariant();
        var query = string.Join("&", fields.Select(pair =>
            $"{WebUtility.UrlEncode(pair.Key)}={WebUtility.UrlEncode(pair.Value)}"));
        return $"{settings.VnPay.PaymentUrl}?{query}";
    }

    private async Task<string> CreateMomoPaymentUrlAsync(
        Payment payment,
        Data.Entities.Invoice invoice,
        CancellationToken ct)
    {
        var callbackBase = settings.PublicBaseUrl.TrimEnd('/');
        var request = new MomoCreateRequest
        {
            PartnerCode = settings.Momo.PartnerCode,
            RequestId = payment.TransactionCode!,
            Amount = checked((long)payment.AmountPaid),
            OrderId = payment.TransactionCode!,
            OrderInfo = $"Thanh toan hoa don {invoice.InvoiceNumber}",
            RedirectUrl = $"{callbackBase}/api/payments/momo/return",
            IpnUrl = $"{callbackBase}/api/payments/momo/ipn",
            RequestType = "captureWallet",
            ExtraData = "",
        };
        request.Signature = SignMomoRequest(request, settings.Momo.AccessKey, settings.Momo.SecretKey);
        using var response = await http.PostAsJsonAsync(settings.Momo.CreateUrl, request, ct);
        var result = await response.Content.ReadFromJsonAsync<MomoCreateResponse>(cancellationToken: ct);
        if (!response.IsSuccessStatusCode || result?.ResultCode != 0 || string.IsNullOrWhiteSpace(result.PayUrl))
        {
            await MarkCheckoutFailedAsync(payment.PaymentId, ct);
            throw new AppException(StatusCodes.Status502BadGateway,
                $"MoMo không tạo được giao dịch (mã phản hồi {result?.ResultCode.ToString(CultureInfo.InvariantCulture) ?? "không rõ"}).");
        }
        return result.PayUrl;
    }

    private async Task MarkCheckoutFailedAsync(int paymentId, CancellationToken ct)
    {
        var payment = await db.Payments.FirstOrDefaultAsync(p => p.PaymentId == paymentId, ct);
        if (payment is null || payment.Status != "Pending") return;
        payment.Status = "Failed";
        payment.PaymentNotes = "Không thể khởi tạo giao dịch với cổng thanh toán.";
        await db.SaveChangesAsync(ct);
    }

    private static Uri RequireAbsoluteUrl(string value, string settingName)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
            throw AppException.Conflict($"Cấu hình {settingName} phải là URL đầy đủ (http/https)");
        return uri;
    }

    private bool VerifyVnPaySignature(IReadOnlyDictionary<string, string> fields, string signature)
    {
        var hashFields = new SortedDictionary<string, string>(
            fields.Where(pair => pair.Key is not ("vnp_SecureHash" or "vnp_SecureHashType"))
                .ToDictionary(pair => pair.Key, pair => pair.Value),
            StringComparer.Ordinal);
        var hashData = string.Join("&", hashFields.Select(pair =>
            $"{WebUtility.UrlEncode(pair.Key)}={WebUtility.UrlEncode(pair.Value)}"));
        var expected = HMACSHA512.HashData(Encoding.UTF8.GetBytes(settings.VnPay.HashSecret),
            Encoding.UTF8.GetBytes(hashData));
        try
        {
            return CryptographicOperations.FixedTimeEquals(expected, Convert.FromHexString(signature));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool VerifyMomoIpnSignature(MomoIpnRequest request, string accessKey, string secretKey)
    {
        var raw = $"accessKey={accessKey}&amount={request.Amount.ToString(CultureInfo.InvariantCulture)}"
            + $"&extraData={request.ExtraData}&message={request.Message}&orderId={request.OrderId}"
            + $"&orderInfo={request.OrderInfo}&orderType={request.OrderType}&partnerCode={request.PartnerCode}"
            + $"&payType={request.PayType}&requestId={request.RequestId}"
            + $"&responseTime={request.ResponseTime.ToString(CultureInfo.InvariantCulture)}"
            + $"&resultCode={request.ResultCode.ToString(CultureInfo.InvariantCulture)}"
            + $"&transId={request.TransactionId.ToString(CultureInfo.InvariantCulture)}";
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secretKey), Encoding.UTF8.GetBytes(raw));
        try
        {
            return CryptographicOperations.FixedTimeEquals(expected, Convert.FromHexString(request.Signature));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string SignMomoRequest(MomoCreateRequest request, string accessKey, string secretKey)
    {
        var raw = $"accessKey={accessKey}&amount={request.Amount.ToString(CultureInfo.InvariantCulture)}"
            + $"&extraData={request.ExtraData}&ipnUrl={request.IpnUrl}&orderId={request.OrderId}"
            + $"&orderInfo={request.OrderInfo}&partnerCode={request.PartnerCode}&redirectUrl={request.RedirectUrl}"
            + $"&requestId={request.RequestId}&requestType={request.RequestType}";
        return Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(secretKey), Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
    }

    private sealed class MomoCreateRequest
    {
        [JsonPropertyName("partnerCode")] public string PartnerCode { get; set; } = "";
        [JsonPropertyName("requestId")] public string RequestId { get; set; } = "";
        [JsonPropertyName("amount")] public long Amount { get; set; }
        [JsonPropertyName("orderId")] public string OrderId { get; set; } = "";
        [JsonPropertyName("orderInfo")] public string OrderInfo { get; set; } = "";
        [JsonPropertyName("redirectUrl")] public string RedirectUrl { get; set; } = "";
        [JsonPropertyName("ipnUrl")] public string IpnUrl { get; set; } = "";
        [JsonPropertyName("requestType")] public string RequestType { get; set; } = "";
        [JsonPropertyName("extraData")] public string ExtraData { get; set; } = "";
        [JsonPropertyName("signature")] public string Signature { get; set; } = "";
        [JsonPropertyName("lang")] public string Lang { get; set; } = "vi";
    }

    private sealed class MomoCreateResponse
    {
        [JsonPropertyName("resultCode")] public int ResultCode { get; set; }
        [JsonPropertyName("payUrl")] public string? PayUrl { get; set; }
    }
}
