# Render global/AGENTS.md into each harness's user-level brief on Windows (ADR-0010).
#
#   install.ps1            install or update every managed target
#   install.ps1 -DryRun    print exactly what would be written where; write nothing
#   install.ps1 -Check     exit non-zero if any target is missing, drifted or unmanaged
#
# Exit codes: 0 ok, 1 drift or missing (-Check), 2 usage, 3 an UNMANAGED file is in the way.
# UNTESTED: written to mirror install.sh; it has not been run on Windows (ADR-0010).
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'

if ($DryRun -and $Check) { Write-Error 'use -DryRun or -Check, not both'; exit 2 }
$mode = if ($Check) { 'check' } elseif ($DryRun) { 'dry-run' } else { 'install' }

$MarkerId = 'managed-by: personal-multi-harness-workstation-configuration'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$src = Join-Path $scriptDir 'AGENTS.md'
if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Write-Error "source not found: $src"; exit 2 }

$toml = Get-Content -LiteralPath (Join-Path $repoRoot '.bumpversion.toml') -Raw
$m = [regex]::Match($toml, '(?m)^current_version\s*=\s*"([0-9][0-9.]*)"')
if (-not $m.Success) { Write-Error 'cannot read current_version from .bumpversion.toml'; exit 2 }
$version = $m.Groups[1].Value

$srcBytes = [System.IO.File]::ReadAllBytes($src)
$sha = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant()
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM, LF kept as in the source

function Get-Rendered([string]$kind) {
    $head = ''
    if ($kind -eq 'kiro') { $head = "---`ninclusion: always`n---`n" }
    $head += "<!-- $MarkerId; source: global/AGENTS.md; version: $version; sha256: $sha; do not edit, re-run the installer -->`n`n"
    return [byte[]]($utf8.GetBytes($head) + $srcBytes)
}

function Test-Managed([string]$path) {
    $first = Get-Content -LiteralPath $path -TotalCount 5
    return [bool]($first | Where-Object { $_.Contains($MarkerId) })
}

$script:status = 0
function Set-Status([int]$code) { if ($code -gt $script:status) { $script:status = $code } }

function Invoke-Target([string]$kind, [string]$dest) {
    $bytes = Get-Rendered $kind
    if ((Test-Path -LiteralPath $dest) -and -not (Test-Managed $dest)) {
        [Console]::Error.WriteLine("REFUSE  ${dest}: exists and is NOT managed by this project; move it aside or merge it by hand")
        Set-Status 3
        return
    }
    if (Test-Path -LiteralPath $dest) {
        $current = [System.IO.File]::ReadAllBytes($dest)
        if ([System.Linq.Enumerable]::SequenceEqual($current, $bytes)) { Write-Output "OK      $dest"; return }
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

exit $script:status
