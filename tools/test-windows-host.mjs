// Start suspended so no descendant can escape assignment to the job object.
export const windowsJob = String.raw`
param([string]$Node, [string]$Script, [string]$Phase, [int]$Seconds, [string]$Workspace)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class SituateJob {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Startup {
    public int Size;
    public IntPtr Reserved, Desktop, Title;
    public int X, Y, Width, Height, XChars, YChars, Fill, Flags;
    public short Show, ReservedSize;
    public IntPtr ReservedData, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Child { public IntPtr Process, Thread; public int PID, TID; }

  [DllImport("kernel32", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, IntPtr name);
  [DllImport("kernel32", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, int size);
  [DllImport("kernel32", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, int size, IntPtr returned);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, int flags, IntPtr env, string cwd, ref Startup start, out Child result);
  [DllImport("kernel32", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);

  static void Check(bool ok) { if (!ok) throw new Win32Exception(); }
  const int LimitsSizeX64 = 144;  // JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  const int AccountingSize = 48; // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION

  public static int Run(string node, string script, string phase, int seconds, string workspace) {
    if (IntPtr.Size != 8) throw new InvalidOperationException("An x64 job supervisor is required.");
    var job = CreateJobObject(IntPtr.Zero, IntPtr.Zero);
    Check(job != IntPtr.Zero);
    var buffer = Marshal.AllocHGlobal(LimitsSizeX64);
    Child child = new Child();
    try {
      Marshal.Copy(new byte[LimitsSizeX64], 0, buffer, LimitsSizeX64);
      Marshal.WriteInt32(buffer, 16, 0x2000); // KILL_ON_JOB_CLOSE
      Check(SetInformationJobObject(job, 9, buffer, LimitsSizeX64));
      var start = new Startup { Size = Marshal.SizeOf(typeof(Startup)), Flags = 0x100,
        Input = GetStdHandle(-10), Output = GetStdHandle(-11), Error = GetStdHandle(-12) };
      var command = new StringBuilder("\"" + node + "\" \"" + script + "\" " + phase + " --child \"" + workspace + "\"");
      Check(CreateProcess(node, command, IntPtr.Zero, IntPtr.Zero, true, 4, IntPtr.Zero, null, ref start, out child));
      if (!AssignProcessToJobObject(job, child.Process)) {
        var error = new Win32Exception();
        TerminateProcess(child.Process, 1);
        throw error;
      }
      Check(ResumeThread(child.Thread) != UInt32.MaxValue);
      uint result = 124;
      var lease = Console.OpenStandardInput().ReadAsync(new byte[1], 0, 1);
      var deadline = Stopwatch.StartNew();
      while (deadline.Elapsed.TotalSeconds < seconds && !lease.IsCompleted) {
        var wait = WaitForSingleObject(child.Process, 100);
        if (wait == 0) { Check(GetExitCodeProcess(child.Process, out result)); break; }
        Check(wait == 258);
      }
      // Discard only the owned job, even if the phase's parent already exited.
      Check(TerminateJobObject(job, 1));
      for (int i = 0; i < 100; ++i) {
        Check(QueryInformationJobObject(job, 1, buffer, AccountingSize, IntPtr.Zero));
        if (Marshal.ReadInt32(buffer, 40) == 0) return unchecked((int)result);
        Thread.Sleep(100);
      }
      throw new InvalidOperationException("The Windows job did not drain.");
    } finally {
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
      Marshal.FreeHGlobal(buffer);
      CloseHandle(job);
    }
  }
}
'@
exit ([SituateJob]::Run($Node, $Script, $Phase, $Seconds, $Workspace))
`;

export const windowsProbe = String.raw`
$ErrorActionPreference = 'Stop'
$sdk = '10.0.26100.0'
$kits = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots').KitsRoot10
if (-not (Test-Path (Join-Path $kits "Lib\$sdk\um\x64\kernel32.lib"))) { throw 'Windows SDK is missing' }
$vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = (& $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json | Select-Object -First 1)
if (-not $vs) { throw 'MSVC is missing' }
$msvc = Get-Content (Join-Path $vs.installationPath 'VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt') | Select-Object -First 1
$edge = @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\*') |
  ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
  Where-Object { $_.name -eq 'Microsoft Edge WebView2 Runtime' -and $_.pv -match '^\d+\.\d+\.\d+\.\d+$' -and $_.pv -ne '0.0.0.0' } |
  Select-Object -First 1
if (-not $edge) { throw 'WebView2 Evergreen Runtime is missing' }
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
@{ osBuild = "$($os.CurrentBuildNumber).$($os.UBR)"; msvc = $msvc.Trim(); visualStudio = $vs.installationVersion; sdk = $sdk; webview2 = $edge.pv } | ConvertTo-Json -Compress
`;
