# ADR-0042: node-pty 1.1.0, vendored with its macOS prebuilds, is the paste wrapper's pty

- **Status:** proposed (2026-11-20). The owner ratifies; until then the slice that carries it (#487)
  states the choice and its gaps.
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
   - Bad: about 200 KB of binaries in the repository; no Linux prebuild exists in the package, so on
     Linux the wrapper refuses (below); Windows binaries are not vendored (D7).
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
- Bad: **on Linux the shell functions stop starting the CLI**: they refuse, and the owner runs
  `command claude` (the prompt hook still checks). Under Python they worked there. Building node-pty on
  Linux, or vendoring a Linux binary built elsewhere, is an open option for the owner.
- Bad: job control is relayed by reading the CLI's state every 250 ms (node-pty reports no stop), and the
  CLI's pty starts with node-pty's default modes instead of the terminal's own.
- Neutral: Windows is *not measured* (D7); no shell functions are installed there.

## Links

- Node runtime requirements: `docs/mhw-product-requirements-document-node-runtime.md`, D2 and D7.
- `test/golden/S16/expected-differences.json` lists every declared difference from the Python wrapper.
