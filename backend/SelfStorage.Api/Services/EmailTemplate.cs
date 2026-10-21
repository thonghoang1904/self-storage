using System.Globalization;
using System.Net;

namespace SelfStorage.Api.Services;

public static class EmailTemplate
{
    private static readonly CultureInfo VietnameseCulture = CultureInfo.GetCultureInfo("vi-VN");

    public static EmailContent InvoiceIssued(
        string customerName,
        string invoiceNumber,
        string invoiceType,
        decimal totalAmount,
        DateOnly dueDate,
        string invoiceStatus,
        DateOnly? periodStart,
        DateOnly? periodEnd,
        string? contractNumber,
        string? reservationCode,
        IReadOnlyList<string> descriptions)
    {
        var invoiceTypeName = invoiceType switch
        {
            "DEPOSIT" => "Tiền đặt cọc",
            "MONTHLY_RENT" => "Tiền thuê kho",
            "RENEWAL" => "Phí gia hạn hợp đồng",
            "EXTRA_CHARGE" => "Khoản phí phát sinh",
            "OVERDUE_FINE" => "Phí lưu kho quá hạn",
            _ => "Khoản thanh toán",
        };
        var period = periodStart is not null && periodEnd is not null
            ? $"{FormatDate(periodStart.Value)} – {FormatDate(periodEnd.Value)}"
            : null;
        var details = string.Join(", ", descriptions);
        var paymentInstruction = invoiceStatus == "Paid"
            ? "<p>Hóa đơn này đã được ghi nhận là <strong>Đã thanh toán</strong>; không phát sinh khoản cần thanh toán thêm.</p>"
            : "<p>Để xem chi tiết và thanh toán, vui lòng đăng nhập ứng dụng Self-Storage và mở mục <strong>Hóa đơn</strong>. Email này là thông báo, không thay thế chứng từ thanh toán do hệ thống phát hành.</p><p>Nếu bạn đã thanh toán, vui lòng bỏ qua email này; trạng thái sẽ được cập nhật sau khi hệ thống xác nhận giao dịch.</p>";
        var html = $"""
            <p>Kính chào <strong>{Encode(customerName)}</strong>,</p>
            <p>Hệ thống Self-Storage vừa phát hành hóa đơn cho dịch vụ của bạn. Vui lòng kiểm tra thông tin và hạn thanh toán dưới đây.</p>
            {DetailsTable(
                ("Mã hóa đơn", invoiceNumber),
                ("Nội dung", invoiceTypeName),
                ("Hợp đồng", contractNumber ?? "—"),
                ("Mã đặt kho", reservationCode ?? "—"),
                ("Kỳ thanh toán", period ?? "—"),
                ("Chi tiết", string.IsNullOrWhiteSpace(details) ? "Theo thông tin trên hóa đơn" : details),
                ("Số tiền", FormatMoney(totalAmount)),
                ("Hạn thanh toán", FormatDate(dueDate)))}
            {paymentInstruction}
            """;
        var text = $"Kính chào {customerName},\r\n\r\n" +
                   $"Self-Storage đã phát hành hóa đơn {invoiceNumber}.\r\n" +
                   $"Nội dung: {invoiceTypeName}\r\n" +
                   $"Hợp đồng: {contractNumber ?? "—"}\r\n" +
                   $"Mã đặt kho: {reservationCode ?? "—"}\r\n" +
                   $"Kỳ thanh toán: {period ?? "—"}\r\n" +
                   $"Chi tiết: {(string.IsNullOrWhiteSpace(details) ? "Theo thông tin trên hóa đơn" : details)}\r\n" +
                   $"Số tiền: {FormatMoney(totalAmount)}\r\nHạn thanh toán: {FormatDate(dueDate)}\r\n\r\n" +
                   (invoiceStatus == "Paid"
                       ? "Hóa đơn đã được ghi nhận là Đã thanh toán; không phát sinh khoản cần thanh toán thêm."
                       : "Vui lòng đăng nhập ứng dụng Self-Storage, mục Hóa đơn để xem chi tiết và thanh toán. Nếu đã thanh toán, hãy bỏ qua email này trong khi hệ thống xác nhận giao dịch.");
        return Layout($"Thông báo hóa đơn {invoiceNumber}", "Thông báo hóa đơn", html, text);
    }

    public static EmailContent ContractCreated(
        string customerName,
        string contractNumber,
        string facilityName,
        string unitCode,
        DateOnly startDate,
        DateOnly endDate,
        decimal monthlyRent,
        decimal deposit)
    {
        var html = $"""
            <p>Kính chào <strong>{Encode(customerName)}</strong>,</p>
            <p>Việc bàn giao kho đã được ghi nhận và hợp đồng thuê của bạn đã được tạo trên hệ thống Self-Storage. Vui lòng kiểm tra thông tin hợp đồng trong tài khoản.</p>
            {DetailsTable(
                ("Mã hợp đồng", contractNumber),
                ("Cơ sở", facilityName),
                ("Mã kho", unitCode),
                ("Thời hạn", $"{FormatDate(startDate)} – {FormatDate(endDate)}"),
                ("Tiền thuê tháng", FormatMoney(monthlyRent)),
                ("Tiền cọc đã ghi nhận", FormatMoney(deposit)))}
            <p>Hóa đơn tiền thuê được quản lý riêng trong mục <strong>Hóa đơn</strong>. Vui lòng xem ngày đến hạn và trạng thái thanh toán trên ứng dụng. Nếu thông tin trên email chưa chính xác, hãy liên hệ cơ sở để được hỗ trợ.</p>
            """;
        var text = $"Kính chào {customerName},\r\n\r\n" +
                   $"Bàn giao kho đã được ghi nhận. Hợp đồng {contractNumber} đã được tạo trên hệ thống.\r\n" +
                   $"Cơ sở: {facilityName}\r\nMã kho: {unitCode}\r\n" +
                   $"Thời hạn: {FormatDate(startDate)} – {FormatDate(endDate)}\r\n" +
                   $"Tiền thuê tháng: {FormatMoney(monthlyRent)}\r\nTiền cọc đã ghi nhận: {FormatMoney(deposit)}\r\n\r\n" +
                   "Vui lòng đăng nhập ứng dụng Self-Storage để xem hợp đồng và hóa đơn.";
        return Layout($"Hợp đồng {contractNumber} đã được tạo", "Xác nhận bàn giao và hợp đồng", html, text);
    }

    public static EmailContent ContractRenewed(
        string customerName, string contractNumber, DateOnly oldEndDate, DateOnly newEndDate)
    {
        var html = $"""
            <p>Kính chào <strong>{Encode(customerName)}</strong>,</p>
            <p>Hệ thống đã xác nhận thanh toán phí gia hạn và cập nhật thời hạn hợp đồng của bạn.</p>
            {DetailsTable(
                ("Mã hợp đồng", contractNumber),
                ("Ngày hết hạn trước gia hạn", FormatDate(oldEndDate)),
                ("Ngày hết hạn mới", FormatDate(newEndDate)))}
            <p>Vui lòng đăng nhập ứng dụng Self-Storage để kiểm tra hợp đồng và hóa đơn. Nếu bạn không thực hiện yêu cầu này, hãy liên hệ cơ sở để được hỗ trợ.</p>
            """;
        var text = $"Kính chào {customerName},\r\n\r\n" +
                   $"Hợp đồng {contractNumber} đã được gia hạn sau khi hệ thống xác nhận thanh toán.\r\n" +
                   $"Ngày hết hạn trước: {FormatDate(oldEndDate)}\r\nNgày hết hạn mới: {FormatDate(newEndDate)}\r\n\r\n" +
                   "Vui lòng đăng nhập ứng dụng Self-Storage để kiểm tra thông tin.";
        return Layout($"Hợp đồng {contractNumber} đã được gia hạn", "Xác nhận gia hạn hợp đồng", html, text);
    }

    public static EmailContent ContractReturned(
        string customerName,
        string contractNumber,
        decimal depositRefundDue,
        decimal lateFeesDeducted,
        decimal lateFeesStillOwed)
    {
        var html = $"""
            <p>Kính chào <strong>{Encode(customerName)}</strong>,</p>
            <p>Việc trả kho và kết thúc hợp đồng đã được nhân viên ghi nhận. Các khoản dưới đây được tổng hợp theo biên bản tại thời điểm trả kho.</p>
            {DetailsTable(
                ("Mã hợp đồng", contractNumber),
                ("Tiền cọc dự kiến hoàn", FormatMoney(depositRefundDue)),
                ("Phí quá hạn đã cấn trừ từ cọc", FormatMoney(lateFeesDeducted)),
                ("Phí còn phải thanh toán", FormatMoney(lateFeesStillOwed)))}
            <p>Khoản hoàn cọc chỉ được xem là hoàn tất sau khi cơ sở ghi nhận giao dịch hoàn thực tế. Vui lòng liên hệ cơ sở nếu cần đối chiếu chi tiết.</p>
            """;
        var text = $"Kính chào {customerName},\r\n\r\n" +
                   $"Hợp đồng {contractNumber} đã kết thúc sau khi trả kho.\r\n" +
                   $"Tiền cọc dự kiến hoàn: {FormatMoney(depositRefundDue)}\r\n" +
                   $"Phí quá hạn đã cấn trừ: {FormatMoney(lateFeesDeducted)}\r\n" +
                   $"Phí còn phải thanh toán: {FormatMoney(lateFeesStillOwed)}\r\n\r\n" +
                   "Khoản hoàn cọc chỉ hoàn tất khi cơ sở ghi nhận giao dịch hoàn thực tế.";
        return Layout($"Xác nhận trả kho hợp đồng {contractNumber}", "Xác nhận trả kho", html, text);
    }

    public static EmailContent PaymentReceived(
        string customerName,
        string invoiceNumber,
        string invoiceType,
        decimal amount,
        DateTime paymentDate,
        string paymentMethod,
        string? transactionCode)
    {
        var invoiceTypeName = invoiceType switch
        {
            "DEPOSIT" => "Tiền đặt cọc",
            "MONTHLY_RENT" => "Tiền thuê kho",
            "RENEWAL" => "Phí gia hạn hợp đồng",
            "EXTRA_CHARGE" => "Khoản phí phát sinh",
            "OVERDUE_FINE" => "Phí lưu kho quá hạn",
            _ => "Khoản thanh toán",
        };
        var method = paymentMethod switch
        {
            "Cash" => "Tiền mặt tại cơ sở",
            "BankTransfer" => "Chuyển khoản",
            "MoMo" => "MoMo",
            "VNPay" => "VNPay",
            _ => paymentMethod,
        };
        var html = $"""
            <p>Kính chào <strong>{Encode(customerName)}</strong>,</p>
            <p>Hệ thống Self-Storage đã xác nhận khoản thanh toán dưới đây. Vui lòng lưu email để đối chiếu khi cần.</p>
            {DetailsTable(
                ("Mã hóa đơn", invoiceNumber),
                ("Nội dung", invoiceTypeName),
                ("Số tiền đã nhận", FormatMoney(amount)),
                ("Thời gian xác nhận", paymentDate.ToString("dd/MM/yyyy HH:mm", VietnameseCulture)),
                ("Phương thức", method),
                ("Mã giao dịch", transactionCode ?? "—"))}
            <p>Trạng thái hóa đơn được cập nhật trong mục <strong>Hóa đơn</strong> trên ứng dụng. Nếu thông tin chưa chính xác, vui lòng liên hệ bộ phận hỗ trợ và cung cấp mã hóa đơn.</p>
            """;
        var text = $"Kính chào {customerName},\r\n\r\nSelf-Storage đã xác nhận thanh toán.\r\n" +
                   $"Hóa đơn: {invoiceNumber}\r\nNội dung: {invoiceTypeName}\r\nSố tiền: {FormatMoney(amount)}\r\n" +
                   $"Thời gian: {paymentDate.ToString("dd/MM/yyyy HH:mm", VietnameseCulture)}\r\n" +
                   $"Phương thức: {method}\r\nMã giao dịch: {transactionCode ?? "—"}\r\n\r\n" +
                   "Vui lòng đăng nhập ứng dụng để xem trạng thái hóa đơn.";
        return Layout($"Đã xác nhận thanh toán hóa đơn {invoiceNumber}", "Xác nhận thanh toán", html, text);
    }

    public static EmailContent Layout(string subject, string heading, string bodyHtml, string bodyText)
    {
        var html = $"""
            <!doctype html>
            <html lang="vi">
              <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
              <body style="margin:0;background:#f1f4f7;font-family:Arial,Helvetica,sans-serif;color:#243447">
                <div style="max-width:620px;margin:28px auto;padding:0 14px">
                  <div style="background:#153b56;padding:22px 28px;border-radius:12px 12px 0 0;color:#fff">
                    <div style="font-size:20px;font-weight:700;letter-spacing:.4px">SELF-STORAGE</div>
                    <div style="margin-top:5px;font-size:13px;color:#d7e5ee">Hệ thống quản lý kho lưu trữ tự phục vụ</div>
                  </div>
                  <main style="background:#fff;padding:28px;border:1px solid #e1e7ec;border-top:0">
                    <h1 style="margin:0 0 20px;font-size:21px;line-height:1.4;color:#153b56">{Encode(heading)}</h1>
                    <div style="font-size:15px;line-height:1.65">{bodyHtml}</div>
                    <hr style="margin:26px 0 18px;border:0;border-top:1px solid #e5eaf0">
                    <p style="margin:0;color:#687786;font-size:12px;line-height:1.5">Email được gửi tự động từ Self-Storage. Vui lòng không trả lời trực tiếp email này. Thông tin giao dịch chính thức được lưu trong tài khoản của bạn.</p>
                  </main>
                  <footer style="padding:14px;text-align:center;color:#73808c;font-size:11px">© Self-Storage</footer>
                </div>
              </body>
            </html>
            """;
        return new EmailContent(subject, html, bodyText);
    }

    public static string Encode(string value) => WebUtility.HtmlEncode(value);

    public static string FormatMoney(decimal amount) =>
        string.Format(VietnameseCulture, "{0:N0} ₫", amount);

    public static string FormatDate(DateOnly date) =>
        date.ToString("dd/MM/yyyy", VietnameseCulture);

    private static string DetailsTable(params (string Label, string Value)[] rows)
    {
        var body = string.Join("", rows.Select(row =>
            $"""<tr><th style="padding:10px 12px;text-align:left;color:#526273;border-bottom:1px solid #e7edf2;width:38%">{Encode(row.Label)}</th><td style="padding:10px 12px;border-bottom:1px solid #e7edf2;font-weight:600">{Encode(row.Value)}</td></tr>"""));
        return $"""<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;background:#f8fafc">{body}</table>""";
    }
}
