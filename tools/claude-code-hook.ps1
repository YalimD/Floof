# Claude Code hook -> floof, for PCs without Node.js. Same events as claude-code-hook.js:
# every Claude Code session gets its own pet, named after its project folder.
# Claude Code passes the hook payload as JSON on stdin. Never fails and never waits more than
# a second, so it can't slow Claude Code down or block it.
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:/path/to/floof/tools/claude-code-hook.ps1
$ErrorActionPreference = 'SilentlyContinue'
try {
  [Console]::InputEncoding = [Text.Encoding]::UTF8
  $h = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {
  exit 0
}
if (-not $h) { exit 0 }

function Short([string]$s, [int]$n) { if ($s.Length -gt $n) { $s.Substring(0, $n) } else { $s } }
function Leaf([string]$p) { if ($p) { Split-Path ($p.TrimEnd('\', '/')) -Leaf } else { '' } }

function Describe-Tool($name, $i) {
  $file = Leaf $i.file_path
  switch ($name) {
    'Read' { return "Reading $file" }
    { $_ -in 'Edit', 'Write' } { return "Editing $file" }
    'Bash' { return 'Running: ' + (Short $i.command 120) }
    'PowerShell' { return 'Running: ' + (Short $i.command 120) }
    { $_ -in 'Grep', 'Glob' } { return 'Searching the code' }
    { $_ -in 'WebSearch', 'WebFetch' } { return 'Looking things up on the web' }
    default { return "Using $name" }
  }
}

$name = Leaf $h.cwd
$session = if ($h.session_id) { $h.session_id } else { 'session' }
$ev = [ordered]@{ id = "claude-$session"; name = $(if ($name) { $name } else { 'claude' }); provider = 'claude-code' }
switch ($h.hook_event_name) {
  'SessionStart' { $ev.state = 'idle'; $ev.text = 'Session started' }
  'UserPromptSubmit' { $ev.state = 'working'; $ev.text = 'Working on: ' + (Short $h.prompt 200) }
  'PreToolUse' { $ev.state = 'working'; $ev.text = Describe-Tool $h.tool_name $h.tool_input }
  'Notification' { $ev.state = 'question'; $ev.text = $(if ($h.message) { $h.message } else { 'Claude needs your attention' }) }
  'Stop' { $ev.state = 'done'; $ev.text = 'Finished, waiting for your next message' }
  'SessionEnd' { $ev.state = 'bye' }
  default { exit 0 }
}

$port = if ($env:FLOOF_PORT) { $env:FLOOF_PORT } else { 4417 }
try {
  $body = [Text.Encoding]::UTF8.GetBytes(($ev | ConvertTo-Json -Compress))
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/event" -ContentType 'application/json' -Body $body -TimeoutSec 1 | Out-Null
} catch {}
exit 0
