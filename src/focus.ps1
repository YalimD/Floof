# floof "Take me there": bring an agent's window to the front.
# -Pids: the agent's process and its parents, nearest first ("123,456,789"). The first of them with
# a visible window wins; past the last one it keeps walking up the parents (a shell's terminal).
# Prints "ok <pid> <app>" or "none".
param([string]$Pids = '')
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FloofFocus {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  // a visible, titled top-level window of this process (not a tool window's owner-less helper)
  public static IntPtr WindowOf(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h) || GetWindowTextLength(h) == 0 || GetWindow(h, 4) != IntPtr.Zero) return true; // GW_OWNER
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  public static void Bring(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    uint dummy;
    uint mine = GetCurrentThreadId();
    uint theirs = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    // Windows only lets the foreground app hand over the foreground: a tap of Alt and joining the
    // foreground thread's input make it allowed
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (theirs != mine) AttachThreadInput(mine, theirs, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (theirs != mine) AttachThreadInput(mine, theirs, false);
  }
}
"@

$list = @($Pids -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [uint32]$_ })
if (-not $list.Count) { 'none'; exit 0 }
# keep walking up from the last one given (the hook's parents may stop short of the terminal)
$last = $list[-1]
for ($i = 0; $i -lt 8; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$last" -ErrorAction SilentlyContinue
  if (-not $p -or $p.ParentProcessId -le 4 -or $list -contains [uint32]$p.ParentProcessId) { break }
  $last = [uint32]$p.ParentProcessId
  $list += $last
}
foreach ($id in $list) {
  $h = [FloofFocus]::WindowOf($id)
  if ($h -ne [IntPtr]::Zero) {
    [FloofFocus]::Bring($h)
    $name = (Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName
    "ok $id $name"
    exit 0
  }
}
'none'
