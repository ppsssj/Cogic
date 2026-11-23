param([string[]]$Projects = @('hono','vite'), [int]$Runs = 3, [int]$MinAvailMB = 1000, [string[]]$Only = @(), [string]$Tag = 'p11ui')
# P11 real-world UI runs (one VS Code instance at a time, memory gate before each).
# Conditions: off = v0.0.6 (Marketplace-identical VSIX bdd0cab6...) with cogic.analysisCache.enabled=false;
#             fixed800 = P4 VSIX 2748b83d... (v0.0.6 minus the P9 cache policy; webview identical) cache on;
#             adaptive = v0.0.6 cache on. Order per run index (Latin square): F,A,O / A,O,F / O,F,A.
# Memory policy (user decision 2026-11-23): start gate 1,000 MB available (was 1,500 MB). During a run, available memory,
# committed bytes and paging are sampled every ~2 s into <runId>.mem.csv. Pre-registered rules:
#   - abort (safe stop of that run's process tree): available < 300 MB or commit > 95 % of the commit limit for 30 s;
#   - run-level pressure flag (kept in env.json): minimum available < 500 MB, or a 10 s mean Pages Input/sec > 500.
#   - refined 2026-11-23 (step-pressure.cjs, same thresholds on TIMED steps only; see data/POLICY-CHANGES.md):
#     RAM pressure (available < 500 MB) -> run excluded and re-measured once; paging (Pages Input/sec > 500, which also
#     counts file reads) -> run kept, marked, and dropped in a sensitivity analysis.
# Resume: a run is not repeated if a completed (exit 0) run without timed-step RAM pressure exists for project/condition/run.
$W = '<HARNESS_WORKDIR>'
$P11 = '<P11>'
$OUT = "$P11\data\ui-runs"; New-Item -ItemType Directory -Force $OUT | Out-Null
$cond = @{
  O = @{ label = 'off';      ext = "$W\isolated-extensions-rel006b"; cache = 'off'; vsix = 'bdd0cab6c217efbb0008093e69e8534281f267ad8699936e982d961cdf2876e2' }
  F = @{ label = 'fixed800'; ext = "$W\isolated-extensions";         cache = 'on';  vsix = '2748b83d66442abc5d86bdb1fd2743bbb5878ac5483ef58a1c4cdd3f0d3416c0' }
  A = @{ label = 'adaptive'; ext = "$W\isolated-extensions-rel006b"; cache = 'on';  vsix = 'bdd0cab6c217efbb0008093e69e8534281f267ad8699936e982d961cdf2876e2' } }
$orders = @(@('F','A','O'), @('A','O','F'), @('O','F','A'))
$counters = '\Memory\Available MBytes', '\Memory\Committed Bytes', '\Memory\Commit Limit', '\Memory\Pages Input/sec', '\Memory\Pages/sec'
function Read-Mem { $s = (Get-Counter $counters -ErrorAction SilentlyContinue).CounterSamples; $v = @{}; foreach ($x in $s) { $v[$x.Path.Split('\')[-1]] = $x.CookedValue }; return $v }
foreach ($p in $Projects) {
  $t = Get-Content "$P11\targets\$p.json" -Raw | ConvertFrom-Json
  $rel = { param($f) ($f.Substring($t.root.Length + 1)) -replace '\\','/' }
  $active = & $rel $t.activeFile
  $switch = (@($t.switchFiles[0], $t.switchFiles[1], $t.switchFiles[2]) | ForEach-Object { & $rel $_ }) -join ','
  for ($r = 0; $r -lt $Runs; $r++) {
    foreach ($c in $orders[$r % 3]) {
      if ($Only.Count -gt 0 -and $Only -notcontains $c) { continue }
      $cd = $cond[$c]
      # valid = exit 0 and no RAM pressure inside a timed step (step-pressure.cjs); unmonitored early runs count as valid
      $prev = Get-ChildItem "$OUT\$Tag-$p-$($cd.label)-r$r-*.env.json" -ErrorAction SilentlyContinue | Where-Object {
        $j = Get-Content $_.FullName -Raw | ConvertFrom-Json; $pf = $_.FullName -replace '\.env\.json$', '.pressure.json'
        $ram = if (Test-Path $pf) { (Get-Content $pf -Raw | ConvertFrom-Json).timedRamPressure } else { $null }
        $j.exit -eq 0 -and $ram -ne $true }
      if ($prev) { "resume: $Tag-$p-$($cd.label)-r$r already complete ($($prev[0].Name))"; continue }
      $avail = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
      $codes = @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*Cogic-P4-e2e-restored*' }).Count
      $runId = "$Tag-$p-$($cd.label)-r$r-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
      $meta = [ordered]@{ runId = $runId; project = $p; condition = $cd.label; run = $r; startedAt = (Get-Date -Format o); availableMB = $avail; gateMB = $MinAvailMB; harnessVSCodeBefore = $codes
        sessionLocked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue); vscode = '1.147.0 win32-x64 archive'; vsixSha256 = $cd.vsix; extensionsDir = $cd.ext; active = $active; switch = $switch
        reapDisabled = ($env:CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP -eq '1') }
      if ($avail -lt $MinAvailMB -or $codes -gt 0) { $meta.skipped = "available $avail MB < $MinAvailMB or harness VS Code running ($codes)"; $meta | ConvertTo-Json | Out-File -Encoding utf8 "$OUT\$runId.env.json"; "SKIP $runId $($meta.skipped) -- stopping (data so far kept)"; return }
      $env:VSCODE_EXE = "$W\harness\.vscode-test\vscode-win32-x64-archive-1.147.0\Code.exe"
      $env:P4_EXTENSIONS_DIR = $cd.ext; $env:STUDY_WORKSPACE = $t.root; $env:RUN_ID = $runId
      $env:P11_ACTIVE = $active; $env:P11_SWITCH = $switch; $env:P6_CACHE = $cd.cache; $env:P6_REPEATS = '5'; $env:P6_EDITS = '5'; $env:P6_DEPTH = '1'; $env:P6_LABEL = $p
      $proc = Start-Process -FilePath cmd.exe -ArgumentList "/c npx.cmd playwright test -c playwright.p11.config.ts e2e/p11-real.spec.ts > `"$OUT\$runId.log`" 2>&1" -WorkingDirectory "$W\harness" -WindowStyle Hidden -PassThru
      $null = $proc.Handle
      $memCsv = "$OUT\$runId.mem.csv"; "time,availMB,commitMB,commitLimitMB,pagesInputPerSec,pagesPerSec" | Out-File -Encoding utf8 $memCsv
      $samples = New-Object System.Collections.ArrayList; $severeSince = $null; $aborted = $false
      while (-not $proc.HasExited) {
        $m = Read-Mem; $now = Get-Date
        $row = [pscustomobject]@{ t = $now; avail = [int]$m['available mbytes']; commit = [int]($m['committed bytes'] / 1MB); limit = [int]($m['commit limit'] / 1MB); pin = [double]$m['pages input/sec']; ps = [double]$m['pages/sec'] }
        [void]$samples.Add($row); "{0},{1},{2},{3},{4:F1},{5:F1}" -f $now.ToString('o'), $row.avail, $row.commit, $row.limit, $row.pin, $row.ps | Out-File -Append -Encoding utf8 $memCsv
        $severe = ($row.avail -lt 300) -or ($row.limit -gt 0 -and $row.commit -gt 0.95 * $row.limit)
        if ($severe) { if (-not $severeSince) { $severeSince = $now } elseif (($now - $severeSince).TotalSeconds -ge 30) { & taskkill.exe /T /F /PID $proc.Id | Out-Null; $aborted = $true; break } } else { $severeSince = $null }
        Start-Sleep -Milliseconds 1000
      }
      $proc.WaitForExit(); $code = if ($aborted) { -9 } else { $proc.ExitCode }
      $minAvail = ($samples | Measure-Object avail -Minimum).Minimum; $maxCommit = ($samples | Measure-Object commit -Maximum).Maximum
      $maxWin = 0; for ($i = 0; $i -lt $samples.Count; $i++) { $win = @($samples | Where-Object { $_.t -ge $samples[$i].t -and $_.t -lt $samples[$i].t.AddSeconds(10) }); if ($win.Count) { $mean = ($win | Measure-Object pin -Average).Average; if ($mean -gt $maxWin) { $maxWin = $mean } } }
      $meta.exit = $code; $meta.abortedForMemory = $aborted; $meta.finishedAt = (Get-Date -Format o); $meta.availableAfterMB = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
      $meta.memSamples = $samples.Count; $meta.minAvailableMB = $minAvail; $meta.maxCommitMB = $maxCommit; $meta.commitLimitMB = ($samples | Select-Object -Last 1).limit; $meta.maxPagesInput10sMean = [math]::Round($maxWin, 1)
      $meta.memoryPressure = $aborted -or ($minAvail -lt 500) -or ($maxWin -gt 500)
      $meta.resultsDir = "$W\harness\e2e-results\runs\$runId"
      $meta | ConvertTo-Json | Out-File -Encoding utf8 "$OUT\$runId.env.json"
      & node "$P11\tools\step-pressure.cjs" $runId
      $clean = (git -C $t.root status --porcelain | Measure-Object).Count
      "$runId exit=$code avail=$avail minAvail=$minAvail maxPagesIn10s=$([math]::Round($maxWin,1)) pressure=$($meta.memoryPressure) worktreeDirty=$clean"
      if ($aborted) { "ABORT ${runId}: severe memory pressure for 30 s -- stopping (data so far kept)"; return }
    }
  }
}
