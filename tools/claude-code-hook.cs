// Claude Code hook -> floof, as a tiny Windows exe (no Node.js, no PowerShell start-up).
// Claude Code passes the hook payload as JSON on stdin; this hands it to floof as is
// (POST /hook/claude-code, see src/claude-code.js), prints floof's reply (a message or Stop from
// the pet's balloon) for Claude Code, and always exits 0, waiting at most a second,
// so it never blocks or slows Claude Code. Build it with tools/build-hook.ps1.
// FLOOF_PORT changes the port (default 4417).
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;

static class ClaudeCodeHook {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PROCESSENTRY32 {
    public uint dwSize, cntUsage, th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID, cntThreads, th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")] static extern bool Process32First(IntPtr snap, ref PROCESSENTRY32 pe);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")] static extern bool Process32Next(IntPtr snap, ref PROCESSENTRY32 pe);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  // The processes above this hook (Claude Code, its shell, the terminal or editor...), nearest
  // first: "Take me there" in floof brings the first of them with a window to the front.
  static string Ancestors() {
    var parent = new Dictionary<uint, uint>();
    IntPtr snap = CreateToolhelp32Snapshot(0x2, 0); // TH32CS_SNAPPROCESS
    if (snap == new IntPtr(-1)) return "";
    try {
      var pe = new PROCESSENTRY32();
      pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      for (bool ok = Process32First(snap, ref pe); ok; ok = Process32Next(snap, ref pe)) parent[pe.th32ProcessID] = pe.th32ParentProcessID;
    } finally {
      CloseHandle(snap);
    }
    var chain = new List<string>();
    uint pid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
    for (int i = 0; i < 12 && parent.TryGetValue(pid, out pid) && pid > 4; i++) {
      if (chain.Contains(pid.ToString())) break;
      chain.Add(pid.ToString());
    }
    return string.Join(",", chain.ToArray());
  }

  static int Main() {
    try {
      // floof not running: done (connecting to a closed port on Windows takes about a second)
      if (System.Diagnostics.Process.GetProcessesByName("floof").Length == 0) return 0;
      string payload;
      using (var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))) payload = stdin.ReadToEnd();
      if (payload.Trim().Length == 0) return 0;
      string port = Environment.GetEnvironmentVariable("FLOOF_PORT");
      if (string.IsNullOrEmpty(port)) port = "4417";
      var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/hook/claude-code?pids=" + Ancestors());
      req.Method = "POST";
      req.ContentType = "application/json";
      req.Proxy = null; // localhost: skip proxy detection, which can take a while
      req.Timeout = 1000;
      req.ReadWriteTimeout = 1000;
      byte[] body = Encoding.UTF8.GetBytes(payload);
      req.ContentLength = body.Length;
      using (Stream s = req.GetRequestStream()) s.Write(body, 0, body.Length);
      // floof's reply is this hook's output for Claude Code: a message or Stop you sent from
      // the pet's balloon. Usually it's empty.
      using (var res = req.GetResponse())
      using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) {
        string reply = reader.ReadToEnd();
        if (reply.Trim().Length > 0) {
          using (var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false))) stdout.Write(reply);
        }
      }
    } catch {
      // floof isn't running, or busy: the pet just misses this update
    }
    return 0;
  }
}
