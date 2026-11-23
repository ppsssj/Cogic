param([int]$Runs = 3, [int]$MinAvailMB = 1000)
# P13 Stage A: P3 T1-T4 specs (unchanged) per tool, 3 independent runs, tool order rotated per run (pre-registered).
# One VS Code at a time; memory gate; resume (a tool/run with exit 0 is not repeated); env JSON written per run.
$W = '<HARNESS_WORKDIR>'
$OUT = '<P13>\data\stage-a'; New-Item -ItemType Directory -Force $OUT | Out-Null
$tools = [ordered]@{
  vscode = @{ spec = 'e2e/p2-compare.spec.ts'; grep = 'P2 VS Code built-in navigation' }
  tff    = @{ spec = 'e2e/p2-compare.spec.ts'; grep = 'P2 Trace Function Flow' }
  cg     = @{ spec = 'e2e/p2-compare.spec.ts'; grep = 'P2 Context Graph' }
  cogic  = @{ spec = 'e2e/p1-cogic.spec.ts';   grep = 'P1 Cogic E2E' } }
$names = @($tools.Keys)
for ($r = 0; $r -lt $Runs; $r++) {
  for ($i = 0; $i -lt $names.Count; $i++) {
    $tool = $names[($i + $r) % $names.Count]; $t = $tools[$tool]
    $prev = Get-ChildItem "$OUT\p13a-$tool-r$r-*.env.json" -ErrorAction SilentlyContinue | Where-Object { (Get-Content $_.FullName -Raw | ConvertFrom-Json).exit -eq 0 }
    if ($prev) { "resume: $tool r$r ($($prev[0].Name))"; continue }
    $avail = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
    $codes = @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*Cogic-P4-e2e-restored*' }).Count
    $runId = "p13a-$tool-r$r-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    $meta = [ordered]@{ runId = $runId; tool = $tool; run = $r; order = $i; startedAt = (Get-Date -Format o); availableMB = $avail; harnessVSCodeBefore = $codes; vscode = '1.147.0 win32-x64 archive'; spec = $t.spec; grep = $t.grep }
    if ($avail -lt $MinAvailMB -or $codes -gt 0) { $meta.skipped = "available $avail MB < $MinAvailMB or harness VS Code running ($codes)"; $meta | ConvertTo-Json | Out-File -Encoding utf8 "$OUT\$runId.env.json"; "SKIP $runId -- stopping"; return }
    $env:VSCODE_EXE = "$W\harness\.vscode-test\vscode-win32-x64-archive-1.147.0\Code.exe"
    $env:P4_EXTENSIONS_DIR = '<P13>\extensions'; $env:STUDY_WORKSPACE = "$W\fixture"; $env:RUN_ID = $runId
    Push-Location "$W\harness"
    & npx.cmd playwright test -c playwright.config.ts $t.spec -g $t.grep *> "$OUT\$runId.log"
    $code = $LASTEXITCODE
    Pop-Location
    $meta.exit = $code; $meta.finishedAt = (Get-Date -Format o); $meta.availableAfterMB = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
    $meta.resultsDir = "$W\harness\e2e-results\runs\$runId"
    $meta | ConvertTo-Json | Out-File -Encoding utf8 "$OUT\$runId.env.json"
    $clean = (git -C "$W\fixture" status --porcelain 2>$null | Measure-Object).Count
    "$runId exit=$code avail=$avail after=$($meta.availableAfterMB)"
  }
}
