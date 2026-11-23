$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ([Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'Arm64' -or
    [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'Arm64') {
    throw 'Installer qualification requires native ARM64 Windows.'
}
$os = Get-CimInstance Win32_OperatingSystem
if ($os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000 -or (Get-Process -Id $PID).SessionId -eq 0) {
    throw 'Installer qualification requires a Windows 11 desktop session.'
}
if ((git rev-parse HEAD) -cne $env:GITHUB_SHA) { throw 'Unexpected qualification checkout.' }

$root = Join-Path $env:RUNNER_TEMP 'windows-release-inputs'
$artifact = Join-Path $root 'arm64'
New-Item -Path $root -ItemType Directory | Out-Null
New-Item -Path $artifact -ItemType Directory | Out-Null
$name = "windows-arm64-$env:GITHUB_RUN_ATTEMPT"
gh run download $env:GITHUB_RUN_ID --repo getsituate/situate --name $name --dir $artifact
$manifest = Get-Content -LiteralPath (Join-Path $artifact 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.kind -ne 'situate-windows-release' -or $manifest.target -ne 'aarch64-pc-windows-msvc' -or
    $manifest.source -cne $env:GITHUB_SHA -or $manifest.version -notmatch '^\d+\.\d+\.\d+$' -or
    $manifest.file -cne "Situate-$($manifest.version)-windows-arm64-setup.exe") { throw 'Wrong ARM64 installer manifest.' }
$installer = Join-Path $artifact $manifest.file
$baseline = Join-Path $artifact 'qualification-baseline.exe'
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -cne $manifest.sha256 -or (Get-Item -LiteralPath $installer).Length -ne $manifest.size) {
    throw 'The installer does not match its build manifest.'
}

$install = Join-Path $root 'installed'
$registration = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\Situate'
$uninstaller = Join-Path $install 'uninstall.exe'
$workspace = Join-Path $root 'synthetic-workspace'
$appData = Join-Path $env:APPDATA 'com.getsituate.app'
$localData = Join-Path $env:LOCALAPPDATA 'com.getsituate.app'
$profile = Join-Path $root 'webview2'
if (@($install, $appData, $localData) | Where-Object { Test-Path -LiteralPath $_ }) { throw 'Expected a fresh Situate profile.' }

function Get-SituateRegistration([Microsoft.Win32.RegistryHive]$hive) {
    foreach ($view in 'Registry32', 'Registry64') {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
        try {
            $key = $base.OpenSubKey($registration)
            if ($null -eq $key) { continue }
            try {
                return @{ version = $key.GetValue('DisplayVersion'); path = $key.GetValue('InstallLocation'); app = $key.GetValue('MainBinaryName') }
            } finally { $key.Dispose() }
        } finally { $base.Dispose() }
    }
}
function Assert-Arm64([string]$path) {
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($path))
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'Expected a Windows executable.' }
        $reader.BaseStream.Position = 0x3c
        $reader.BaseStream.Position = $reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0xaa64) { throw 'Expected an ARM64 PE payload.' }
    } finally { $reader.Dispose() }
}
function Invoke-Installer([string]$program, [string]$arguments) {
    $process = Start-Process -FilePath $program -ArgumentList $arguments -Wait -PassThru
    try {
        if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)." }
    } finally { $process.Dispose() }
}
function Assert-Installation([string]$version) {
    $user = Get-SituateRegistration CurrentUser
    if ($user.version -cne $version -or $user.path.Trim('"') -cne $install -or
        $user.app -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._ -]*\.exe$' -or (Get-SituateRegistration LocalMachine)) {
        throw 'The installed user registration or version does not match.'
    }
    $exe = Join-Path $install $user.app
    Assert-Arm64 $exe
    return $exe
}
function Assert-Chooser([string]$exe) {
    $launch = [Diagnostics.ProcessStartInfo]::new($exe)
    $launch.WorkingDirectory = $install
    $launch.UseShellExecute = $false
    $launch.EnvironmentVariables.Remove('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS') | Out-Null
    $launch.EnvironmentVariables.Remove('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER') | Out-Null
    $launch.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $profile
    $app = [Diagnostics.Process]::Start($launch)
    try {
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        $condition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button
        )
        $clock = [Diagnostics.Stopwatch]::StartNew()
        while ($clock.Elapsed.TotalSeconds -lt 60) {
            $app.Refresh()
            if ($app.HasExited) { throw "Situate exited before showing the workspace chooser: $($app.ExitCode)." }
            if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
                try {
                    $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
                    if ($window.Current.ProcessId -eq $app.Id -and -not $window.Current.IsOffscreen) {
                        $names = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition) |
                            Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen } |
                            ForEach-Object { $_.Current.Name })
                        if (($names -match '^Create a workspace(\s|$)') -and ($names -match '^Open a workspace(\s|$)')) {
                            [void]$app.CloseMainWindow()
                            if (-not $app.WaitForExit(20000) -or $app.ExitCode -ne 0) { throw 'Situate did not close cleanly.' }
                            return
                        }
                    }
                } catch [System.Windows.Automation.ElementNotAvailableException] {
                }
            }
            Start-Sleep -Milliseconds 250
        }
        throw 'The visible workspace chooser did not appear.'
    } finally {
        if (-not $app.HasExited) { $app.Kill($true); $app.WaitForExit() }
        $app.Dispose()
    }
}
function Uninstall-Situate {
    Invoke-Installer $uninstaller '/S'
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt 15) {
        if (-not (Get-SituateRegistration CurrentUser) -and -not (Get-SituateRegistration LocalMachine) -and
            -not (Test-Path -LiteralPath $uninstaller)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Situate remains installed.'
}

if ((Get-SituateRegistration CurrentUser) -or (Get-SituateRegistration LocalMachine)) { throw 'Situate is already registered.' }
try {
    Invoke-Installer $installer "/S /D=$install"
    $exe = Assert-Installation $manifest.version
    Assert-Chooser $exe
    foreach ($dll in 'sherpa-onnx-c-api.dll','onnxruntime.dll','onnxruntime_providers_shared.dll') {
        Assert-Arm64 (Join-Path $install "dictation\sherpa-onnx-2.0.2\$dll")
    }
    Uninstall-Situate
    Invoke-Installer $baseline "/S /D=$install"
    $before = Assert-Installation '0.1.6'
    Assert-Chooser $before
    New-Item -Path $workspace -ItemType Directory | Out-Null
    $note = Join-Path $workspace 'note.md'
    [IO.File]::WriteAllText($note, 'Synthetic installer upgrade fixture.')
    $beforeHash = (Get-FileHash -LiteralPath $note).Hash
    Invoke-Installer $installer "/S /UPDATE /D=$install"
    Assert-Chooser (Assert-Installation $manifest.version)
    Uninstall-Situate
    if ((Get-FileHash -LiteralPath $note).Hash -cne $beforeHash) { throw 'The installer changed the synthetic workspace file.' }
    if ((Get-FileHash -LiteralPath $installer).Hash.ToLowerInvariant() -cne $hash) { throw 'The installer changed during qualification.' }
    [ordered]@{
        kind = 'windows-arm64-exact-installer'
        source = $manifest.source
        version = $manifest.version
        sha256 = $hash
        osBuild = $os.BuildNumber
        install = 'passed'
        launch = 'passed'
        installerUpgrade = 'passed'
        uninstall = 'passed'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'qualification.json') -Encoding utf8NoBOM
} finally {
    if (Test-Path -LiteralPath $uninstaller) { Uninstall-Situate }
}
