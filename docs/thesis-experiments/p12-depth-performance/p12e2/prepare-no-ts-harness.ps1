param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists' }
New-Item -ItemType Directory -Path (Join-Path $Destination 'e2e') -Force | Out-Null
Copy-Item -Recurse (Join-Path $Source 'e2e/lib') (Join-Path $Destination 'e2e/lib')
Copy-Item (Join-Path $Source 'playwright.p13.config.ts'),(Join-Path $Source 'package.json'),(Join-Path $Source 'tsconfig.json') $Destination
New-Item -ItemType Junction -Path (Join-Path $Destination 'node_modules') -Target (Join-Path $Source 'node_modules') | Out-Null
$file = Join-Path $Destination 'e2e/lib/vscode.ts'
$content = Get-Content -Raw -LiteralPath $file
$anchor = '      "--disable-workspace-trust",'
if (-not $content.Contains($anchor)) { throw 'launch anchor missing' }
$content = $content.Replace($anchor, ($anchor + "`n" + '      "--disable-extension=vscode.typescript-language-features",'))
Set-Content -LiteralPath $file -Value $content -Encoding utf8
