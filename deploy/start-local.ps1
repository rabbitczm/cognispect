param([int]$Port = 8096)

$ErrorActionPreference = 'Stop'
$workspace = 'D:\workspace\codex_list'
$project = Split-Path -Parent $PSScriptRoot
$python = 'C:\Users\rabbit\AppData\Roaming\uv\python\cpython-3.12.14-windows-x86_64-none\python.exe'
$env:TEMP = Join-Path $workspace 'scratch\tmp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONPATH = (@('helix-web-deps','helix-research-deps','helix-pdf-deps','helix-build-deps') | ForEach-Object { Join-Path $workspace "tools\$_" }) -join ';'
$env:MPLCONFIGDIR = Join-Path $workspace 'scratch\matplotlib'
$env:MPLBACKEND = 'Agg'
$env:HELIX_DATA_DIR = Join-Path $workspace 'scratch\zhijing-data'
$env:PUBLIC_URL = "http://127.0.0.1:$Port"
New-Item -ItemType Directory -Force -Path $env:TEMP,$env:MPLCONFIGDIR | Out-Null

Push-Location $project
try {
    & $python _tools/build_release.py
    if ($LASTEXITCODE -ne 0) { throw '网页构建失败，请查看上方输出。' }
    Write-Host "知镜：$env:PUBLIC_URL  管理后台：$env:PUBLIC_URL/admin"
    Write-Host '按 Ctrl+C 停止；原有账号与个人工作区继续保存在 D 盘数据目录。'
    & $python -m uvicorn tools.web_app:create_app --factory --host 127.0.0.1 --port $Port
} finally {
    Pop-Location
}
