<#
.SYNOPSIS
  Backs up the database of the Docker-free installation (npm run local) on Windows. Also works for any PostgreSQL
  that DATABASE_URL points at. The bundled PostgreSQL has no pg_dump, so this uses scripts/db-backup.mjs
  (consistent read-only snapshot, gzip, sha256 file, verification, retention, optional AES-256-GCM encryption).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
  powershell -File scripts\backup.ps1 -VerifyRestore -KeepDays 30
.NOTES
  Environment: BACKUP_DIR, BACKUP_PASSPHRASE (encrypt), BACKUP_UPLOAD_CMD, BACKUP_KEEP_WEEKLY.
  Exit codes: 0 ok, 1 failed, 2 verification failed, 3 upload failed (local backup is fine), 64 bad usage.
  Scheduled task (every night 02:30):
    schtasks /Create /SC DAILY /ST 02:30 /TN "Dor backup" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\dor\scripts\backup.ps1"
#>
param(
  [switch]$VerifyRestore,
  [int]$KeepDays = 0,
  [string]$BackupDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if ($KeepDays -gt 0) { $env:BACKUP_KEEP_DAYS = "$KeepDays" }
if ($BackupDir) { $env:BACKUP_DIR = $BackupDir }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "Node.js was not found in PATH"; exit 64 }
$argsList = @("scripts/db-backup.mjs", "backup")
if ($VerifyRestore) { $argsList += "--verify-restore" }
& node @argsList
exit $LASTEXITCODE
