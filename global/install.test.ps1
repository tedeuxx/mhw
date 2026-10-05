# Test global/install.ps1 against throwaway USERPROFILE directories (never the real one).
#   install.test.ps1 <empty-or-new base directory for the fake profiles>
# Mirrors the core assertions of install.test.sh for the features install.ps1 carries: the brief (three
# targets), the deny floor (Claude Code settings merge and the Codex rules file), dry-run, check,
# idempotency, drift, refusing an unmanaged file, and refusing a malformed settings file. The installer is
# run with the same PowerShell executable that runs this script, so running this script under
# powershell.exe tests Windows PowerShell 5.1 and under pwsh tests PowerShell 7.
param([Parameter(Mandatory = $true)][string]$Base)
$ErrorActionPreference = 'Continue'
Set-StrictMode -Version 2
# An error inside the test itself is a FAILED assertion, never a silent skip. The first CI run printed
# "0 failed" and exited 0 while seven assertions had thrown before reaching a verdict.
trap { $script:fail++; Write-Output "FAIL  the test itself threw: $_"; continue }

New-Item -ItemType Directory -Force -Path $Base | Out-Null
$Base = (Resolve-Path -LiteralPath $Base).Path
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$inst = Join-Path $here 'install.ps1'
$shell = (Get-Process -Id $PID).Path
Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
$script:pass = 0
$script:fail = 0
Write-Output "shell: $shell, PowerShell $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"

function Ok([string]$d) { $script:pass++; Write-Output "PASS  $d" }
function Ko([string]$d) { $script:fail++; Write-Output "FAIL  $d" }
function Expect([string]$d, [int]$want, [int]$got) {
    if ($want -eq $got) { Ok "$d (exit $got)" } else { Ko "$d (expected $want, got $got)" }
}
function Check([string]$d, [bool]$cond) { if ($cond) { Ok $d } else { Ko $d } }

# Run the installer with USERPROFILE pointed at a throwaway directory. Returns its stdout lines; the exit
# code is left in $script:rc. stderr is not captured (it goes to the job log).
function Run([string]$prof, [string[]]$a = @()) {
    $saved = $env:USERPROFILE
    $env:USERPROFILE = $prof
    try {
        $out = & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $inst @a
        $script:rc = $LASTEXITCODE
    } finally { $env:USERPROFILE = $saved }
    return $out
}
# Returns a number, never an array: a function's array output is unrolled, and an empty one becomes
# $null, whose .Count is an error under StrictMode (the first CI run hit exactly that).
# PowerShell 7 writes AppData\Local\Microsoft\PowerShell\StartupProfileData-NonInteractive under the
# profile it starts with (measured in CI). Only that directory is left out; every other file is counted
# and named, so a red says what was written.
function Count-Files([string]$dir) {
    $psOwn = 'AppData\Local\Microsoft\PowerShell\*'
    $all = @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName.Substring($dir.Length + 1) })
    $ps = @($all | Where-Object { $_ -like $psOwn })
    $ours = @($all | Where-Object { $_ -notlike $psOwn })
    foreach ($f in $ps) { Write-Host "      (PowerShell's own, not counted: $f)" }
    foreach ($f in $ours) { Write-Host "      written: $f" }
    return $ours.Count
}
function Targets([string]$h) {
    @(
        (Join-Path $h '.claude\CLAUDE.md'),
        (Join-Path $h '.codex\AGENTS.md'),
        (Join-Path $h '.kiro\steering\workstation-global-brief.md'),
        (Join-Path $h '.codex\rules\workstation-deny-floor.rules'),
        (Join-Path $h '.claude\settings.json')
    )
}
function Fingerprint([string]$h) {
    (Targets $h | ForEach-Object {
            if (Test-Path -LiteralPath $_) { "$_ " + (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash } else { "absent $_" }
        }) -join "`n"
}
function Settings([string]$h) { Get-Content -LiteralPath (Join-Path $h '.claude\settings.json') -Raw | ConvertFrom-Json }
function Deny([string]$h) { @((Settings $h).permissions.deny) }
function Count-Rule([string]$h, [string]$r) { @(Deny $h | Where-Object { $_ -ceq $r }).Count }
function Read-LF([string]$path) {
    $b = [System.IO.File]::ReadAllBytes($path)
    $o = [System.Collections.Generic.List[byte]]::new($b.Length)
    for ($i = 0; $i -lt $b.Length; $i++) {
        if ($b[$i] -eq 13 -and $i + 1 -lt $b.Length -and $b[$i + 1] -eq 10) { continue }
        $o.Add($b[$i])
    }
    return , $o.ToArray()
}
function Sha([byte[]]$b) {
    ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($b)) -replace '-', '').ToLowerInvariant()
}

# Expected counts, derived from the source independently of the installer: a cmd line is one Claude
# rule, a file line is two (Read and Edit); one Codex rule per cmd line.
$floorSrc = Join-Path $here 'deny-floor.conf'
$floorLines = @(Get-Content -LiteralPath $floorSrc)
# The default install appends the repository overlay's floor entries (ADR-0016), so they count too.
$overlayFloor = Join-Path $repo 'overlay\deny-floor.conf'
if (Test-Path -LiteralPath $overlayFloor -PathType Leaf) { $floorLines += @(Get-Content -LiteralPath $overlayFloor) }
$floorRules = 0; $floorCmds = 0
foreach ($l in $floorLines) {
    $k = ($l.Trim() -split '\s+')[0]
    if ($k -ceq 'cmd') { $floorRules++; $floorCmds++ } elseif ($k -ceq 'file') { $floorRules += 2 }
}

# Expected brief sha256: the LF form of global/AGENTS.md + overlay/AGENTS.md, which is what install.sh
# hashes on macOS and Linux. Equal here means the Windows rendering matches the POSIX one.
$briefLF = [byte[]]((Read-LF (Join-Path $here 'AGENTS.md')) + (Read-LF (Join-Path $repo 'overlay\AGENTS.md')))
$briefSha = Sha $briefLF
$srcHasCR = ([System.IO.File]::ReadAllBytes((Join-Path $here 'AGENTS.md')) -contains [byte]13)
Write-Output "source checkout carries CRLF: $srcHasCR"

# 1. dry-run writes nothing
$h = Join-Path $Base 'home-dry'; New-Item -ItemType Directory -Force -Path $h | Out-Null
$out = Run $h @('-DryRun'); Expect 'dry-run exits 0' 0 $script:rc
Check 'dry-run wrote no file' ((Count-Files $h) -eq 0)
Check 'dry-run prints targets' ([bool]($out | Where-Object { $_ -like 'WOULD WRITE*' }))
Check 'dry-run prints the settings merge' ([bool]($out | Where-Object { $_ -like 'WOULD MERGE*' }))
Check 'dry-run prints the deny floor for both harnesses' (
    [bool]($out | Where-Object { $_ -ceq '+ Bash(git push --force:*)' }) -and
    [bool]($out | Where-Object { $_ -like 'WOULD WRITE *workstation-deny-floor.rules*' }))

# 2. fresh install
$h = Join-Path $Base 'home-fresh'; New-Item -ItemType Directory -Force -Path $h | Out-Null
$null = Run $h; Expect 'fresh install' 0 $script:rc
foreach ($f in Targets $h) { Check "written: $($f.Substring($h.Length + 1))" (Test-Path -LiteralPath $f -PathType Leaf) }
# 2b. the working method (Issue #61, ADR-0031): install.ps1 runs global\method\method_render.py with the
# profile directory, and every agent harness gets its carrier, with its tool list and the stamp.
$hm = Join-Path $Base 'home-method'; New-Item -ItemType Directory -Force -Path $hm | Out-Null
$mout = Run $hm; Expect 'install with the working method' 0 $script:rc
Check 'method: the METHOD summary line is printed' ([bool]($mout | Where-Object { $_ -like 'METHOD  *agents*skills*commands*' }))
$ccAgent = Join-Path $hm '.claude\agents\developer.md'
Check 'method: Claude Code agent keeps its tool list and stamp' (
    (Test-Path -LiteralPath $ccAgent -PathType Leaf) -and
    ([System.IO.File]::ReadAllText($ccAgent) -match '(?m)^tools: Read, Grep, Glob, Write, Edit, Bash\r?$') -and
    ([System.IO.File]::ReadAllText($ccAgent) -match 'managed-by: personal-multi-harness-workstation-configuration; source: method/agents/developer\.md; release: '))
Check 'method: Codex agent and implicit-off command skill rendered' (
    (Test-Path -LiteralPath (Join-Path $hm '.codex\agents\scrum-master.toml') -PathType Leaf) -and
    ([System.IO.File]::ReadAllText((Join-Path $hm '.agents\skills\autonomy\agents\openai.yaml')) -match 'allow_implicit_invocation: false'))
$kAgent = Get-Content -LiteralPath (Join-Path $hm '.kiro\agents\developer.json') -Raw | ConvertFrom-Json
Check 'method: Kiro agent keeps its tool list' ((@($kAgent.tools) -join ',') -ceq 'read,write,shell')
$null = Run $hm @('-Check'); Expect 'check is clean with the working method installed' 0 $script:rc
$kiro = @(Get-Content -LiteralPath (Join-Path $h '.kiro\steering\workstation-global-brief.md') -TotalCount 3)
Check 'kiro file opens with inclusion: always front matter' ($kiro[0] -ceq '---' -and $kiro[1] -ceq 'inclusion: always' -and $kiro[2] -ceq '---')
$claudeMd = Join-Path $h '.claude\CLAUDE.md'
$brief = Get-Content -LiteralPath $claudeMd
Check 'brief carries the escalation section and the owner overlay' (
    [bool]($brief | Where-Object { $_ -clike '## Escalating to the owner*' }) -and [bool]($brief | Where-Object { $_ -clike '## Owner overlay*' }))
$raw = [System.IO.File]::ReadAllBytes($claudeMd)
Check 'rendered brief has LF line endings only (no CR byte)' (-not ($raw -contains [byte]13))
Check 'rendered brief has no UTF-8 BOM' (-not ($raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF))
Check "marker sha256 equals the LF source's (same as install.sh): $briefSha" ([bool]($brief | Select-Object -First 3 | Where-Object { $_.Contains("sha256: $briefSha;") }))
$body = [byte[]]($raw[($raw.Length - $briefLF.Length)..($raw.Length - 1)])
Check 'rendered brief ends with the LF source, byte for byte' ((Sha $body) -ceq $briefSha)
$null = Run $h @('-Check'); Expect 'check after install' 0 $script:rc

# 2b. the deny floor, rendered for Claude Code and Codex
$deny = Deny $h
Check "settings carry every deny-floor rule ($floorRules), nothing else" ($deny.Count -eq $floorRules -and $floorRules -gt 0)
foreach ($r in @('Bash(rm -rf:*)', 'Bash(git push --force:*)', 'Bash(gh auth token:*)', 'Read(~/.ssh/id_*)', 'Edit(~/.aws/credentials)')) {
    Check "deny holds $r once" ((Count-Rule $h $r) -eq 1)
}
$rules = Join-Path $h '.codex\rules\workstation-deny-floor.rules'
$rl = @(Get-Content -LiteralPath $rules)
Check 'codex rules carry a forbidden prefix_rule' ([bool]($rl | Where-Object { $_ -ceq 'prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")' }))
Check "codex rules: one forbidden rule per cmd entry ($floorCmds), no allow" (
    @($rl | Where-Object { $_ -clike 'prefix_rule(*' }).Count -eq $floorCmds -and -not ($rl | Where-Object { $_ -like '*decision="allow"*' }))

# 3. idempotent re-run
$before = Fingerprint $h
$null = Run $h; Expect 're-run' 0 $script:rc
Check 're-run left every file byte-identical' ((Fingerprint $h) -ceq $before)

# 4. drift detection, then repair
Add-Content -LiteralPath (Join-Path $h '.codex\AGENTS.md') -Value 'local edit'
$null = Run $h @('-Check'); Expect 'check detects drift' 1 $script:rc
$null = Run $h; Expect 'install repairs drift' 0 $script:rc
$null = Run $h @('-Check'); Expect 'check clean after repair' 0 $script:rc

# 4b. the provenance stamp (Issue #66, ADR-0029): every rendered file carries the source's stamp, the
# one -Check prints for an OK file, and it names this checkout's HEAD.
$stampKey = 'personal-multi-harness-workstation-configuration'
function Stamp-In([string]$path) {
    $text = if ($path -like '*settings.json') { [string]((Settings (Split-Path -Parent (Split-Path -Parent $path))).$stampKey) }
            else { [System.IO.File]::ReadAllText($path) }
    foreach ($l in ($text -split "`n")) {
        if ($l.Contains('managed-by: personal-multi-harness-workstation-configuration')) {
            $mm = [regex]::Match($l, '; (release: [^;"]*; commit: [^;"]*);')
            if ($mm.Success) { return $mm.Groups[1].Value } else { return '' }
        }
    }
    return ''
}
$out = Run $h @('-Check'); Expect 'check is clean before the stamp assertions' 0 $script:rc
$srcStamp = ''
$firstOk = @($out | Where-Object { $_ -clike 'OK      *CLAUDE.md (release: *' }) | Select-Object -First 1
if ($firstOk) { $srcStamp = [regex]::Match($firstOk, '\((release: [^)]*)\)$').Groups[1].Value }
$head = (& git -C $repo rev-parse --verify HEAD 2>$null)
Write-Output "source stamp: $srcStamp; HEAD: $head"
Check 'the source stamp names HEAD' ($srcStamp -cmatch ('^release: [^;]+; commit: ' + [regex]::Escape([string]$head) + '(-dirty)?$'))
$unstamped = @(Targets $h | Where-Object { -not $srcStamp -or (Stamp-In $_) -cne $srcStamp })
Check "every rendered file carries the source's stamp [missing in: $($unstamped -join ', ')]" ($unstamped.Count -eq 0)
$other = '0123456789abcdef0123456789abcdef01234567'
foreach ($f in @((Join-Path $h '.codex\AGENTS.md'), (Join-Path $h '.claude\settings.json'))) {
    $txt = [System.IO.File]::ReadAllText($f) -creplace '; commit: [^;"]*;', "; commit: $other;"
    [System.IO.File]::WriteAllText($f, $txt, (New-Object System.Text.UTF8Encoding $false))
}
$out = Run $h @('-Check'); Expect 'check flags a stamp that differs from the source' 1 $script:rc
Check 'both restamped files are named STAMP, with the stamp they carry, and no DRIFT' (
    @($out | Where-Object { $_ -clike "STAMP *commit: $other*" }).Count -eq 2 -and -not ($out | Where-Object { $_ -clike 'DRIFT*' }))
$null = Run $h; Expect 'install restamps' 0 $script:rc
$null = Run $h @('-Check'); Expect 'check is clean after the restamp' 0 $script:rc
Check 'the restamped brief carries the source stamp again' ((Stamp-In (Join-Path $h '.codex\AGENTS.md')) -ceq $srcStamp)
$s = Settings $h
$s.permissions.deny = [object[]]@($s.permissions.deny | Where-Object { $_ -cne 'Bash(rm -rf:*)' })
[System.IO.File]::WriteAllText((Join-Path $h '.claude\settings.json'), ($s | ConvertTo-Json -Depth 100))
$out = Run $h @('-Check'); Expect 'check detects a removed deny-floor rule' 1 $script:rc
Check 'check names how many floor rules are missing' ([bool]($out | Where-Object { $_ -like '*(1 deny-floor rule(s) missing)*' }))
$null = Run $h; Expect 'install restores the removed rule' 0 $script:rc
Check 'the removed rule is back, once' ((Count-Rule $h 'Bash(rm -rf:*)') -eq 1)
Remove-Item -LiteralPath $rules
$null = Run $h @('-Check'); Expect 'check detects a missing codex rules file' 1 $script:rc
$null = Run $h; Expect 'install restores the codex rules file' 0 $script:rc

# 5. refuse an unmanaged file
$h = Join-Path $Base 'home-unmanaged'; New-Item -ItemType Directory -Force -Path (Join-Path $h '.claude') | Out-Null
$mine = Join-Path $h '.claude\CLAUDE.md'
[System.IO.File]::WriteAllText($mine, "my own hand-written brief`n")
$hash = (Get-FileHash -LiteralPath $mine).Hash
$null = Run $h; Expect 'install refuses unmanaged' 3 $script:rc
Check 'unmanaged file untouched' ((Get-FileHash -LiteralPath $mine).Hash -ceq $hash)
$null = Run $h @('-Check'); Expect 'check flags unmanaged' 3 $script:rc

# 6. merge into an existing settings file keeps everything else
$h = Join-Path $Base 'home-settings'; New-Item -ItemType Directory -Force -Path (Join-Path $h '.claude') | Out-Null
$sf = Join-Path $h '.claude\settings.json'
$orig = @'
{
    "model" : "some-model",
    "enabledPlugins" : { "a@b" : true },
    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },
    "hooks" : {
        "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\/opt\/status" } ] } ],
        "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\/opt\/status" } ] } ]
    }
}
'@
[System.IO.File]::WriteAllText($sf, $orig)
$origHash = (Get-FileHash -LiteralPath $sf).Hash
$out = Run $h @('-DryRun'); Expect 'dry-run on existing settings' 0 $script:rc
Check 'dry-run left existing settings untouched' ((Get-FileHash -LiteralPath $sf).Hash -ceq $origHash)
Check 'dry-run warns that formatting changes' ([bool]($out | Where-Object { $_ -like '*re-serialized*' }))
$null = Run $h; Expect 'merge into existing settings' 0 $script:rc
$s = Settings $h
Check 'every pre-existing key, hook and rule survives' (
    $s.model -ceq 'some-model' -and $s.enabledPlugins.'a@b' -eq $true -and
    (@($s.permissions.allow) -join '|') -ceq 'Bash(ls:*)' -and (@($s.permissions.ask) -join '|') -ceq 'Edit(/x)' -and
    @($s.hooks.PreToolUse).Count -eq 1 -and @($s.hooks.PreToolUse)[0].hooks[0].command -ceq '/opt/status' -and
    @($s.hooks.Stop)[0].hooks[0].command -ceq '/opt/status')
$d = @($s.permissions.deny)
Check 'existing deny entries keep their place at the head' ($d[0] -ceq 'Bash(my-own-rule:*)' -and $d[1] -ceq 'Bash(rm -rf:*)')
Check 'deny is a union: a floor rule already present is not duplicated, a foreign rule is kept' (
    $d.Count -eq ($floorRules + 1) -and (Count-Rule $h 'Bash(rm -rf:*)') -eq 1 -and (Count-Rule $h 'Bash(my-own-rule:*)') -eq 1)
Check 'backup holds the previous settings byte for byte' ((Get-FileHash -LiteralPath "$sf.pmhwc-backup").Hash -ceq $origHash)
$snap = (Get-FileHash -LiteralPath $sf).Hash
$null = Run $h; Expect 're-merge' 0 $script:rc
Check 're-merge left settings byte-identical' ((Get-FileHash -LiteralPath $sf).Hash -ceq $snap)

# 8. invalid settings are refused and left untouched
$h = Join-Path $Base 'home-badjson'; New-Item -ItemType Directory -Force -Path (Join-Path $h '.claude') | Out-Null
$sf = Join-Path $h '.claude\settings.json'
[System.IO.File]::WriteAllText($sf, "{ `"model`": `n")
$bad = (Get-FileHash -LiteralPath $sf).Hash
$null = Run $h; Expect 'install refuses invalid settings' 3 $script:rc
Check 'invalid settings untouched' ((Get-FileHash -LiteralPath $sf).Hash -ceq $bad)

# 9. -Overlay none renders the generic policy only
$h = Join-Path $Base 'home-generic'; New-Item -ItemType Directory -Force -Path $h | Out-Null
$null = Run $h @('-Overlay', 'none'); Expect 'install without overlay' 0 $script:rc
Check 'generic brief has no owner overlay' (-not (Get-Content -LiteralPath (Join-Path $h '.claude\CLAUDE.md') | Where-Object { $_ -clike '## Owner overlay*' }))

# 10. a permissions section of the wrong shape is refused and left untouched
$h = Join-Path $Base 'home-badperms'; New-Item -ItemType Directory -Force -Path (Join-Path $h '.claude') | Out-Null
$sf = Join-Path $h '.claude\settings.json'
[System.IO.File]::WriteAllText($sf, '{ "permissions": { "deny": "Bash(rm -rf:*)" } }')
$bad = (Get-FileHash -LiteralPath $sf).Hash
$null = Run $h; Expect 'install refuses a non-array permissions.deny' 3 $script:rc
Check 'malformed permissions untouched' ((Get-FileHash -LiteralPath $sf).Hash -ceq $bad)

# 11. an overlay adds floor entries; an invalid entry stops the run before anything is written
$ov = Join-Path $Base 'overlay-floor'; New-Item -ItemType Directory -Force -Path $ov | Out-Null
[System.IO.File]::WriteAllText((Join-Path $ov 'deny-floor.conf'), "# owner extra`ncmd terraform destroy`n")
$h = Join-Path $Base 'home-overlay'; New-Item -ItemType Directory -Force -Path $h | Out-Null
$null = Run $h @('-Overlay', $ov); Expect 'install with an overlay floor' 0 $script:rc
Check "the overlay's entry reaches both harnesses" (
    (Count-Rule $h 'Bash(terraform destroy:*)') -eq 1 -and
    [bool](Get-Content -LiteralPath (Join-Path $h '.codex\rules\workstation-deny-floor.rules') | Where-Object { $_ -ceq 'prefix_rule(pattern=["terraform", "destroy"], decision="forbidden")' }))
$i = 0
foreach ($e in @('cmd rm "-rf"', 'cmd git push --force*', 'path ~/.ssh', 'file ~/a ~/b', 'cmd')) {
    $i++
    [System.IO.File]::WriteAllText((Join-Path $ov 'deny-floor.conf'), "$e`n")
    $h = Join-Path $Base "home-badfloor-$i"; New-Item -ItemType Directory -Force -Path $h | Out-Null
    $null = Run $h @('-Overlay', $ov)
    $n = Count-Files $h
    Check "invalid entry refused (exit 2), nothing written: $e [exit $($script:rc), $n file(s)]" ($script:rc -eq 2 -and $n -eq 0)
}

# 12. usage errors exit 2, not the 1 an uncaught Write-Error would give
$h = Join-Path $Base 'home-usage'; New-Item -ItemType Directory -Force -Path $h | Out-Null
$null = Run $h @('-DryRun', '-Check'); Expect '-DryRun with -Check is a usage error' 2 $script:rc
$null = Run $h @('-Overlay', (Join-Path $Base 'no-such-overlay')); Expect 'a missing overlay directory is a usage error' 2 $script:rc
Check 'usage errors wrote nothing' ((Count-Files $h) -eq 0)

# 13. A structured profile with changed source is refused before writing targets.
$profileDir = Join-Path $Base 'profile-stale'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
foreach ($profileFile in @('profile.json', 'AGENTS.md', 'clipboard.conf', 'desktop-instructions.md', 'profile-plan.json')) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $repo 'overlay') $profileFile) -Destination (Join-Path $profileDir $profileFile)
}
$profileSource = Join-Path $profileDir 'profile.json'
$profileDoc = Get-Content -LiteralPath $profileSource -Raw | ConvertFrom-Json
$profileDoc.session_start.priority = 'speed'
[System.IO.File]::WriteAllText($profileSource, ($profileDoc | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
$h = Join-Path $Base 'home-profile-stale'; New-Item -ItemType Directory -Force -Path $h | Out-Null
$null = Run $h @('-Overlay', $profileDir)
Expect 'stale compiled profile refused before installation' 1 $script:rc
Check 'stale profile wrote no target' ((Count-Files $h) -eq 0)

Write-Output "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -ne 0) { exit 1 }
exit 0
