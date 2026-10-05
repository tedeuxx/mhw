# Render global/AGENTS.md into each harness's user-level brief on Windows (ADR-0010), and install the
# user-level deny floor (ADR-0016).
#
#   install.ps1            install or update every managed target
#   install.ps1 -DryRun    print exactly what would be written where; write nothing
#   install.ps1 -Check     exit non-zero if any target is missing, drifted, unmanaged, or carries a
#                          provenance stamp other than the source's (Issue #66, ADR-0029)
#   install.ps1 -Overlay D owner overlay directory (default: <repo>\overlay); -Overlay none for none
#
# Renders the brief and the deny floor. The deny floor is merged into %USERPROFILE%\.claude\settings.json
# (a union: no existing deny entry is removed, a backup is left beside the file) and rendered to
# <CODEX_HOME>\rules\workstation-deny-floor.rules. The HITL escalation guard and its hook entry
# (ADR-0013) are NOT ported to Windows: install.sh carries them, and on Windows the escalation rules are
# instructions only. The paste filter at the harness-CLI prompt (ADR-0011) is not ported either: it runs
# on the stock /usr/bin/python3, which Windows does not have.
#
# Exit codes: 0 ok, 1 drift, stamp or missing (-Check), 2 usage or invalid floor entry, 3 an UNMANAGED or
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

# The provenance stamp (Issue #66, ADR-0029), by the same rule as install.sh: release vX.Y.Z on a clean
# checkout exactly at a numeric tag, otherwise "unreleased, after <nearest tag>" (or "no tag
# reachable"); the full HEAD SHA, plus "-dirty" when a tracked file differs from HEAD.
$StampKey = 'personal-multi-harness-workstation-configuration'
function Invoke-Git([string[]]$a) {
    # Continue, not Stop: Windows PowerShell 5.1 turns a native command's stderr into a terminating
    # error under Stop, even when it is redirected.
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $o = & git -C $repoRoot @a 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (@($o) -join "`n").Trim()
    } catch { return $null } finally { $ErrorActionPreference = $eap }
}
$commit = $null
if ((Get-Command git -CommandType Application -ErrorAction SilentlyContinue) -and
    (Invoke-Git @('rev-parse', '--is-inside-work-tree')) -ceq 'true') {
    $commit = Invoke-Git @('rev-parse', '--verify', 'HEAD')
}
if ($commit) {
    $dirty = if (Invoke-Git @('status', '--porcelain', '--untracked-files=no')) { '-dirty' } else { '' }
    $glob = 'v[0-9]*.[0-9]*.[0-9]*'
    $exact = if ($dirty) { $null } else { Invoke-Git @('describe', '--tags', '--exact-match', '--match', $glob, 'HEAD') }
    $near = Invoke-Git @('describe', '--tags', '--abbrev=0', '--match', $glob, 'HEAD')
    if ($exact -and $exact -cmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { $release = $exact }
    elseif ($near -and $near -cmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { $release = "unreleased, after $near" }
    else { $release = 'unreleased, no tag reachable' }
    $stamp = "release: $release; commit: $commit$dirty"
} else {
    $stamp = "release: unknown, not a git checkout (.bumpversion.toml says $version); commit: unknown"
}

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
    $s = "# $MarkerId; source: $floorFrom; $stamp; do not edit, re-run the installer`n"
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
    $head += "<!-- $MarkerId; source: $from; $stamp; sha256: $sha; do not edit, re-run the installer -->`n`n"
    return , ([byte[]]($utf8.GetBytes($head) + $srcBytes))
}

function Test-Managed([string]$path) {
    $first = Get-Content -LiteralPath $path -TotalCount 5
    return [bool]($first | Where-Object { $_.Contains($MarkerId) })
}

$script:status = 0
# Content without the stamp fields of the managed-by line ("version" in files an earlier release wrote).
function Remove-Stamp([byte[]]$b) {
    $lines = $utf8.GetString($b) -split "`n"
    $lines = foreach ($l in $lines) {
        if ($l.Contains($MarkerId)) { [regex]::Replace($l, '; (version|release|commit): [^;"]*', '') } else { $l }
    }
    return ($lines -join "`n")
}
# The release and commit fields of the first managed-by line in a text, or 'none'.
function Get-StampOf([string]$text) {
    foreach ($l in ($text -split "`n")) {
        if ($l.Contains($MarkerId)) {
            $mm = [regex]::Match($l, '; (release: [^;"]*; commit: [^;"]*);')
            if ($mm.Success) { return $mm.Groups[1].Value } else { return 'none' }
        }
    }
    return 'none'
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
        if ([Convert]::ToBase64String($current) -ceq [Convert]::ToBase64String($bytes)) { Write-Output "OK      $dest ($stamp)"; return }
        # Matching content under another stamp is STAMP, not DRIFT: -Check flags it, install rewrites it.
        $restamp = ((Remove-Stamp $current) -ceq (Remove-Stamp $bytes))
        $was = Get-StampOf $utf8.GetString($current)
    }
    switch ($mode) {
        'check' {
            if (-not (Test-Path -LiteralPath $dest)) { Write-Output "MISSING $dest" }
            elseif ($restamp) { Write-Output "STAMP   ${dest}: content matches, but it carries ($was) and the source is ($stamp)" }
            else { Write-Output "DRIFT   $dest ($was)" }
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
            Write-Output "WROTE   $dest ($stamp)"
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
    # The provenance stamp (ADR-0029): JSON has no comment, so one top-level key of ours carries it, as
    # install.sh writes it (Claude Code ignores a key it does not know, measured on 2.1.289).
    $want = "$MarkerId; source: global/install.ps1 (only the deny-floor rules merged into this file; every other key is yours); $stamp; do not edit, re-run the installer"
    $keyProp = $obj.PSObject.Properties[$StampKey]
    $was = if ($keyProp) { Get-StampOf ([string]$keyProp.Value) } else { 'none' }
    $stampOk = $keyProp -and ([string]$keyProp.Value) -ceq $want
    if ((Test-Path -LiteralPath $settings) -and $missing.Count -eq 0 -and $stampOk) {
        Write-Output "OK      $settings (all $($claudeRules.Count) deny-floor rules present; $stamp)"
        return
    }
    switch ($mode) {
        'check' {
            if (-not (Test-Path -LiteralPath $settings)) { Write-Output "MISSING $settings" }
            elseif ($missing.Count -eq 0) { Write-Output "STAMP   ${settings}: the deny floor matches, but its ""$StampKey"" key carries ($was) and the source is ($stamp)" }
            else { Write-Output "DRIFT   $settings ($($missing.Count) deny-floor rule(s) missing) ($was)" }
            Set-Status 1
        }
        'dry-run' {
            Write-Output "WOULD MERGE ${settings}: $($missing.Count) deny-floor rule(s); every other key and rule is kept. The file is re-serialized by ConvertTo-Json."
            $missing | ForEach-Object { Write-Output "+ $_" }
        }
        'install' {
            if (-not $perms) { $obj | Add-Member -NotePropertyName permissions -NotePropertyValue ([PSCustomObject]@{}) }
            $obj.permissions | Add-Member -NotePropertyName deny -NotePropertyValue ([object[]]($existing + $missing)) -Force
            $obj | Add-Member -NotePropertyName $StampKey -NotePropertyValue $want -Force
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
