param(
    [string]$Python = 'C:\Users\rabbit\AppData\Roaming\uv\python\cpython-3.12.14-windows-x86_64-none\python.exe',
    [string]$Wrangler = 'D:\workspace\codex_list\tools\helix-wrangler\node_modules\wrangler\bin\wrangler.js'
)
$ErrorActionPreference = 'Stop'
$env:TEMP = 'D:\workspace\codex_list\scratch\tmp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:WRANGLER_HOME = 'D:\workspace\codex_list\scratch\wrangler-home'
$env:XDG_CONFIG_HOME = 'D:\workspace\codex_list\scratch\config'
$env:WRANGLER_SEND_METRICS = 'false'
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$project = Split-Path $PSScriptRoot -Parent
Push-Location $project
try {
    & $Python _tools/build_cloud.py
    if ($LASTEXITCODE) { throw 'Cloud asset build failed.' }
    & node $Wrangler pages functions build functions --outdir scratch/cloud-site/_worker.js --project-directory . --compatibility-date 2026-08-06 --compatibility-flags nodejs_compat
    if ($LASTEXITCODE) { throw 'Pages Worker build failed.' }
    Write-Host 'Ready: scratch/cloud-site (Pages with protected corpus), scratch/cloud-objects (local source objects).'
} finally { Pop-Location }
