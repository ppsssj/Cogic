# Blank-canvas regression on clean product builds (no test bridge). Cell: <label>|<style>|<extensions>.
param([string]$CellsFile,[string]$OutputRoot,[string]$Workspace,[string]$Harness,[string]$CodeExe,[string]$RootFile='src/main.ts')
$ErrorActionPreference='Stop'
foreach($line in Get-Content -LiteralPath $CellsFile){ if(-not $line.Trim()){continue}; $label,$style,$ext=$line.Trim().Split('|'); $env:P12E6_COND=$style
 & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'run-regression.ps1') -Harness $Harness -Workspace $Workspace -Extensions $ext -CodeExe $CodeExe -Output (Join-Path $OutputRoot $label) -File $RootFile | Out-Null
 Write-Host "CELL $label exit $LASTEXITCODE" }
