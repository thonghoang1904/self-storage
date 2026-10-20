$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\backend\SelfStorage.Api\SelfStorage.Api.csproj"
$project = [System.IO.Path]::GetFullPath($project)

$publicBaseUrl = (Read-Host "Public HTTPS tunnel URL forwarding to the API (for example https://example.ngrok-free.app)").Trim().TrimEnd("/")
$publicUri = $null
if (-not [Uri]::TryCreate($publicBaseUrl, [UriKind]::Absolute, [ref]$publicUri) -or $publicUri.Scheme -ne "https" -or $publicUri.IsLoopback) {
    throw "Public API URL must be a publicly reachable HTTPS URL."
}

$partnerCode = (Read-Host "MoMo sandbox PartnerCode").Trim()
if ([string]::IsNullOrWhiteSpace($partnerCode)) {
    throw "PartnerCode is required."
}

$frontendReturnUrl = (Read-Host "Frontend return URL [http://localhost:5173/payment-result]").Trim()
if ([string]::IsNullOrWhiteSpace($frontendReturnUrl)) {
    $frontendReturnUrl = "http://localhost:5173/payment-result"
}
$frontendUri = $null
if (-not [Uri]::TryCreate($frontendReturnUrl, [UriKind]::Absolute, [ref]$frontendUri) -or $frontendUri.Scheme -notin @("http", "https")) {
    throw "Frontend return URL must be an absolute HTTP or HTTPS URL."
}

foreach ($setting in @(
    @{ Key = "PaymentGateways:PublicBaseUrl"; Value = $publicBaseUrl },
    @{ Key = "PaymentGateways:FrontendReturnUrl"; Value = $frontendUri.AbsoluteUri },
    @{ Key = "PaymentGateways:Momo:Enabled"; Value = "true" },
    @{ Key = "PaymentGateways:Momo:CreateUrl"; Value = "https://test-payment.momo.vn/v2/gateway/api/create" },
    @{ Key = "PaymentGateways:Momo:PartnerCode"; Value = $partnerCode }
)) {
    dotnet user-secrets set $setting.Key $setting.Value --project $project
    if ($LASTEXITCODE -ne 0) { throw "Could not save $($setting.Key)." }
}

foreach ($secretName in @("AccessKey", "SecretKey")) {
    $secure = Read-Host "MoMo $secretName (input hidden)" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ([string]::IsNullOrWhiteSpace($secret)) {
            throw "$secretName must not be empty."
        }
        dotnet user-secrets set "PaymentGateways:Momo:$secretName" $secret --project $project
        if ($LASTEXITCODE -ne 0) { throw "Could not save MoMo $secretName." }
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        Remove-Variable secret, secure, pointer -ErrorAction SilentlyContinue
    }
}

Write-Host "MoMo sandbox settings saved to local User Secrets. Restart the API before checkout testing."
