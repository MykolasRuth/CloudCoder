# CloudCoder launcher.
#   .\scripts\start.ps1            -> build web (if needed) and start the server
#   .\scripts\start.ps1 -Rebuild   -> force rebuild of the web app first
#   .\scripts\start.ps1 -Install   -> register a Scheduled Task that starts CloudCoder at logon
param(
  [switch]$Rebuild,
  [switch]$Install
)

$root = Split-Path -Parent $PSScriptRoot

if ($Install) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\start.ps1`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName 'CloudCoder' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host 'Scheduled task "CloudCoder" registered (starts at logon).'
  exit 0
}

Set-Location $root

if ($Rebuild -or -not (Test-Path "$root\web\dist\index.html")) {
  Write-Host 'Building web app...'
  npm run build --workspace web
  if (-not $?) { Write-Error 'web build failed'; exit 1 }
}

Write-Host 'Starting CloudCoder server on port 4060...'
npx tsx server/src/index.ts
