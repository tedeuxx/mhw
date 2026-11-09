# Runbook: the Kiro CLI V3 prompt hook canary

The owner's act, after he installs a release that carries
[#455](https://github.com/tedeuxx/mhw/issues/455), in a fresh terminal (the restart rule,
[ADR-0022](../adr/0022-restart-after-active-customization-changes.md)). Step 0 needs no Kiro and no
login, so an agent may run it. The rest needs his login and a terminal he types into.

What is measured already, and what this runbook is for, is in
[ADR-0033](../adr/0033-paste-cleaning-wrapper-primary-hook-safety-net.md), amendment "the Kiro canary
results" (#462). The first run (#455, `kiro-cli` 3.1.0, kas 2.35.2) showed the hook loaded and invoked,
but the paste wrapper cleaned the paste first, so the hook never saw a finding. This run sends the dirty
prompt past the wrapper, to measure the block path inside Kiro. If the block does not hold, the hook
fails open: no worse than before.

The payload is synthetic: an AWS-shaped access key id that belongs to no account. Use nothing real, and
never type the full key-shaped string into a file: the commands below join it from two parts.

## 0. Before Kiro starts: the hook command alone

```sh
mhw status
ls ~/.kiro/hooks/
kiro-cli --version
ls ~/Library/Application\ Support/kiro-cli/kas/
```

Expected: the `protections` line names `paste filter (Kiro CLI V3)`, and the directory holds
`personal-multi-harness-workstation-configuration-paste-filter.json`. Note the two versions.

Then feed the installed hook command a synthetic payload, exactly as Kiro would:

```sh
hook="$HOME/.kiro/hooks/personal-multi-harness-workstation-configuration-paste-filter.json"
cmd=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["hooks"][0]["action"]["command"])' "$hook")
printf '{"hook_event_name":"UserPromptSubmit","prompt":"deploy with %s%s please"}' AKIA QQQQRRRRSSSSTTTT | sh -c "$cmd"; echo "exit $?"
printf '{"hook_event_name":"UserPromptSubmit","prompt":"say hi"}' | sh -c "$cmd"; echo "exit $?"
printf '{"hook_event_name":"UserPromptSubmit"}' | sh -c "$cmd"; echo "exit $?"
```

Expected, in order:

1. `exit 2`, with the block notice and `deploy with [REDACTED:credential] please` on stderr, and the key
   nowhere in the output.
2. `exit 0`, no output.
3. `exit 0`, with an internal-error notice saying the prompt was not checked (fail open, by design).

If line 1 does not exit 2, stop: the hook command itself does not block, and Kiro cannot fix that.

## 1. A trusted workspace, the dirty prompt typed

```sh
mkdir -p ~/kiro-canary-trusted && cd ~/kiro-canary-trusted && kiro-cli
```

1. Answer **yes** to "Trust this workspace?".
2. Do **not** paste: on 3.1.0 the wrapper cleans a paste before Kiro sees it. Type the prompt by hand
   instead, `deploy with `, then `AKIA`, then `QQQQRRRRSSSSTTTT`, then ` please`, as one line with no
   spaces inside the key, and press Enter. The wrapper relays typed bytes unchanged.
   - Alternative: start Kiro without the wrapper, `command kiro-cli` (it skips the wrapper's shell
     function), and then a paste reaches the hook dirty too.
3. Expected: the prompt is **blocked**, the model does **not** answer it, and a block message carries
   `[REDACTED:credential]` and not the key.
4. Record where the block message shows: in the chat, in a status line, only in a log, or nowhere.
5. Type `say hi` and press Enter. Expected: the model answers (the hook passes a clean prompt).
6. Exit Kiro.

## 2. After the block: did Kiro keep the dirty prompt?

```sh
grep -rlF "$(printf '%s%s' AKIA QQQQ)" ~/.kiro ~/Library/Application\ Support/kiro-cli
```

Expected: no output. If a file is listed, record its path (never its content) and delete the synthetic
line or the session file. The prefix matches only the synthetic key.

## 3. An untrusted workspace

```sh
mkdir -p ~/kiro-canary-untrusted && cd ~/kiro-canary-untrusted && kiro-cli
```

Answer **"Don't trust, exit"**. Observed on 3.1.0 (#455): Kiro exits ("Kiro exited without loading this
folder"), so no session opens and no prompt can be sent. Record if a later build behaves differently,
for example by opening a session that runs no hook.

## 4. Record and clean up

This run is optional: the owner accepted the measured evidence and closed #462 on 2026-11-08. If you
run it, comment on the open Issue that tracks the canary, or open one: blocked or not, the model answered or not, where the message showed, what the grep of
step 2 found, and the two versions from step 0. Then remove the canary's traces:

```sh
pbcopy < /dev/null
grep -rl kiro-canary ~/.kiro/workspace-roots
```

The grep lists the trust entries the canary wrote; remove each entry's directory under
`~/.kiro/workspace-roots/` by hand. Then remove the two `~/kiro-canary-*` directories (Kiro may have
written a `.kiro` folder into them).

If step 1.3 was not blocked, the hook does not block inside Kiro on this build: it fails open as before,
and the follow-up is decided with the owner on that Issue.
