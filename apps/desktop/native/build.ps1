# Compila o helper de captura com o MSVC instalado.
# Uso: powershell -ExecutionPolicy Bypass -File native/build.ps1

$ErrorActionPreference = 'Stop'

$nativeDir = $PSScriptRoot
$outDir = Join-Path $nativeDir 'bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
  throw 'vswhere.exe não encontrado. Instale as Build Tools do Visual Studio com C++.'
}

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw 'Visual Studio com as ferramentas C++ x64 não encontrado.'
}

$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) {
  throw "vcvars64.bat não encontrado em $vcvars"
}

$source = Join-Path $nativeDir 'freehub-capture.cpp'
$object = Join-Path $outDir 'freehub-capture.obj'
$exe = Join-Path $outDir 'freehub-capture.exe'

$command = "`"$vcvars`" >nul && cl /nologo /std:c++17 /O2 /EHsc /MT /DUNICODE /D_UNICODE `"$source`" /Fo:`"$object`" /Fe:`"$exe`" /link ole32.lib oleaut32.lib mmdevapi.lib propsys.lib version.lib dwmapi.lib user32.lib advapi32.lib shell32.lib"
cmd /c $command
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao compilar o helper (código $LASTEXITCODE)."
}

Write-Host "Helper compilado: $exe"
