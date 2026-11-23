$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ([Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'Arm64') {
    throw 'Native ARM64 PowerShell is required.'
}
$pin = Select-String -LiteralPath client/rust-toolchain.toml -Pattern '^channel\s*=\s*"(\d+\.\d+\.\d+)"$'
if (@($pin).Count -ne 1) { throw 'Missing exact Rust toolchain pin.' }
$version = $pin.Matches[0].Groups[1].Value
$target = 'aarch64-pc-windows-msvc'
$toolchain = "$version-$target"
rustup toolchain install $toolchain --profile minimal
$compiler = rustup run $toolchain rustc -vV
if ($compiler -notcontains "host: $target" -or $compiler -notcontains "release: $version") {
    throw 'The pinned native ARM64 Rust compiler is required.'
}
if ((git rev-parse HEAD) -cne $env:GITHUB_SHA) { throw 'Unexpected verification checkout.' }
rustup run $toolchain cargo test --manifest-path client/Cargo.toml --locked --target $target --no-fail-fast -p situate-core -p situate-host-windows
