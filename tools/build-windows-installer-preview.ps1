$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$target = $env:SITUATE_WINDOWS_INSTALLER_TARGET ?? 'x86_64-pc-windows-msvc'
$version = $env:SITUATE_WINDOWS_RELEASE_VERSION
$signer = @{}
if ($null -ne $version) {
    if ($version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Expected a stable Windows release version' }
    foreach ($name in 'TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PASSWORD') {
        $signer[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $null)
    }
}
$archives = node client/scripts/windows-installer.mjs --runtime-archives $target | ConvertFrom-Json
$pin = Select-String -LiteralPath client/rust-toolchain.toml -Pattern '^channel\s*=\s*"(\d+\.\d+\.\d+)"$'
if (@($pin).Count -ne 1) { throw 'Missing exact Rust toolchain pin' }
$env:RUSTUP_TOOLCHAIN = $pin.Matches[0].Groups[1].Value
rustup toolchain install $env:RUSTUP_TOOLCHAIN --profile minimal --target $target
$sherpa = Join-Path $env:RUNNER_TEMP sherpa.tar.bz2
$onnx = Join-Path $env:RUNNER_TEMP onnx.tar.bz2
$build = Join-Path $env:RUNNER_TEMP swp
Invoke-WebRequest -Uri $archives.sherpa.url -OutFile $sherpa
Invoke-WebRequest -Uri $archives.onnx.url -OutFile $onnx
if ($null -ne $version) {
    try {
        foreach ($name in $signer.Keys) { [Environment]::SetEnvironmentVariable($name, $signer[$name]) }
        node client/scripts/windows-installer.mjs $build $sherpa $onnx "--target=$Target" "--release-version=$version"
    } finally {
        foreach ($name in $signer.Keys) { [Environment]::SetEnvironmentVariable($name, $null) }
    }
    return
}
node client/scripts/windows-installer.mjs $build $sherpa $onnx "--target=$Target"
$files = @(Get-ChildItem -LiteralPath (Join-Path $build "target/$Target/release/bundle/nsis") -File -Filter '*.exe')
if ($files.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
$artifact = New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'installer-preview')
Copy-Item -LiteralPath $files[0].FullName -Destination (Join-Path $artifact.FullName 'setup.exe')
[ordered]@{
    kind = 'situate-windows-installer-preview'
    target = $Target
    source = $env:GITHUB_SHA
    sha256 = (Get-FileHash -LiteralPath (Join-Path $artifact.FullName 'setup.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifact.FullName 'manifest.json')
node client/scripts/windows-installer.mjs (Join-Path $env:RUNNER_TEMP swu) $sherpa $onnx --update-test "--target=$Target"
