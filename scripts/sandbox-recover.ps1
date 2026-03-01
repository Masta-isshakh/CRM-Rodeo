[CmdletBinding()]
param(
  [string]$Profile = $env:AWS_PROFILE,
  [string]$Identifier,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $repoRoot ".amplify\artifacts"
$cdkOutPath = Join-Path $artifactRoot "cdk.out"

if ([string]::IsNullOrWhiteSpace($Profile)) {
  $Profile = "amplify-admin"
}

Write-Host "[sandbox-recover] Repository: $repoRoot"
Write-Host "[sandbox-recover] Profile: $Profile"

$repoPattern = [regex]::Escape($repoRoot)
$lockingProcesses = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -match "node|esbuild") -and
  $_.CommandLine -and
  $_.CommandLine -match $repoPattern -and (
    $_.CommandLine -match "ampx(\.cmd|\.js)?\s+sandbox" -or
    $_.CommandLine -match "@aws-amplify\\backend-cli" -or
    $_.CommandLine -match "\\.amplify\\artifacts" -or
    $_.CommandLine -match "bundling-temp-" -or
    $_.CommandLine -match "esbuild"
  )
}

foreach ($processInfo in $lockingProcesses) {
  try {
    Write-Host "[sandbox-recover] Stopping PID $($processInfo.ProcessId): $($processInfo.Name)"
    Stop-Process -Id $processInfo.ProcessId -Force -ErrorAction Stop
  }
  catch {
    Write-Host "[sandbox-recover] Could not stop PID $($processInfo.ProcessId): $($_.Exception.Message)"
  }
}

if (Test-Path $cdkOutPath) {
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      Write-Host "[sandbox-recover] Cleaning cdk.out (attempt $attempt)..."
      Remove-Item -Path $cdkOutPath -Recurse -Force -ErrorAction Stop
      break
    }
    catch {
      if ($attempt -eq 6) {
        throw
      }

      Start-Sleep -Seconds 2
    }
  }
}

if (Test-Path $artifactRoot) {
  $bundlingTempPaths = Get-ChildItem -Path $artifactRoot -Directory -Filter "bundling-temp-*" -ErrorAction SilentlyContinue
  foreach ($tempPath in $bundlingTempPaths) {
    for ($attempt = 1; $attempt -le 6; $attempt++) {
      try {
        Write-Host "[sandbox-recover] Removing $($tempPath.FullName) (attempt $attempt)..."
        Remove-Item -Path $tempPath.FullName -Recurse -Force -ErrorAction Stop
        break
      }
      catch {
        if ($attempt -eq 6) {
          throw
        }

        Start-Sleep -Seconds 2
      }
    }
  }
}

if ($NoStart) {
  Write-Host "[sandbox-recover] Cleanup completed (NoStart mode)."
  exit 0
}

Write-Host "[sandbox-recover] Starting Amplify sandbox..."
$ampxArgs = @("ampx", "sandbox", "--profile", $Profile)
if (-not [string]::IsNullOrWhiteSpace($Identifier)) {
  $ampxArgs += @("--identifier", $Identifier)
}

Push-Location $repoRoot
try {
  npx @ampxArgs
}
finally {
  Pop-Location
}
