<#
.SYNOPSIS
  Restores a backup made by backup.ps1 (or the logical backups of scripts/db-backup.mjs). DESTROYS current data.
  Stop the app first (Ctrl+C in the "npm run local" window leaves the database stopped too; start only the
  database with:  npm run local -- --db).
.EXAMPLE
  powershell -File scripts\restore.ps1 backups\dor-20261001T020000Z.dorbak
  powershell -File scripts\restore.ps1 backups\dor-....dorbak.enc -Yes     (needs $env:BACKUP_PASSPHRASE)
  powershell -File scripts\restore.ps1 backups\dor-....dorbak -TargetUrl postgres://dor:dor@localhost:5433/dor_restore_test -Migrate
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$File,
  [string]$TargetUrl = "",
  [switch]$Migrate,
  [switch]$Yes
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$argsList = @("scripts/db-backup.mjs", "restore", $File)
if ($TargetUrl) { $argsList += @("--target-url", $TargetUrl) }
if ($Migrate) { $argsList += "--migrate" }
if ($Yes) { $argsList += "--yes" }
& node @argsList
exit $LASTEXITCODE
