using System.Reflection;
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
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<AccessOptions>(builder.Configuration.GetSection("Access"));
builder.Services.Configure<KioskOptions>(builder.Configuration.GetSection("Kiosk"));
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<PinService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<AccessService>();

// ---- Auth (JWT for users; kiosks use X-Kiosk-Key, see KioskAuth) ----
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = jwt.Issuer,
        ValidAudience = jwt.Audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
    });
builder.Services.AddAuthorization();

// Slows down PIN guessing from one kiosk.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("kiosk", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Request.Headers[KioskOptions.HeaderName].ToString(),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddControllers();

// ---- Swagger ----
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Self-Storage API",
        Version = "v1",
        Description = "Thuê kho tự phục vụ và ra vào bằng PIN + nhân viên xác nhận danh tính",
    });
    c.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, $"{Assembly.GetExecutingAssembly().GetName().Name}.xml"));

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "Token lấy từ POST /api/auth/login",
    });
    c.AddSecurityDefinition("KioskKey", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.ApiKey,
        In = ParameterLocation.Header,
        Name = KioskOptions.HeaderName,
        Description = "Khóa thiết bị kiosk (appsettings: Kiosk:Devices)",
    });
    c.AddSecurityRequirement(doc => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", doc)] = [],
        [new OpenApiSecuritySchemeReference("KioskKey", doc)] = [],
    });
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.DocumentTitle = "Self-Storage API");
    if (app.Configuration.GetValue<bool>("SeedDemoData"))
        await DevSeeder.SeedAsync(app.Services);
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapControllers();

app.Run();
