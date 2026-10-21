using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
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
var businessTimeZone = TimeZoneInfo.FindSystemTimeZoneById(BusinessTimeProvider.VietnamTimeZoneId);
builder.Services.AddSingleton<TimeProvider>(new BusinessTimeProvider(businessTimeZone));
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
builder.Services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
{
    options.Events ??= new JwtBearerEvents();
    options.Events.OnAuthenticationFailed = context =>
    {
        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("JwtBearer");
        logger.LogWarning("Bearer token validation failed with {FailureType}.",
            context.Exception.GetType().Name);
        return Task.CompletedTask;
    };
    options.Events.OnTokenValidated = async context =>
    {
        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("JwtBearer");
        var userIdValue = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var tokenRole = context.Principal?.FindFirstValue(ClaimTypes.Role);
        if (!int.TryParse(userIdValue, out var userId) || string.IsNullOrWhiteSpace(tokenRole))
        {
            logger.LogWarning("Bearer token rejected because account identity claims are missing or invalid.");
            context.Fail("Invalid account claims.");
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<SelfStorageDbContext>();
        var currentRole = await db.Users.Where(user => user.UserId == userId && user.Status == "Active")
            .Select(user => user.Role.RoleName)
            .SingleOrDefaultAsync(context.HttpContext.RequestAborted);
        if (currentRole is null || !string.Equals(currentRole, tokenRole, StringComparison.Ordinal))
        {
            logger.LogWarning("Bearer token rejected because the account is inactive or its role has changed.");
            context.Fail("Account is inactive or its role has changed.");
        }
    };
});
builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()));

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

app.Run();
