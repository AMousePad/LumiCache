param([string]$Dest = "")
$ErrorActionPreference = "Stop"
function Get-BundleHash([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try { return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)) }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Dest)) {
    $Dest = Join-Path (Split-Path -Parent $root) "Lumiverse\data\extensions\lumicache\repo"
}
$destination = [System.IO.Path]::GetFullPath($Dest)
$manifestPath = Join-Path $destination "spindle.json"
if (Test-Path -LiteralPath $manifestPath) {
    $installed = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($installed.identifier -ne "lumicache") { throw "Destination belongs to another extension: $destination" }
}
Push-Location $root
try {
    Write-Host "[lumicache] building..."
    bun run build
    if ($LASTEXITCODE -ne 0) { throw "build failed; destination was not changed" }
    $destDist = Join-Path $destination "dist"
    New-Item -ItemType Directory -Path $destDist -Force | Out-Null
    Copy-Item -LiteralPath "dist\backend.js" -Destination (Join-Path $destDist "backend.js") -Force
    Copy-Item -LiteralPath "dist\frontend.js" -Destination (Join-Path $destDist "frontend.js") -Force
    Copy-Item -LiteralPath "spindle.json" -Destination $manifestPath -Force
    foreach ($relative in @("dist\backend.js", "dist\frontend.js", "spindle.json")) {
        if ((Get-BundleHash (Join-Path $root $relative)) -ne (Get-BundleHash (Join-Path $destination $relative))) {
            throw "Deployment verification failed: $relative"
        }
    }
    $manifest = Get-Content -LiteralPath "spindle.json" -Raw | ConvertFrom-Json
    Write-Host "[lumicache] deployed version $($manifest.version) to $destination"
    Write-Host "Restart LumiCache in Extensions and reload the browser to load the new bundles."
}
finally { Pop-Location }
