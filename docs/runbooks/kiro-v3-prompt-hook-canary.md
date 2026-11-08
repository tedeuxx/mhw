# Runbook: the Kiro CLI V3 prompt hook canary

The owner's act, after he installs the release candidate that carries
[#455](https://github.com/tedeuxx/mhw/issues/455), in a fresh terminal (the restart rule,
[ADR-0022](../adr/0022-restart-after-active-customization-changes.md)). It is the measurement the owner
chose on 2026-11-08: build first, measure here. Until it runs, every Kiro link of this hook is *read from
the bundle* (kas 2.35.2), not measured ([ADR-0033](../adr/0033-paste-cleaning-wrapper-primary-hook-safety-net.md),
2026-11-08 amendment). If a link does not hold, the hook fails open: no worse than before.

The payload is synthetic: an AWS-shaped access key id that belongs to no account. Use nothing real.

## 0. Before Kiro starts

```sh
mhw status
ls ~/.kiro/hooks/
kiro-cli --version
ls ~/Library/Application\ Support/kiro-cli/kas/
```

Expected: the `protections` line names `paste filter (Kiro CLI V3)`, and the directory holds
`personal-multi-harness-workstation-configuration-paste-filter.json`. Note the two versions.

Put the synthetic prompt on the clipboard (the two words join into one key-shaped string):

```sh
printf 'deploy with %s%s please' AKIA QQQQRRRRSSSSTTTT | pbcopy
```

## 1. A trusted workspace

```sh
mkdir -p ~/kiro-canary-trusted && cd ~/kiro-canary-trusted && kiro-cli
```

1. Answer **yes** to "Trust this workspace?".
2. After a few seconds the paste wrapper prints that `kiro-cli` has not enabled bracketed paste. Expected:
   the same line ends with "The Kiro prompt hook checks each prompt instead, but only in a trusted
   workspace".
3. Paste, then press Enter. Expected: the prompt is **blocked**, the model does **not** answer it, and a
   block message carries `[REDACTED:credential]` and not the key.
4. Record where the block message shows: in the chat, in a status line, only in a log, or nowhere.
5. Type `say hi` and press Enter. Expected: the model answers (the hook passes a clean prompt).

## 2. An untrusted workspace

```sh
mkdir -p ~/kiro-canary-untrusted && cd ~/kiro-canary-untrusted && kiro-cli
```

1. Answer **no** to "Trust this workspace?".
2. Paste, then press Enter. Expected from the bundle: Kiro runs no hook here, so the prompt is **not**
   blocked and the model answers it. That is the gap the wrapper's warning names; the payload is
   synthetic, so nothing leaves.

## 3. Record and clean up

Comment on #455, one line per workspace: blocked or not, the model answered or not, where the message
showed, and the two versions from step 0. Then:

```sh
pbcopy < /dev/null
```

and remove the two `~/kiro-canary-*` directories (Kiro may have written a `.kiro` folder into them).

If step 1.3 was not blocked, the hook is not loaded or does not block on this build: it fails open as
before, and the follow-up is a new Issue.
