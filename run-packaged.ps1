$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "dist\ActivityTracker\ActivityTracker.exe"
$electron = Join-Path $root "UI\dist\win-unpacked\Flutter.exe"

if (-not (Test-Path $backend)) {
    Write-Error "Backend not found: $backend`nRun: npm --prefix UI run dist:backend"
    exit 1
}
if (-not (Test-Path $electron)) {
    Write-Error "Electron app not found: $electron`nRun: npm --prefix UI run dist:electron:dir"
    exit 1
}

Write-Host "Starting backend..." -ForegroundColor Cyan
$backendProc = Start-Process -FilePath $backend -PassThru -WindowStyle Hidden

Write-Host "Starting Electron..." -ForegroundColor Cyan
$electronProc = Start-Process -FilePath $electron -PassThru

Write-Host "Both running. Close this window or press Ctrl+C to stop both." -ForegroundColor Green

try {
    $electronProc.WaitForExit()
} finally {
    if (-not $backendProc.HasExited) {
        $backendProc.Kill()
        Write-Host "Backend stopped." -ForegroundColor Yellow
    }
}
