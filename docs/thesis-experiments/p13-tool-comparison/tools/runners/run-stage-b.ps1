param([string[]]$Tasks = @('H1','H2','V1','V2'), [int]$Runs = 3, [int]$MinAvailMB = 1000, [string[]]$Only = @(), [string]$Tag = 'p13b')
# P13 Stage B (pre-registered): per (task, tool, run) a fresh VS Code. Tool order rotated per run
# (r0: vscode,tff,cogic / r1: tff,cogic,vscode / r2: cogic,vscode,tff); Context Graph attempted in every run.
# One VS Code at a time, memory gate, resume (exit 0 runs are not repeated), work copy checked clean before/after.
$W = '<HARNESS_WORKDIR>'
$OUT = '<P13>\data\stage-b'; New-Item -ItemType Directory -Force $OUT | Out-Null
$KEY = '<COGIC_REPO>\docs\thesis-experiments\p13-tool-comparison\data\stage-b-answer-key.json'
$grep = @{ vscode = 'P13 VS Code'; tff = 'P13 Trace Function Flow'; cg = 'P13 Context Graph'; cogic = 'P13 Cogic' }
$orders = @(@('vscode','tff','cogic','cg'), @('tff','cogic','vscode','cg'), @('cogic','vscode','tff','cg'))
$proj = @{ H1 = 'hono'; H2 = 'hono'; V1 = 'vite'; V2 = 'vite' }
for ($r = 0; $r -lt $Runs; $r++) {
  foreach ($task in $Tasks) {
    $ws = "<WORK>\$($proj[$task])"
    foreach ($tool in $orders[$r % 3]) {
      if ($Only.Count -gt 0 -and $Only -notcontains $tool) { continue }
      $prev = Get-ChildItem "$OUT\$Tag-$task-$tool-r$r-*.env.json" -ErrorAction SilentlyContinue | Where-Object { (Get-Content $_.FullName -Raw | ConvertFrom-Json).exit -eq 0 }
      if ($prev) { "resume: $task $tool r$r"; continue }
      $dirty = (git -C $ws status --porcelain | Measure-Object).Count
      if ($dirty -gt 0) { "STOP: work copy $ws not clean"; return }
      $avail = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
      $codes = @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*Cogic-P4-e2e-restored*' }).Count
      $runId = "$Tag-$task-$tool-r$r-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
      $meta = [ordered]@{ runId = $runId; task = $task; tool = $tool; run = $r; startedAt = (Get-Date -Format o); availableMB = $avail; harnessVSCodeBefore = $codes; vscode = '1.147.0 win32-x64 archive'; workspace = $proj[$task] }
      if ($avail -lt $MinAvailMB -or $codes -gt 0) { $meta.skipped = "available $avail MB < $MinAvailMB or harness VS Code running ($codes)"; $meta | ConvertTo-Json | Out-File -Encoding utf8 "$OUT\$runId.env.json"; "SKIP $runId -- stopping"; return }
      $env:VSCODE_EXE = "$W\harness\.vscode-test\vscode-win32-x64-archive-1.147.0\Code.exe"
      $env:P4_EXTENSIONS_DIR = '<P13>\extensions'; $env:STUDY_WORKSPACE = $ws; $env:RUN_ID = $runId; $env:P13_TASK = $task; $env:P13_ANSWER_KEY = $KEY
      Push-Location "$W\harness"
      & npx.cmd playwright test -c playwright.p13.config.ts e2e/p13-real.spec.ts -g $grep[$tool] *> "$OUT\$runId.log"
      $code = $LASTEXITCODE
      Pop-Location
      $meta.exit = $code; $meta.finishedAt = (Get-Date -Format o); $meta.availableAfterMB = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
      $meta.workCopyDirtyAfter = (git -C $ws status --porcelain | Measure-Object).Count
      $meta.resultsDir = "$W\harness\e2e-results\runs\$runId"
      $meta | ConvertTo-Json | Out-File -Encoding utf8 "$OUT\$runId.env.json"
      "$runId exit=$code avail=$avail dirtyAfter=$($meta.workCopyDirtyAfter)"
    }
  }
}
