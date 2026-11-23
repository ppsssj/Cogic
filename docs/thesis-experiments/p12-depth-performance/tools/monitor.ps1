param([Parameter(Mandatory=$true)][int]$TargetPid, [Parameter(Mandatory=$true)][string]$Output)
if (Test-Path -LiteralPath $Output) { throw 'Output already exists' }
while ($true) {
  $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if (-not $proc) { break }
  $counters = (Get-Counter '\Memory\Available MBytes','\Memory\Pages Input/sec','\Processor(_Total)\% Processor Time').CounterSamples
  $record = [ordered]@{ timestamp = (Get-Date).ToUniversalTime().ToString('o'); processCpuSeconds = $proc.CPU; processWorkingMB = [math]::Round($proc.WorkingSet64 / 1MB, 2); availableMB = [math]::Round($counters[0].CookedValue, 2); pagesInputPerSec = [math]::Round($counters[1].CookedValue, 2); systemCpuPercent = [math]::Round($counters[2].CookedValue, 2) }
  $record | ConvertTo-Json -Compress | Add-Content -LiteralPath $Output -Encoding UTF8
  Start-Sleep -Seconds 1
}
