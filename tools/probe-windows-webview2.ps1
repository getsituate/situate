$ErrorActionPreference = 'Stop'

$product = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$registrations = @(
    foreach ($hive in 'LocalMachine', 'CurrentUser') {
        foreach ($view in 'Registry32', 'Registry64') {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            try {
                $key = $base.OpenSubKey($product)
                if ($null -eq $key) { continue }
                try {
                    $pv = $key.GetValue('pv')
                    if ([string]::IsNullOrEmpty($pv)) { continue }
                    $version = [version]::Parse($pv)
                    if ($version -gt [version]'0.0.0.0') {
                        [ordered]@{ hive = $hive; view = $view; version = $version.ToString() }
                    }
                } finally { $key.Dispose() }
            } finally { $base.Dispose() }
        }
    }
)

$os = Get-CimInstance Win32_OperatingSystem
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    [ordered]@{
        os = $os.Caption
        build = $os.BuildNumber
        architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        imageVersion = $env:ImageVersion
        administrator = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
        runtimeRegistrations = $registrations
    } | ConvertTo-Json -Depth 4
} finally { $identity.Dispose() }
