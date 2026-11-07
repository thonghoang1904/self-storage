using System.Reflection;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using SelfStorage.Api.Data;
using SelfStorage.Api.Data.Entities;
using SelfStorage.Api.Infrastructure;
using SelfStorage.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ---- Data ----
builder.Services.AddDbContext<SelfStorageDbContext>(o =>
    o.UseSqlServer(builder.Configuration.GetConnectionString("SelfStorageDB")));

// ---- Services ----
// Business dates and times are Vietnam time (BusinessTimeZone), not the server's time zone.
builder.Services.AddSingleton<TimeProvider>(BusinessTimeProvider.FromConfiguration(builder.Configuration));
builder.Services.AddSingleton<DevelopmentDatabaseBootstrapper>();
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<GoogleAuthOptions>(builder.Configuration.GetSection(GoogleAuthOptions.SectionName));
builder.Services.Configure<SmtpEmailOptions>(builder.Configuration.GetSection(SmtpEmailOptions.SectionName));
builder.Services.Configure<PaymentGatewayOptions>(builder.Configuration.GetSection(PaymentGatewayOptions.SectionName));
builder.Services.AddTransient<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<AccessService>();
builder.Services.AddScoped<BillingService>();
builder.Services.AddScoped<RentalPolicyService>();
builder.Services.AddScoped<EmailOutboxService>();
builder.Services.AddHttpClient<PaymentGatewayService>(client => client.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddHostedService<OverdueService>();
builder.Services.AddHostedService<MonthlyRentInvoiceService>();
builder.Services.AddHostedService<EmailOutboxWorker>();

// ---- Auth (JWT) ----
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = jwt.Issuer,
        ValidAudience = jwt.Audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateIssuerSigningKey = true,
        ValidateLifetime = true,
    });
const string AuthFailureReasonKey = "SelfStorage.AuthFailureReason";
builder.Services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
{
    options.Events ??= new JwtBearerEvents();
    options.Events.OnAuthenticationFailed = context =>
    {
        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("JwtBearer");
        logger.LogWarning("Bearer token validation failed with {FailureType}.",
            context.Exception.GetType().Name);
        if (context.Exception is SecurityTokenExpiredException)
            context.HttpContext.Items[AuthFailureReasonKey] =
                "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
        return Task.CompletedTask;
    };
    options.Events.OnTokenValidated = async context =>
    {
        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("JwtBearer");
        var userIdValue = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var tokenRole = context.Principal?.FindFirstValue(ClaimTypes.Role);
        var sessionId = context.Principal?.FindFirstValue(TokenService.SessionClaimType)
            ?? context.Principal?.FindFirstValue(JwtRegisteredClaimNames.Jti);
        if (!int.TryParse(userIdValue, out var userId)
            || string.IsNullOrWhiteSpace(tokenRole)
            || string.IsNullOrWhiteSpace(sessionId))
        {
            logger.LogWarning("Bearer token rejected because account or session claims are missing or invalid.");
            context.HttpContext.Items[AuthFailureReasonKey] =
                "Phiên đăng nhập không hợp lệ hoặc đã cũ. Vui lòng đăng nhập lại.";
            context.Fail("Invalid account or session claims.");
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<SelfStorageDbContext>();
        var account = await db.Users.AsNoTracking()
            .Where(user => user.UserId == userId)
            .Select(user => new { user.Status, RoleName = user.Role.RoleName, user.ActiveSessionId })
            .SingleOrDefaultAsync(context.HttpContext.RequestAborted);
        if (account is null || account.Status != "Active")
        {
            logger.LogWarning("Bearer token rejected because account {UserId} is missing or inactive.", userId);
            context.HttpContext.Items[AuthFailureReasonKey] =
                "Tài khoản đã bị khóa hoặc ngừng hoạt động.";
            context.Fail("Account is inactive.");
            return;
        }

        if (!string.Equals(account.RoleName, tokenRole, StringComparison.Ordinal))
        {
            logger.LogWarning("Bearer token rejected because account {UserId} role changed.", userId);
            context.HttpContext.Items[AuthFailureReasonKey] =
                "Quyền hạn tài khoản đã thay đổi. Vui lòng đăng nhập lại.";
            context.Fail("Account role has changed.");
            return;
        }

        if (string.IsNullOrEmpty(account.ActiveSessionId)
            || !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(account.ActiveSessionId),
                Encoding.UTF8.GetBytes(sessionId)))
        {
            logger.LogWarning("Bearer token rejected because session for account {UserId} was superseded or signed out.", userId);
            context.HttpContext.Items[AuthFailureReasonKey] =
                "Phiên đăng nhập không còn hiệu lực (tài khoản vừa đăng nhập ở nơi khác hoặc đã đăng xuất). Vui lòng đăng nhập lại.";
            context.Fail("Session has been superseded or signed out.");
        }
    };
    options.Events.OnChallenge = async context =>
    {
        if (context.HttpContext.Items.TryGetValue(AuthFailureReasonKey, out var obj)
            && obj is string reason && !string.IsNullOrWhiteSpace(reason)
            && !context.Response.HasStarted)
        {
            context.HandleResponse();
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.Headers.WWWAuthenticate = "Bearer error=\"invalid_token\"";
            var problemDetails = context.HttpContext.RequestServices.GetRequiredService<IProblemDetailsService>();
            await problemDetails.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = context.HttpContext,
                ProblemDetails = new ProblemDetails
                {
                    Status = StatusCodes.Status401Unauthorized,
                    Title = reason,
                },
            });
        }
    };
});
builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()
    .WithExposedHeaders("X-Total-Count")));

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddControllers();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("password-reset", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(15),
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
    // Slows down password guessing: 10 sign-in attempts per minute per IP.
    options.AddPolicy("login", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
    // Prevents automated mass account creation: 5 registrations per 15 minutes per IP.
    options.AddPolicy("register", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(15),
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
});

// ---- Swagger ----
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Self-Storage API",
        Version = "v1",
        Description = "Thuê kho tự phục vụ; ra vào kho do nhân viên xác thực danh tính",
    });
    c.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, $"{Assembly.GetExecutingAssembly().GetName().Name}.xml"));

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "Lấy token từ POST /api/auth/login. Chỉ dán giá trị JWT, không thêm tiền tố 'Bearer'.",
    });
    c.AddSecurityRequirement(doc => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", doc)] = [],
    });
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRouting();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    await app.Services.GetRequiredService<DevelopmentDatabaseBootstrapper>().InitializeAsync();
    app.UseSwagger();
    app.UseSwaggerUI(c => c.DocumentTitle = "Self-Storage API");
    if (app.Configuration.GetValue<bool>("SeedDemoData"))
        await DevSeeder.SeedAsync(app.Services);
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.MapGet("/health", () => Results.Ok(new { status = "Healthy" })).AllowAnonymous();
app.MapGet("/health/ready", async (SelfStorageDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct)
        ? Results.Ok(new { status = "Healthy", database = "Connected" })
        : Results.Json(new { status = "Unhealthy", database = "Unreachable" },
            statusCode: StatusCodes.Status503ServiceUnavailable)).AllowAnonymous();

app.Run();
