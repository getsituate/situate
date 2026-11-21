$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$sherpa = Join-Path $env:RUNNER_TEMP sherpa.tar.bz2
$onnx = Join-Path $env:RUNNER_TEMP onnx.tar.bz2
$build = Join-Path $env:RUNNER_TEMP swp
Invoke-WebRequest -Uri 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.2/sherpa-onnx-v2.0.2-win-x64-shared-MT-Release.tar.bz2' -OutFile $sherpa
Invoke-WebRequest -Uri 'https://github.com/csukuangfj/onnxruntime-libs/releases/download/v1.28.2/onnxruntime-win-x64-MT-Release-1.28.2.tar.bz2' -OutFile $onnx
node client/scripts/windows-installer.mjs $build $sherpa $onnx
$files = @(Get-ChildItem -LiteralPath (Join-Path $build 'target/x86_64-pc-windows-msvc/release/bundle/nsis') -File -Filter '*.exe')
if ($files.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
$artifact = New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'installer-preview')
Copy-Item -LiteralPath $files[0].FullName -Destination (Join-Path $artifact.FullName 'setup.exe')
[ordered]@{
    kind = 'situate-windows-installer-preview'
    target = 'x86_64-pc-windows-msvc'
    source = $env:GITHUB_SHA
    sha256 = (Get-FileHash -LiteralPath (Join-Path $artifact.FullName 'setup.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifact.FullName 'manifest.json')
