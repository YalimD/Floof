# floof window watcher (Windows only).
# Prints one JSON line whenever the set of visible top-level windows changes:
# [{"id":..., "x":..., "y":..., "w":..., "h":..., "fg":true|false, "app":"chrome", "title":"..."}, ...] in z-order, topmost first.
# Coordinates are physical pixels. floof uses this so pets can stand on top of windows.
# With -WatchInput it also prints, whenever they change, the modifier keys held, the mouse cursor and the text caret
# (or where you last clicked in the active window, for apps that don't report a caret):
# {"t":"input","keys":["ctrl","alt"],"cursor":[x,y],"caret":[x,y,w,h]|null}
param([int]$SelfPid = 0, [switch]$WatchInput)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class FloofWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int max);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

  static Dictionary<uint, string> apps = new Dictionary<uint, string>();

  // the window's program name without .exe, so pets can keep off the apps you choose
  static string AppOf(uint pid) {
    string name;
    if (apps.TryGetValue(pid, out name)) return name;
    try { name = Process.GetProcessById((int)pid).ProcessName; } catch { name = ""; }
    if (apps.Count > 500) apps.Clear();
    apps[pid] = name;
    return name;
  }

  static string Json(string s) {
    StringBuilder b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ') b.Append(' ');
      else b.Append(c);
    }
    return b.ToString();
  }

  public static string Snapshot(uint selfPid) {
    StringBuilder sb = new StringBuilder("[");
    IntPtr fg = GetForegroundWindow();
    bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h) || GetWindowTextLength(h) == 0) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == selfPid) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
      StringBuilder cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return true; // desktop, taskbar
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // other virtual desktop
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
      if (r.Right - r.Left < 80 || r.Bottom - r.Top < 40) return true;
      if (!first) sb.Append(",");
      first = false;
      // the title too (cut to 200 characters), so you can keep pets off, or on, single windows
      StringBuilder title = new StringBuilder(201);
      GetWindowText(h, title, 201);
      sb.AppendFormat("{{\"id\":{0},\"x\":{1},\"y\":{2},\"w\":{3},\"h\":{4},\"fg\":{5},\"app\":\"{6}\",\"title\":\"{7}\"}}",
        h.ToInt64(), r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, h == fg ? "true" : "false", Json(AppOf(pid)), Json(title.ToString()));
      return true;
    }, IntPtr.Zero);
    sb.Append("]");
    return sb.ToString();
  }

  // ---- keys held, mouse cursor and text caret, so pets can keep out of your way ----

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize, flags;
    public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
    public RECT rcCaret;
  }

  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);

  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

  static POINT lastClick;
  static IntPtr lastClickWindow = IntPtr.Zero;
  static bool mouseWasDown;

  public static string Input() {
    List<string> keys = new List<string>();
    if (Down(0x11)) keys.Add("\"ctrl\"");
    if (Down(0x12)) keys.Add("\"alt\"");
    if (Down(0x10)) keys.Add("\"shift\"");
    if (Down(0x5B) || Down(0x5C)) keys.Add("\"win\"");
    POINT c;
    GetCursorPos(out c);
    IntPtr fg = GetForegroundWindow();
    // where you last clicked in the active window: the typing spot for apps that don't report a caret
    bool mouseDown = Down(0x01);
    if (mouseDown && !mouseWasDown) {
      lastClick = c;
      lastClickWindow = fg;
    }
    mouseWasDown = mouseDown;
    string caret = "null";
    uint pid;
    uint tid = GetWindowThreadProcessId(fg, out pid);
    GUITHREADINFO gi = new GUITHREADINFO();
    gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (tid != 0 && GetGUIThreadInfo(tid, ref gi) && gi.hwndCaret != IntPtr.Zero) {
      POINT p = new POINT();
      p.X = gi.rcCaret.Left;
      p.Y = gi.rcCaret.Top;
      if (ClientToScreen(gi.hwndCaret, ref p))
        caret = String.Format("[{0},{1},{2},{3}]", p.X, p.Y, Math.Max(2, gi.rcCaret.Right - gi.rcCaret.Left), Math.Max(2, gi.rcCaret.Bottom - gi.rcCaret.Top));
    } else if (fg != IntPtr.Zero && fg == lastClickWindow) {
      caret = String.Format("[{0},{1},4,24]", lastClick.X - 2, lastClick.Y - 12);
    }
    return String.Format("{{\"t\":\"input\",\"keys\":[{0}],\"cursor\":[{1},{2}],\"caret\":{3}}}", String.Join(",", keys), c.X, c.Y, caret);
  }
}
"@

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false # window titles in any language
# per-monitor aware, so windows on monitors with a different scaling report real pixels too
try { $aware = [FloofWin]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { $aware = $false }
if (-not $aware) { [FloofWin]::SetProcessDPIAware() | Out-Null }
$last = ''
$lastInput = ''
$tick = 0
while ($true) {
  # windows about eight times a second; with -WatchInput, keys, cursor and caret every 40 ms
  if ($tick % 3 -eq 0) {
    $snap = [FloofWin]::Snapshot([uint32]$SelfPid)
    if ($snap -ne $last) {
      [Console]::Out.WriteLine($snap)
      [Console]::Out.Flush()
      $last = $snap
    }
  }
  if ($WatchInput) {
    $in = [FloofWin]::Input()
    if ($in -ne $lastInput) {
      [Console]::Out.WriteLine($in)
      [Console]::Out.Flush()
      $lastInput = $in
    }
  }
  $tick++
  Start-Sleep -Milliseconds 40
}
