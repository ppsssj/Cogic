param([string]$Spec, [string]$Workspace, [string]$Prefix, [int]$MinAvailMB = 1800, [hashtable]$Env = @{})
# Runs ONE Playwright P8 spec (one VS Code instance) after a memory gate; records env JSON.
$W = '<HARNESS_WORKDIR>'
$OUT = '<RESULTS>\p8-final\runs'
New-Item -ItemType Directory -Force $OUT | Out-Null
$avail = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
$harnessCodes = @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*Cogic-P4-e2e-restored*' }).Count
$runId = "$Prefix-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
$meta = [ordered]@{ runId = $runId; spec = $Spec; workspace = $Workspace; startedAt = (Get-Date -Format o); availableMB = $avail
  commitMB = [int]((Get-Counter '\Memory\Committed Bytes').CounterSamples[0].CookedValue / 1MB)
  cpuLoadPct = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  harnessVSCodeBefore = $harnessCodes; sessionLocked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue)
  vscode = '1.147.0 win32-x64 archive'; vsixSha256 = '2748b83d66442abc5d86bdb1fd2743bbb5878ac5483ef58a1c4cdd3f0d3416c0'; env = $Env }
if ($avail -lt $MinAvailMB -or $harnessCodes -gt 0) {
  $meta.skipped = "available $avail MB < $MinAvailMB MB or harness VS Code already running ($harnessCodes)"
  $meta | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 "$OUT\$runId.env.json"; "SKIP $runId $($meta.skipped)"; return
}
$env:VSCODE_EXE = "$W\harness\.vscode-test\vscode-win32-x64-archive-1.147.0\Code.exe"
$env:P4_EXTENSIONS_DIR = "$W\isolated-extensions"
$env:STUDY_WORKSPACE = $Workspace
$env:RUN_ID = $runId
foreach ($k in $Env.Keys) { Set-Item -Path "env:$k" -Value $Env[$k] }
Push-Location "$W\harness"
& npx.cmd playwright test -c playwright.p8.config.ts $Spec *> "$OUT\$runId.log"
$code = $LASTEXITCODE
Pop-Location
$meta.exit = $code; $meta.finishedAt = (Get-Date -Format o)
$meta.availableAfterMB = [int](Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue
$meta.resultsDir = "$W\harness\e2e-results\runs\$runId"
$meta | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 "$OUT\$runId.env.json"
"$runId exit=$code availBefore=$avail availAfter=$($meta.availableAfterMB)"
