param([string]$Profile, [string]$Output)
$ErrorActionPreference='Continue'
while (-not (Test-Path -LiteralPath (Join-Path $Output 'monitor.stop'))) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize)
  $roots = @($all | Where-Object { $_.Name -eq 'Code.exe' -and $_.CommandLine -like "*$Profile*" } | ForEach-Object { $_.ProcessId })
  $ids = @{}; foreach ($id in $roots) { $ids[[string]$id] = $true }
  for ($i=0; $i -lt 8; $i++) { foreach ($p in $all) { if ($ids.ContainsKey([string]$p.ParentProcessId)) { $ids[[string]$p.ProcessId] = $true } } }
  $tsParents = @{}; foreach ($p in $all) { if ($p.CommandLine -match 'tsserver|typescriptServer') { $tsParents[[string]$p.ParentProcessId] = $true } }
  $processes = @($all | Where-Object { $ids.ContainsKey([string]$_.ProcessId) } | ForEach-Object {
    $role = if ($_.CommandLine -match 'extensionHost') { 'extension-host' } elseif ($tsParents.ContainsKey([string]$_.ProcessId)) { 'extension-host-inferred' } elseif ($_.CommandLine -match '--type=renderer') { 'renderer' } elseif ($_.CommandLine -match 'tsserver|typescriptServer') { 'typescript-server' } else { 'other' }
    @{ pid=$_.ProcessId; parent=$_.ParentProcessId; role=$role; workingSetBytes=$_.WorkingSetSize }
  })
  $free=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
  @{ wallTime=[DateTime]::UtcNow.ToString('o'); availableKiB=$free; processes=$processes } | ConvertTo-Json -Compress -Depth 5 | Add-Content -Encoding utf8 -LiteralPath (Join-Path $Output 'process-memory.jsonl')
  Start-Sleep -Seconds 3
}
