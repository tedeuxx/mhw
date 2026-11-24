# ADR-0042: node-pty 1.1.0, vendored with its macOS prebuilds, is the paste wrapper's pty

- **Status:** ~~proposed~~ accepted (2026-11-20; https://github.com/tedeuxx/mhw/issues/487#issuecomment-7053800611); **superseded** 2026-11-24 by [ADR-0047](0047-third-party-terms-judged-by-the-model.md)'s amendment of that date ([#590](https://github.com/tedeuxx/mhw/issues/590)): the paste wrapper is removed, and node-pty with it. ~~(2026-11-20). The owner ratifies; until then the slice
  that carries it (#487) states the choice and its gaps.~~
- **Date:** 2026-11-20
- **Deciders:** the owner (D2 of the Node runtime requirements: *"bibliotecas podem ser utilizadas sem
  problemas"*); written by the implementing agent
- **Issues:** [#487](https://github.com/tedeuxx/mhw/issues/487) (S16 of [#470](https://github.com/tedeuxx/mhw/issues/470))
- **Amends:** [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md) (where the wrapper runs),
  [ADR-0034](0034-npm-distribution-from-github-by-tag.md) (what the package ships)

## Context and problem

The paste wrapper (ADR-0033) starts a harness CLI on a pseudo-terminal and cleans bracketed pastes
before the CLI sees them. In Python it used the standard `pty` module. Node's standard library has no
pseudo-terminal, so the Node runtime requirements (D2) allow a library for it. Two facts constrain the
choice:

1. **mhw has no npm runtime dependency.** A git install of mhw (`npm install -g github:…`, ADR-0034)
   left every runtime dependency unmet (measured with npm 11.13.0, #472), so third-party code ships
   inside the package under `src/vendor/`, byte-identical to a pinned devDependency (smol-toml).
2. **A pty is a native addon.** Its binary differs by operating system and architecture; a build from
   source runs `node-gyp` at install time.

## Decision drivers

- The wrapper must never run the CLI unwrapped on a terminal without saying so (ADR-0033).
- No downloaded code may run at install time beyond what the package already carries.
- The pinned version is the audited one (integrity in `npm-shrinkwrap.json`, `npm audit` in CI).
- The macOS reference machine must stay fully supported.

## Considered options

1. **node-pty 1.1.0 (Microsoft, MIT), vendored: the five `lib/` files the POSIX path loads and the
   `darwin-arm64` and `darwin-x64` prebuilds (`pty.node`, `spawn-helper`).** *Chosen.* The maintained pty
   library for Node that the Visual Studio Code terminal uses (as node-pty's README states); how widely it is used compared with others
   was not measured. Its prebuilds are built on N-API (`node-addon-api`). The vendored module loaded and
   passed the live relay tests on Node 25.9.0 (locally) and 26.13.1 (CI): two versions, which is
   evidence and not a proof that the module is independent of the Node ABI.
   - Good: the vendored bytes are held equal to the pinned package (`test/vendor.test.js`).
   - Good: no script of node-pty runs at install. **Measured once** on macOS, npm 11.13.0, the
     `git+file` route, both offline and online.
     - npm's git-dependency preparation (pacote `lib/git.js`, `#prepareDir`) does run
       `npm install --force … --include=dev` in the clone, because mhw has a `postinstall`.
     - That inner run inherits `npm_config_global=true` from the outer global install. So it installs
       the clone as a global package and fetches no dependency tree: the clone ends with no
       `node_modules`, and the npm cache holds no `node-pty` entry.
     - The probe preloaded a module into each node process. In the inner run it recorded argv, the
       directory and `node_modules`, and set `npm_config_ignore_scripts`, so no downloaded script could run.
     - The `github:` route itself, and Linux, were not measured.
   - Bad: about 340 KB of binaries in the repository. No Linux prebuild exists in the package; the Linux
     ones are built by this repository's CI (amendment below). Windows binaries are not vendored (D7).
2. **node-pty as an npm dependency.** Rejected: unmet on the git install route (#472); with scripts it
   builds with node-gyp where no prebuild exists, and its macOS `spawn-helper` arrives without its
   execute bit (the tarball carries it 0644: with `--ignore-scripts` the spawn fails with
   `posix_spawnp failed`, measured on darwin-arm64, Node 25.9.0).
3. **A prebuilt fork that downloads binaries at install** (for example a "prebuilt-multiarch" package).
   Rejected: it runs a downloader at install time and fetches binaries that no integrity in the
   shrinkwrap covers.
4. **The system `script` command as the pty.** Rejected: its options differ between macOS and Linux, it
   writes a typescript file unless told otherwise per platform, and it gives no control of the window
   size or the exit status the wrapper must relay.

## Decision outcome

Option 1. `src/lib/pty.js` loads the vendored copy at run time and never throws: it returns the module
or the reason it cannot be used (no prebuild for this platform and architecture, a spawn-helper that is
not executable, a module that does not load). When it cannot be used, `mhw paste-wrapper run` refuses
in one line on stderr naming the reason and `command <cli>`, exit 126, and starts nothing; `mhw status`
prints `PASTE   FAIL` with the same reason.

## Consequences

- Good: the wrapper runs on the macOS reference machine from a git install with no install-time code.
- Good: the refusal is visible where the pty is missing; a session is never silently unwrapped.
- ~~Bad: **on Linux the shell functions stop starting the CLI**: they refuse, and the owner runs
  `command claude` (the prompt hook still checks). Under Python they worked there. Building node-pty on
  Linux, or vendoring a Linux binary built elsewhere, is an open option for the owner.~~ *Struck the same
  day: the owner decided it, and the Linux binaries are vendored (amendment below).*
- Bad: job control is relayed by reading the CLI's state every 250 ms (node-pty reports no stop), and the
  CLI's pty starts with node-pty's default modes instead of the terminal's own.
- Neutral: Windows is *not measured* (D7); no shell functions are installed there.

## Amendment 2026-11-20: Linux binaries built by our CI (owner decision, PR #521, ~~proposed~~ accepted (2026-11-20; https://github.com/tedeuxx/mhw/issues/487#issuecomment-7053800611))

The agents-lead lens escalated E1: on Linux the wrapper refused, so the primary cleaner was gone there.
The owner decided in [his comment on PR #521](https://github.com/tedeuxx/mhw/pull/521#issuecomment-7049084616):
build the Linux binary in CI from the pinned source and vendor it. He rejected the other two options:
keeping the Python wrapper on Linux, and accepting the refusal.

**What is vendored.** `src/vendor/node-pty/prebuilds/linux-x64/pty.node` and `linux-arm64/pty.node`.
Linux builds no `spawn-helper`, because node-pty uses `forkpty` there (`binding.gyp`).

**How they were built.** `.github/workflows/node-pty-linux.yml` does this:

1. It packs `node-pty@1.1.0` and `node-addon-api@7.1.1` with `--ignore-scripts`.
2. It checks both tarballs against the `npm-shrinkwrap.json` integrity before using them.
3. It compiles `pty.node` with the node-gyp bundled with npm (node-gyp 12.4.0, npm 11.20.0), against
   the headers of the installed Node v26.13.1 (`--nodedir`).
4. It runs on `ubuntu-22.04` (x64) and `ubuntu-22.04-arm` (arm64), both glibc 2.35.
5. It runs the 17 live relay tests through the built binary; all 17 passed on both architectures.
6. It publishes the binary and its sha256 as a workflow artifact.

The job has `contents: read` only, and every action is pinned by SHA. node-gyp runs only inside that
ephemeral runner, never at install.

**Provenance, stated as it is.**
- These files come from **run
  [44811001228](https://github.com/tedeuxx/mhw/actions/runs/44811001228), at commit `4f6b5a9a`**.
  Their sha256 is:
  - `linux-x64`: `b9d2d6d8d52a28450d66103254908463531b52d454b3b546ddae939a27a0f7f8`
  - `linux-arm64`: `2ddfe0da896b357015e23c52fd694cf7d6988c97a45687af987a076997f63052`
- `src/vendor/node-pty/linux-prebuilds.json` records the run, the commit, the source integrities, the
  toolchain and these hashes. `test/vendor.test.js` holds each committed file to its recorded sha256 (a
  changed byte turns it red, calibrated) and holds the recorded source to the shrinkwrap.
- **No npm integrity covers these two files**, because npm publishes no Linux binary for node-pty 1.1.0.
  Their trust rests on our CI run, on a source that is integrity-checked, and on a toolchain the runner
  image provides. That is weaker than the macOS files, which are byte-identical to the npm package.
- The artifact expires after 90 days. The run's log and the committed record stay.
- **A rebuild matched, measured once.** The next run of the same job
  ([44812010860](https://github.com/tedeuxx/mhw/actions/runs/44812010860)) rebuilt both files
  byte-identical to the committed ones, so on this runner image the build is reproducible. A future image
  can change that. The job reports a mismatch and does not fail on one, because the committed file is held
  to its recorded sha256, not to a rebuild.
- The binaries need glibc 2.35 or later. musl (Alpine) is not covered.

**Evidence level:** *written and tested*; the live relay ran on both Linux architectures in CI. Not
installed on any Linux machine of the owner's.

## Links

- Node runtime requirements: `docs/mhw-product-requirements-document-node-runtime.md`, D2 and D7.
- ~~`test/golden/S16/expected-differences.json` lists every declared difference from the Python wrapper.~~
  *(Deleted by #590 with the wrapper; it is in this repository's git history.)*

## Amendment 2026-11-24: superseded; node-pty is removed with the paste wrapper ([#590](https://github.com/tedeuxx/mhw/issues/590))

The paste wrapper was node-pty's only runtime user, and the owner removed it (*«Só hook no envio»*;
[ADR-0047](0047-third-party-terms-judged-by-the-model.md), 2026-11-24 amendment). So `src/lib/pty.js`, the
vendored `src/vendor/node-pty` with its macOS prebuilds and its CI-built Linux binaries
(`linux-prebuilds.json`), the `node-pty` devDependency and its shrinkwrap entries (`node-addon-api` with
them), and the `node-pty-linux.yml` workflow are deleted. The one vendored package left is `smol-toml`
(test/vendor.test.js). The lifecycle suite's real-terminal arm, which also ran on node-pty, now drives its
pseudo-terminal through `test/helpers/pty-run.py` (CPython's standard `pty` module), a test helper that is
not shipped. Every sentence above is history.
