# EXP-03 paging monitor: samples available memory and paging every few seconds into a CSV, while the
# measurement phases run in another process. Language-independent counters (WMI class), no admin rights.
# Usage: powershell -NoProfile -File exp03-paging-monitor.ps1 -Out <run-root>\paging.csv [-IntervalSec 5] [-StopFile <path>]
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$IntervalSec = 5,
  [string]$StopFile = ""
)
if (Test-Path $Out) { throw "refusing to overwrite $Out" }
"timestampUtc,availableMBytes,pagesPerSec,pageReadsPerSec,pageWritesPerSec,commitPercent" | Out-File -FilePath $Out -Encoding ascii
while ($true) {
  if ($StopFile -and (Test-Path $StopFile)) { break }
  $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $line = "{0},{1},{2},{3},{4},{5}" -f (Get-Date).ToUniversalTime().ToString("o"), $m.AvailableMBytes, $m.PagesPersec, $m.PageReadsPersec, $m.PageWritesPersec, $m.PercentCommittedBytesInUse
  Add-Content -Path $Out -Value $line -Encoding ascii
  Start-Sleep -Seconds $IntervalSec
}
