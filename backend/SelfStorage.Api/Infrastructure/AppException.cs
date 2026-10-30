using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace SelfStorage.Api.Infrastructure;

/// <summary>Business-rule error; turned into a ProblemDetails response with the given status.</summary>
public class AppException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;

    public static AppException NotFound(string message) => new(StatusCodes.Status404NotFound, message);
    public static AppException BadRequest(string message) => new(StatusCodes.Status400BadRequest, message);
    public static AppException Conflict(string message) => new(StatusCodes.Status409Conflict, message);
    public static AppException Forbidden(string message) => new(StatusCodes.Status403Forbidden, message);
}

public class AppExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    // Unique keys in database/*.sql. Two requests racing past the AnyAsync checks end up here.
    private static readonly Dictionary<string, string> DuplicateMessages = new()
    {
        ["UQ_Users_Username"] = "Tên đăng nhập đã được sử dụng",
        ["UQ_Users_Email"] = "Email đã được sử dụng",
        ["UQ_Users_CitizenID"] = "Số CCCD đã được đăng ký cho tài khoản khác",
        ["UX_Users_GoogleSubject"] = "Tài khoản Google này đã được liên kết với tài khoản khác",
        ["UQ_AuthPersons_Contract_Citizen"] = "Người này đã có trong danh sách được ủy quyền",
        ["UQ_Contracts_Reservation"] = "Đơn đặt kho này đã được bàn giao",
        ["UX_Contracts_Customer_FirstPromotion"] = "Ưu đãi lần đầu đã được áp dụng cho một hợp đồng khác",
        ["UQ_Facility_UnitCode"] = "Mã kho đã tồn tại ở cơ sở này",
        ["UQ_Promotions_Code"] = "Mã khuyến mãi đã tồn tại",
        ["UQ_FeeConfig_FeeCode"] = "Mã phí đã tồn tại",
        ["UQ_Staff_Facility"] = "Nhân viên đã được phân công tại cơ sở này",
        ["UX_Payments_TransactionCode"] = "Mã giao dịch đã được ghi nhận",
        ["UX_AccessRecords_OneActiveVisit"] = "Người này đang ở trong kho, hãy xác nhận ra trước",
        ["UX_CancellationRequests_Reservation_Pending"] = "Đơn này đang có yêu cầu hủy chờ xử lý",
        ["UX_EarlyReturnRequests_PendingContract"] = "Hợp đồng đã có yêu cầu trả kho sớm đang chờ",
        ["UX_ContractRenewals_InvoiceID"] = "Hóa đơn này đã gắn với một yêu cầu gia hạn khác",
        ["UX_Invoices_MonthlyRentPeriod"] = "Hóa đơn tiền thuê của kỳ này đã được tạo",
    };

    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception ex, CancellationToken ct)
    {
        var (status, title) = ex switch
        {
            AppException app => (app.StatusCode, app.Message),
            DbUpdateException { InnerException: SqlException { Number: 2601 or 2627 } sql } =>
                (StatusCodes.Status409Conflict,
                    DuplicateMessages.FirstOrDefault(m => sql.Message.Contains(m.Key)).Value
                    ?? "Dữ liệu đã tồn tại, vui lòng kiểm tra lại"),
            _ => (0, ""),
        };
        if (status == 0) return false;

        http.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = http,
            ProblemDetails = new ProblemDetails { Status = status, Title = title },
        });
    }
}
