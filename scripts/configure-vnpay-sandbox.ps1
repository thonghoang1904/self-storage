$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\backend\SelfStorage.Api\SelfStorage.Api.csproj"
$project = [System.IO.Path]::GetFullPath($project)

$publicBaseUrl = (Read-Host "Public HTTPS tunnel URL forwarding to API port 5080").Trim().TrimEnd("/")
$publicUri = $null
if (-not [Uri]::TryCreate($publicBaseUrl, [UriKind]::Absolute, [ref]$publicUri) -or $publicUri.Scheme -ne "https" -or $publicUri.IsLoopback) {
    throw "Public API URL must be a publicly reachable HTTPS URL."
}

$tmnCode = (Read-Host "VNPay sandbox TmnCode (Terminal ID)").Trim()
if ([string]::IsNullOrWhiteSpace($tmnCode)) {
    throw "TmnCode is required."
}

$frontendReturnUrl = (Read-Host "Frontend return URL [http://localhost:5173/payment-result]").Trim()
if ([string]::IsNullOrWhiteSpace($frontendReturnUrl)) {
    $frontendReturnUrl = "http://localhost:5173/payment-result"
}
$frontendUri = $null
if (-not [Uri]::TryCreate($frontendReturnUrl, [UriKind]::Absolute, [ref]$frontendUri) -or $frontendUri.Scheme -notin @("http", "https")) {
    throw "Frontend return URL must be an absolute HTTP or HTTPS URL."
}

$settings = @(
    @{ Key = "PaymentGateways:PublicBaseUrl"; Value = $publicUri.AbsoluteUri.TrimEnd("/") },
    @{ Key = "PaymentGateways:FrontendReturnUrl"; Value = $frontendUri.AbsoluteUri },
    @{ Key = "PaymentGateways:VnPay:Enabled"; Value = "true" },
    @{ Key = "PaymentGateways:VnPay:PaymentUrl"; Value = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html" },
    @{ Key = "PaymentGateways:VnPay:TmnCode"; Value = $tmnCode }
)

foreach ($setting in $settings) {
    dotnet user-secrets set $setting.Key $setting.Value --project $project
    if ($LASTEXITCODE -ne 0) { throw "Could not save $($setting.Key)." }
}

$secure = Read-Host "VNPay sandbox HashSecret (input hidden)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $hashSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($hashSecret)) {
        throw "HashSecret is required."
    }
    dotnet user-secrets set "PaymentGateways:VnPay:HashSecret" $hashSecret --project $project
    if ($LASTEXITCODE -ne 0) { throw "Could not save VNPay HashSecret." }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Variable hashSecret, secure, pointer -ErrorAction SilentlyContinue
}

Write-Host "VNPay sandbox settings saved to local User Secrets. Restart the API before checkout testing."
