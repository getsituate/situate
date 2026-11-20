$ErrorActionPreference = 'Stop'
trap {
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'state\failure'), $_.Exception.Message)
    exit 1
}
$session = (Get-Process -Id $PID).SessionId
if ($session -eq 0 -or -not [Environment]::UserInteractive) { exit 38 }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run the startup smoke without elevated administrator rights.'
    }
} finally { $identity.Dispose() }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmokeDesktop {
    [DllImport("kernel32.dll")]
    public static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, string text, uint flags, uint milliseconds, out IntPtr result);
    [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr ReadControlText(IntPtr window, uint message, IntPtr capacity, StringBuilder text, uint flags, uint milliseconds, out IntPtr result);
    [DllImport("user32.dll")]
    public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, uint capacity, out uint needed);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool CloseDesktop(IntPtr handle);
}
'@
function Assert-Desktop {
    if ($session -ne [SmokeDesktop]::WTSGetActiveConsoleSessionId()) { throw 'The console session changed.' }
    $handle = [SmokeDesktop]::OpenInputDesktop(0, $false, 1)
    if ($handle -eq [IntPtr]::Zero) { throw 'No input desktop.' }
    try {
        $name = [Text.StringBuilder]::new(128)
        $needed = [uint32]0
        if (-not [SmokeDesktop]::GetUserObjectInformation($handle, 2, $name, 256, [ref]$needed) -or $name.ToString() -ne 'Default') {
            throw 'Unlock the console desktop.'
        }
    } finally { [void][SmokeDesktop]::CloseDesktop($handle) }
}
Assert-Desktop
$profileRoot = Join-Path $PSScriptRoot 'profile'
if (Test-Path -LiteralPath $profileRoot) { throw 'Expected a fresh profile.' }
New-Item -ItemType Directory -Path $profileRoot | Out-Null
$fixture = Join-Path $PSScriptRoot 'fixture.txt'
if (Test-Path -LiteralPath $fixture) {
    # Exercise descendant ownership even when the fixture itself exits first.
    $child = Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'state\child'), [string]$child.Id)
    Start-Sleep -Seconds ([int](Get-Content -LiteralPath $fixture))
    exit 0
}

$exe = Join-Path $PSScriptRoot 'situate-client.exe'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
)
$launch = [Diagnostics.ProcessStartInfo]::new($exe)
$launch.WorkingDirectory = $profileRoot
$launch.UseShellExecute = $false
$launch.EnvironmentVariables.Remove('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')
$launch.EnvironmentVariables.Remove('WEBVIEW2_BROWSER_EXECUTABLE_FOLDER')
$launch.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = Join-Path $profileRoot 'webview2'
$app = [Diagnostics.Process]::Start($launch)
$clock = [Diagnostics.Stopwatch]::StartNew()
while ($clock.Elapsed.TotalSeconds -lt 45) {
    $app.Refresh()
    if ($app.HasExited) { throw "Situate exited before showing the workspace chooser: $($app.ExitCode)" }
    $handle = $app.MainWindowHandle
    if ($handle -ne [IntPtr]::Zero) {
        try {
            $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
            $properties = $window.Current
            if ($properties.ProcessId -eq $app.Id -and -not $properties.IsOffscreen -and -not $properties.BoundingRectangle.IsEmpty) {
                $create = $false
                $open = $false
                foreach ($button in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
                    $control = $button.Current
                    if (-not $control.IsEnabled -or $control.IsOffscreen -or $control.BoundingRectangle.IsEmpty) { continue }
                    if ($control.Name -match '^(Create a workspace|Arbeitsbereich erstellen)(\s|$)') { $create = $true }
                    if ($control.Name -match '^(Open a workspace|Arbeitsbereich \u00f6ffnen)(\s|$)') { $open = $true }
                }
                if ($create -and $open) {
                    Assert-Desktop
                    $journey = Join-Path $PSScriptRoot 'workspace.ps1'
                    if (Test-Path -LiteralPath $journey) { & $journey }
                    exit 0
                }
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] {
            # The WebView can replace its accessibility elements during startup.
        }
    }
    Start-Sleep -Milliseconds 200
}
throw 'Timed out waiting for the visible workspace chooser with enabled Create and Open buttons.'
