# Render global/AGENTS.md into each harness's user-level brief on Windows (ADR-0010), and install the
# user-level deny floor (ADR-0016).
#
#   install.ps1            install or update every managed target
#   install.ps1 -DryRun    print exactly what would be written where; write nothing
#   install.ps1 -Check     exit non-zero if any target is missing, drifted or unmanaged
#   install.ps1 -Overlay D owner overlay directory (default: <repo>\overlay); -Overlay none for none
#
# Renders the brief and the deny floor. The deny floor is merged into %USERPROFILE%\.claude\settings.json
# (a union: no existing deny entry is removed, a backup is left beside the file) and rendered to
# <CODEX_HOME>\rules\workstation-deny-floor.rules. The HITL escalation guard and its hook entry
# (ADR-0013) are NOT ported to Windows: install.sh carries them, and on Windows the escalation rules are
# instructions only. The paste filter at the harness-CLI prompt (ADR-0011) is not ported either: it runs
# on the stock /usr/bin/python3, which Windows does not have.
#
# Exit codes: 0 ok, 1 drift or missing (-Check), 2 usage or invalid floor entry, 3 an UNMANAGED or
# unreadable file is in the way.
# Tested on a Windows CI runner under both Windows PowerShell 5.1 and PowerShell 7 by
# global/install.test.ps1 (.github/workflows/tests.yml, job windows). The settings merge re-serializes
# the file with ConvertTo-Json. The source is read with CRLF normalized to LF, so a checkout made with
# core.autocrlf=true renders the same bytes as install.sh does on macOS and Linux.
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Check,
    [string]$Overlay
)
$ErrorActionPreference = 'Stop'

# Usage errors exit 2. Write-Error under ErrorActionPreference=Stop would throw and exit 1 instead.
function Stop-Usage([string]$msg) { [Console]::Error.WriteLine($msg); exit 2 }
if ($DryRun -and $Check) { Stop-Usage 'use -DryRun or -Check, not both' }
$mode = if ($Check) { 'check' } elseif ($DryRun) { 'dry-run' } else { 'install' }

$MarkerId = 'managed-by: personal-multi-harness-workstation-configuration'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$src = Join-Path $scriptDir 'AGENTS.md'
if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Stop-Usage "source not found: $src" }

$toml = Get-Content -LiteralPath (Join-Path $repoRoot '.bumpversion.toml') -Raw
$m = [regex]::Match($toml, '(?m)^current_version\s*=\s*"([0-9][0-9.]*)"')
if (-not $m.Success) { Stop-Usage 'cannot read current_version from .bumpversion.toml' }
$version = $m.Groups[1].Value

if (-not $Overlay) { $Overlay = Join-Path $repoRoot 'overlay' }
# A structured profile must be compiled and current before writing any target (ADR-0018).
# Python is needed only for structured overlays; none and hand-authored overlays keep their path.
if ($Overlay -ne 'none' -and (Test-Path -LiteralPath (Join-Path $Overlay 'profile.json') -PathType Leaf)) {
    $profilePython = Get-Command python, python3, py -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $profilePython) { Stop-Usage 'profile overlay requires Python 3.9+; no target was written' }
    $profileArgs = @()
    if ($profilePython.Name -match '^py(\.exe)?$') { $profileArgs += '-3' }
    $profileArgs += @('-B', (Join-Path $scriptDir 'profile\profile.py'), 'check',
                     '--source', 'profile.json', '--output', '.')
    Push-Location -LiteralPath $Overlay
    try {
        & $profilePython.Source @profileArgs
        $profileExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($profileExit -ne 0) { exit $profileExit }
}
# Read a source file as bytes with every CRLF turned into LF (a Windows checkout may carry CRLF).
function Read-LF([string]$path) {
    $b = [System.IO.File]::ReadAllBytes($path)
    $out = [System.Collections.Generic.List[byte]]::new($b.Length)
    for ($i = 0; $i -lt $b.Length; $i++) {
        if ($b[$i] -eq 13 -and $i + 1 -lt $b.Length -and $b[$i + 1] -eq 10) { continue }
        $out.Add($b[$i])
    }
    return , $out.ToArray()
}
[byte[]]$srcBytes = Read-LF $src
$from = 'global/AGENTS.md'
if ($Overlay -ne 'none') {
    if (-not (Test-Path -LiteralPath $Overlay -PathType Container)) { Stop-Usage "overlay directory not found: $Overlay" }
    $overlayBrief = Join-Path $Overlay 'AGENTS.md'
    if (Test-Path -LiteralPath $overlayBrief -PathType Leaf) {
        $srcBytes = [byte[]]($srcBytes + (Read-LF $overlayBrief))
        $from = 'global/AGENTS.md + overlay'
    }
}
$sha = ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($srcBytes)) -replace '-', '').ToLowerInvariant()
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM, LF kept as in the source

# The deny floor (ADR-0016): generic entries, then the overlay's. Same grammar and validation as
# install.sh; an invalid entry stops the run before anything is written.
$floorSrc = Join-Path $scriptDir 'deny-floor.conf'
if (-not (Test-Path -LiteralPath $floorSrc -PathType Leaf)) { Stop-Usage "source not found: $floorSrc" }
$floorLines = @(Get-Content -LiteralPath $floorSrc)
$floorFrom = 'global/deny-floor.conf'
if ($Overlay -ne 'none') {
    $overlayFloor = Join-Path $Overlay 'deny-floor.conf'
    if (Test-Path -LiteralPath $overlayFloor -PathType Leaf) {
        $floorLines += @(Get-Content -LiteralPath $overlayFloor)
        $floorFrom = 'global/deny-floor.conf + overlay'
    }
}
$claudeRules = New-Object System.Collections.Generic.List[string]
$codexWords = New-Object System.Collections.Generic.List[object]
$floorBad = $false
foreach ($line in $floorLines) {
    if ($line -match '^\s*(#|$)') { continue }
    $w = @($line.Trim() -split '\s+')
    $why = ''
    if ($w[0] -ne 'cmd' -and $w[0] -ne 'file') { $why = 'kind must be cmd or file' }
    elseif ($w.Count -lt 2) { $why = 'no words' }
    elseif ($w[0] -eq 'file' -and $w.Count -ne 2) { $why = 'a file entry takes one path' }
    else {
        foreach ($x in $w[1..($w.Count - 1)]) {
            if ($x -cnotmatch '^[A-Za-z0-9._/~=:@+*-]+$') { $why = 'word outside the allowed set'; break }
            if ($w[0] -eq 'cmd' -and $x.Contains('*')) { $why = 'a cmd word may not hold *'; break }
        }
    }
    if ($why) { [Console]::Error.WriteLine("invalid deny-floor entry (${why}): $line"); $floorBad = $true; continue }
    $words = @($w[1..($w.Count - 1)])   # @(): a one-element range is otherwise a scalar string
    if ($w[0] -eq 'cmd') {
        $claudeRules.Add("Bash($($words -join ' '):*)")
        $codexWords.Add($words)
    } else {
        $claudeRules.Add("Read($($words[0]))")
        $claudeRules.Add("Edit($($words[0]))")
    }
}
if ($floorBad) { exit 2 }
if ($claudeRules.Count -eq 0) { Stop-Usage 'the deny floor has no entry' }

function Get-CodexRules {
    $s = "# $MarkerId; source: $floorFrom; version: $version; do not edit, re-run the installer`n"
    $s += "# The workstation deny floor (ADR-0016). A prefix rule matches the command words from the`n"
    $s += "# program name on; another spelling, a wrapper or a script is not matched.`n"
    foreach ($words in $codexWords) {
        $quoted = ($words | ForEach-Object { '"' + $_ + '"' }) -join ', '
        $s += "prefix_rule(pattern=[$quoted], decision=""forbidden"")`n"
    }
    # The leading comma stops PowerShell unrolling the array into the pipeline.
    return , ([byte[]]$utf8.GetBytes($s))
}

function Get-Rendered([string]$kind) {
    if ($kind -eq 'codexrules') { return Get-CodexRules }
    $head = ''
    if ($kind -eq 'kiro') { $head = "---`ninclusion: always`n---`n" }
    $head += "<!-- $MarkerId; source: $from; version: $version; sha256: $sha; do not edit, re-run the installer -->`n`n"
    return , ([byte[]]($utf8.GetBytes($head) + $srcBytes))
}

function Test-Managed([string]$path) {
    $first = Get-Content -LiteralPath $path -TotalCount 5
    return [bool]($first | Where-Object { $_.Contains($MarkerId) })
}

$script:status = 0
function Remove-Stamp([byte[]]$b) {
    $pattern = '(?m)^(.*' + [regex]::Escape($MarkerId) + '.*?; version: )[^;]*;'
    return [regex]::Replace($utf8.GetString($b), $pattern, '${1}-;')
}

function Set-Status([int]$code) { if ($code -gt $script:status) { $script:status = $code } }

function Invoke-Target([string]$kind, [string]$dest) {
    [byte[]]$bytes = Get-Rendered $kind
    if ((Test-Path -LiteralPath $dest) -and -not (Test-Managed $dest)) {
        [Console]::Error.WriteLine("REFUSE  ${dest}: exists and is NOT managed by this project; move it aside or merge it by hand")
        Set-Status 3
        return
    }
    if (Test-Path -LiteralPath $dest) {
        # Compared as Base64 strings: no reliance on generic-method inference, which differs across versions.
        $current = [System.IO.File]::ReadAllBytes($dest)
        if ([Convert]::ToBase64String($current) -ceq [Convert]::ToBase64String($bytes)) { Write-Output "OK      $dest"; return }
        # The managed-by header stamps the release that rendered a file; a release that changes no
        # installed content reads as OK, not DRIFT, and is not rewritten.
        if ((Remove-Stamp $current) -ceq (Remove-Stamp $bytes)) { Write-Output "OK      $dest"; return }
    }
    switch ($mode) {
        'check' {
            if (Test-Path -LiteralPath $dest) { Write-Output "DRIFT   $dest" } else { Write-Output "MISSING $dest" }
            Set-Status 1
        }
        'dry-run' {
            Write-Output "WOULD WRITE $dest ($($bytes.Length) bytes):"
            Write-Output "----- begin $dest"
            Write-Output $utf8.GetString($bytes)
            Write-Output "----- end $dest"
        }
        'install' {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
            $tmp = "$dest.new.$PID"
            [System.IO.File]::WriteAllBytes($tmp, $bytes)
            Move-Item -LiteralPath $tmp -Destination $dest -Force
            Write-Output "WROTE   $dest"
        }
    }
}

$home_ = $env:USERPROFILE
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $home_ '.codex' }

Invoke-Target 'plain' (Join-Path $home_ '.claude\CLAUDE.md')
Invoke-Target 'plain' (Join-Path $codexHome 'AGENTS.md')
Invoke-Target 'kiro' (Join-Path $home_ '.kiro\steering\workstation-global-brief.md')
Invoke-Target 'codexrules' (Join-Path $codexHome 'rules\workstation-deny-floor.rules')

# Merge the deny floor into the user's Claude Code settings: a union, every existing key and rule kept.
function Merge-DenyFloor([string]$settings) {
    $obj = $null
    if (Test-Path -LiteralPath $settings) {
        try { $obj = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json } catch { $obj = $null }
        if ($null -eq $obj -or $obj -isnot [System.Management.Automation.PSCustomObject]) {
            [Console]::Error.WriteLine("REFUSE  ${settings}: not a readable JSON object; left untouched")
            Set-Status 3
            return
        }
    } else {
        $obj = [PSCustomObject]@{}
    }
    $perms = $obj.PSObject.Properties['permissions']
    if ($perms -and $perms.Value -isnot [System.Management.Automation.PSCustomObject]) {
        [Console]::Error.WriteLine("REFUSE  ${settings}: its permissions section has an unexpected shape; left untouched")
        Set-Status 3
        return
    }
    $existing = @()
    if ($perms -and $perms.Value.PSObject.Properties['deny']) {
        $d = $perms.Value.deny
        if ($d -isnot [System.Array] -and $null -ne $d) {
            [Console]::Error.WriteLine("REFUSE  ${settings}: its permissions section has an unexpected shape; left untouched")
            Set-Status 3
            return
        }
        $existing = @($d)
    }
    # -cnotcontains: case-sensitive, so "rm -Rf" and "rm -rf" stay two rules, as they are in install.sh
    $missing = @($claudeRules | Where-Object { $existing -cnotcontains $_ } | Select-Object -Unique)
    if ((Test-Path -LiteralPath $settings) -and $missing.Count -eq 0) {
        Write-Output "OK      $settings (all $($claudeRules.Count) deny-floor rules present)"
        return
    }
    switch ($mode) {
        'check' {
            if (Test-Path -LiteralPath $settings) { Write-Output "DRIFT   $settings ($($missing.Count) deny-floor rule(s) missing)" } else { Write-Output "MISSING $settings" }
            Set-Status 1
        }
        'dry-run' {
            Write-Output "WOULD MERGE ${settings}: $($missing.Count) deny-floor rule(s); every other key and rule is kept. The file is re-serialized by ConvertTo-Json."
            $missing | ForEach-Object { Write-Output "+ $_" }
        }
        'install' {
            if (-not $perms) { $obj | Add-Member -NotePropertyName permissions -NotePropertyValue ([PSCustomObject]@{}) }
            $obj.permissions | Add-Member -NotePropertyName deny -NotePropertyValue ([object[]]($existing + $missing)) -Force
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settings) | Out-Null
            if (Test-Path -LiteralPath $settings) { Copy-Item -LiteralPath $settings -Destination "$settings.pmhwc-backup" -Force }
            $tmp = "$settings.new.$PID"
            [System.IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Depth 100), $utf8)
            Move-Item -LiteralPath $tmp -Destination $settings -Force
            Write-Output "MERGED  $settings"
        }
    }
}
Merge-DenyFloor (Join-Path $home_ '.claude\settings.json')

exit $script:status
