# Runs inside the same Job Object as the startup smoke.
Add-Type -AssemblyName System.Windows.Forms

function Find-Control($root, $type, [string]$name) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)
    foreach ($control in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
        $current = $control.Current
        if ($current.Name -match $name -and $current.IsEnabled -and -not $current.IsOffscreen) { return $control }
    }
}
function Wait-Control([scriptblock]$probe, [string]$description) {
    $limit = [Diagnostics.Stopwatch]::StartNew()
    while ($limit.Elapsed.TotalSeconds -lt 18) {
        Assert-Desktop
        try {
            $found = & $probe
            if ($found) { return $found }
        } catch [System.Windows.Automation.ElementNotAvailableException] {}
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for $description."
}
function App-Window($process) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Situate exited during the workspace test.' }
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
        return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    }
}
function Invoke-Control($control) {
    $pattern = $null
    if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    $label = $control.Current.Name
    try {
        Assert-Desktop
        $app.Refresh()
        if ([SmokeDesktop]::GetForegroundWindow() -ne $app.MainWindowHandle) { throw 'Situate is not in the foreground.' }
        $point = $control.GetClickablePoint()
        $hit = [System.Windows.Automation.AutomationElement]::FromPoint($point)
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        while ($hit -and ($hit.GetRuntimeId() -join ',') -ne ($control.GetRuntimeId() -join ',')) {
            $hit = $walker.GetParent($hit)
        }
        if (-not $hit) { throw 'The action is covered by another element.' }
        [Windows.Forms.Cursor]::Position = [Drawing.Point]::new([int]$point.X, [int]$point.Y)
        [SmokeDesktop]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        [SmokeDesktop]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    } catch { throw "Could not activate '$label': $($_.Exception.Message)" }
}
function App-Control($process, $type, [string]$name) {
    Wait-Control {
        $window = App-Window $process
        if ($window) { Find-Control $window $type $name }
    } $name
}
function Set-Text([string]$name, [string]$text) {
    $value = Wait-Control {
        $window = App-Window $app
        if (-not $window) { return }
        $field = Find-Control $window $edit $name
        $pattern = $null
        if ($field -and $field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and -not $pattern.Current.IsReadOnly) { $pattern }
    } "an editable field matching $name"
    $value.SetValue($text)
    [void](Wait-Control { $value.Current.Value -eq $text } "text accepted by $name")
}

$button = [System.Windows.Automation.ControlType]::Button
$edit = [System.Windows.Automation.ControlType]::Edit
$windowType = [System.Windows.Automation.ControlType]::Window
$menuItem = [System.Windows.Automation.ControlType]::MenuItem
$parent = Join-Path $PSScriptRoot 'fixture-workspaces'
New-Item -ItemType Directory -Path $parent | Out-Null
Invoke-Control (App-Control $app $button '^(Create a workspace|Arbeitsbereich erstellen)(\s|$)')
Invoke-Control (App-Control $app $button '^(Skip intro|Intro .berspringen)(\s|$)')
Set-Text '^(Workspace name|Name des Arbeitsbereichs)$' 'Workspace smoke'
Invoke-Control (App-Control $app $button '^(Choose|Ausw.hlen)(\u2026|\.\.\.)?$')
function Choose-Folder([string]$parent) {
    $dialog = Wait-Control {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $condition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $app.Id)
        foreach ($candidate in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) {
            if ($candidate.Current.ControlType -eq $windowType -and $candidate.Current.ClassName -eq '#32770' -and -not $candidate.Current.IsOffscreen) { return $candidate }
        }
    } 'the Windows folder picker'
    $dialogHandle = [IntPtr]$dialog.Current.NativeWindowHandle
    function Native-Control([string]$id, [string]$class) {
        $condition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
        foreach ($element in $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
            $item = $element.Current
            $handle = [IntPtr]$item.NativeWindowHandle
            if ($item.ProcessId -eq $app.Id -and $item.ClassName -eq $class -and $handle -ne [IntPtr]::Zero -and
                [SmokeDesktop]::IsWindowVisible($handle) -and [SmokeDesktop]::IsWindowEnabled($handle)) {
                return $handle
            }
        }
    }
    $field = Wait-Control { Native-Control '1152' 'Edit' } 'the native folder field'
    $result = [IntPtr]::Zero
    $sent = [SmokeDesktop]::SendMessageTimeout($field, 12, [IntPtr]::Zero, $parent, 2, 3000, [ref]$result)
    if ($sent -eq [IntPtr]::Zero -or $result -eq [IntPtr]::Zero) { throw 'Could not set the folder picker path.' }
    # The dialog can repaint and change its controls while it processes the edit.
    $confirm = Wait-Control {
        if (-not [SmokeDesktop]::IsWindowVisible($dialogHandle)) { return }
        $currentField = Native-Control '1152' 'Edit'
        if (-not $currentField) { return }
        $text = [Text.StringBuilder]::new(512)
        $read = [IntPtr]::Zero
        if ([SmokeDesktop]::ReadControlText($currentField, 13, [IntPtr]$text.Capacity, $text, 2, 1000, [ref]$read) -ne [IntPtr]::Zero -and $text.ToString() -eq $parent) {
            Native-Control '1' 'Button'
        }
    } 'confirmation with the intended folder path'
    if (-not [SmokeDesktop]::PostMessage($confirm, 245, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not submit the folder picker.' }
}
Choose-Folder $parent
$workspace = Join-Path $parent 'Workspace smoke'
try {
    [void](Wait-Control {
        $field = Find-Control (App-Window $app) $edit '^(Workspace folder|Arbeitsbereichsordner)$'
        if ($field) {
            $value = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
            if ($value.Replace('\\?\', '').Replace('/', '\').TrimEnd('\') -in @($parent, $workspace)) { $true }
        }
    } 'selection of the isolated workspace destination')
} catch {
    if ([SmokeDesktop]::GetForegroundWindow() -eq $dialogHandle) {
        throw 'The native folder picker did not close after selection.'
    }
    throw 'Situate did not confirm the isolated workspace destination.'
}
Invoke-Control (App-Control $app $button '^(Create workspace|Arbeitsbereich erstellen)$')
[void](Wait-Control { Test-Path -LiteralPath (Join-Path $workspace '.situate\migrations.json') } 'workspace creation and initialization')

function Assert-RequiredSetup {
    [void](App-Control $app ([System.Windows.Automation.ControlType]::Text) '^(Choose a provider|Anbieter ausw.hlen)$')
    if (Find-Control (App-Window $app) $button '^(Skip for now|Continue without AI|Vorerst .berspringen|Ohne KI fortfahren)$') {
        throw 'A new workspace offered to skip initial AI setup.'
    }
}
Assert-RequiredSetup
$progress = Get-Content -LiteralPath (Join-Path $workspace '.situate\native-onboarding.json') -Raw | ConvertFrom-Json
if ($progress.record.step -ne 'access' -or $progress.record.entered) { throw 'Initial setup was not recorded.' }
if (-not $app.CloseMainWindow()) { throw 'Could not close the setup window.' }
Invoke-Control (App-Control $app $button '^Workspace smoke(\s|$)')
Assert-RequiredSetup
if (-not $app.CloseMainWindow()) { throw 'Could not close the reopened setup window.' }

$workspace = Join-Path $parent 'Legacy fixture'
[void][IO.Directory]::CreateDirectory((Join-Path $workspace '.situate'))
Invoke-Control (App-Control $app $button '^(Open a workspace|Arbeitsbereich .ffnen)(\s|$)')
Choose-Folder $workspace
function Open-Files {
    $nav = Find-Control (App-Window $app) $button '^(Open navigation|Navigation .ffnen)$'
    if ($nav) { Invoke-Control $nav }
    Invoke-Control (App-Control $app $button '^(Files|Dateien)$')
    $expand = Find-Control (App-Window $app) $button '^(Expand file browser|Datei.bersicht ausklappen)$'
    if ($expand) { Invoke-Control $expand }
}
Open-Files
Invoke-Control (App-Control $app $button '^(New file or folder|Neue Datei oder neuer Ordner)$')
Invoke-Control (App-Control $app $menuItem '^(New file|Neue Datei)(\u2026|\.\.\.)?$')
Set-Text '^(File name|Dateiname)$' 'smoke-note'
Invoke-Control (App-Control $app $button '^(Create file|Datei erstellen)$')
$body = 'Situate Windows saved this text'
$file = Join-Path $workspace 'smoke-note.md'
[void](Wait-Control { Test-Path -LiteralPath $file -PathType Leaf } 'the newly created file')
Set-Text '^(Markdown source|Markdown-Quelltext)$' $body
try {
    [void](Wait-Control { [IO.File]::ReadAllText($file) -eq $body } 'the saved file bytes')
} catch {
    $actual = [IO.File]::ReadAllText($file)
    throw "Saved bytes did not match the fixture. Read $($actual.Length) characters instead of $($body.Length)."
}

if (-not $app.CloseMainWindow()) { throw 'Could not close the workspace window.' }
Invoke-Control (App-Control $app $button '^(Application actions|App-Aktionen)$')
Invoke-Control (App-Control $app $menuItem '^(Quit Situate|Situate beenden)$')
if (-not $app.WaitForExit(18000) -or $app.ExitCode -ne 0) { throw 'Situate did not exit normally.' }
$app = [Diagnostics.Process]::Start($launch)
Invoke-Control (App-Control $app $button '^Legacy fixture(\s|$)')
Open-Files
Invoke-Control (App-Control $app $button '^smoke-note\.md$')
if ([IO.File]::ReadAllText($file) -ne $body) { throw 'Saved file changed after reopening the workspace.' }
