param([string]$Port = "3001")
$ErrorActionPreference = "Stop"
$cache = Join-Path $PSScriptRoot "..\.cache"
$bin = Join-Path $cache "cloudflared.exe"
New-Item -ItemType Directory -Path $cache -Force | Out-Null

if (-not (Test-Path $bin)) {
    Write-Host "[tunnel] baixando cloudflared..."
    Invoke-WebRequest `
        -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
        -OutFile $bin `
        -UseBasicParsing
    Write-Host "[tunnel] salvo em $bin"
}

Write-Host ""
Write-Host "==========================================================="
Write-Host " Servidor de sinalizacao Freehub: http://localhost:$Port"
Write-Host "==========================================================="
Write-Host ""
Write-Host " Cole a URL HTTPS abaixo em Configuracoes > Servidor de voz:"
Write-Host ""

& $bin tunnel --url "http://localhost:$Port"
