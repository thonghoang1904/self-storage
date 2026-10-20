$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\backend\SelfStorage.Api\SelfStorage.Api.csproj"
$project = [System.IO.Path]::GetFullPath($project)

$username = Read-Host "Gmail address (SMTP username)"
if ([string]::IsNullOrWhiteSpace($username)) {
    throw "Gmail address is required."
}

$fromAddress = Read-Host "From address [$username]"
if ([string]::IsNullOrWhiteSpace($fromAddress)) {
    $fromAddress = $username
}
$fromAddress = $fromAddress.Trim().Trim("<", ">").Trim()
try {
    [void][System.Net.Mail.MailAddress]::new($fromAddress)
}
catch {
    throw "From address must be a plain email address, for example name@gmail.com."
}

foreach ($setting in @(
    @{ Key = "Smtp:Host"; Value = "smtp.gmail.com" },
    @{ Key = "Smtp:Port"; Value = "587" },
    @{ Key = "Smtp:Username"; Value = $username.Trim() },
    @{ Key = "Smtp:FromAddress"; Value = $fromAddress.Trim() },
    @{ Key = "Smtp:FromName"; Value = "Self-Storage" },
    @{ Key = "Smtp:EnableSsl"; Value = "true" }
)) {
    dotnet user-secrets set $setting.Key $setting.Value --project $project
    if ($LASTEXITCODE -ne 0) { throw "Could not save $($setting.Key)." }
}

$secure = Read-Host "Enter Gmail App Password (input hidden)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) -replace "\s", ""
    if ([string]::IsNullOrWhiteSpace($password)) {
        throw "Gmail App Password must not be empty."
    }
    dotnet user-secrets set "Smtp:Password" $password --project $project
    if ($LASTEXITCODE -ne 0) { throw "Could not save Smtp:Password." }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Variable password, secure, pointer -ErrorAction SilentlyContinue
}

Write-Host "Gmail SMTP secrets saved locally. Restart the API before testing mail delivery."
