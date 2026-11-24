// The usage text of mhw on macOS and Linux (#495, S24 of #470), the docstring global/workstation.py printed:
// `mhw --help` (and -h, help) prints USAGE, its usage paragraph, word for word; `mhw` with no argument
// prints DOC, the whole text, and exits 2. Generated once from workstation.py; edit it here now.

export const USAGE = [
  '    ./mhw install [--yes] [--verbose]   say what will change, wait for RETURN, ask for the administrator',
  '                                          password once (only when the admin layer changes), install the',
  '                                          admin layer and then the user layer, end with the next steps',
  '                                          (Issue #113); without a terminal it only informs, unless --yes',
  '    ./mhw install --no-admin            the user layer only, no password asked',
  '    ./mhw install --admin               the admin layer only',
  '    ./mhw install --method              also render the working method (method/); off by default until',
  '                                          the plugin cutover (#63, #64), kept current once installed',
  '    ./mhw status [--verbose]            what is installed, which layers and protections, the version key',
  '    ./mhw status --summary              the session-start runtime summary an agent harness relays (#80)',
  '    ./mhw mcp check [--timeout=SECONDS] connection test: start each MCP active-set server and say whether',
  '                                          it answers (it starts processes; exit 1 when one fails; #219,',
  '                                          #595; it was status --mcp-connect until v11)',
  '    ./mhw mcp render --check            drift check: exit 1 when an installed MCP configuration differs',
  '                                          from the definition; it starts nothing (mhw mcp render --help)',
  '    ./mhw check                         exit non-zero when an installed target differs from this checkout',
  '                                          (the admin layer included, stamped or from an earlier release),',
  '                                          or a required prerequisite is missing (global/prerequisites.json)',
  '    ./mhw check --prerequisites         the prerequisites section only (Issue #89); never applies anything',
  '    ./mhw check --project=DIR           also check DIR\'s root AGENTS.md merge-authority declaration against',
  '                                          the installed method contract (Issue #195): exit 1 on a finding,',
  '                                          2 when the installed method cannot validate it (fail closed)',
  '    ./mhw update [vX.Y.Z] [--yes]       fetch tags, check out the newest release (or the one given), install;',
  '                                          in an npm install (no .git, Issue #68) run the npm update, then',
  '                                          the new package\'s install (Issue #113)',
  '    ./mhw uninstall [--yes]             remove the admin layer (password asked once) and the user layer;',
  '                                          in an npm install, run it before npm uninstall -g mhw (npm runs',
  '                                          no uninstall script, measured with npm 11.13.0)',
  '    ./mhw postinstall                   what npm\'s postinstall runs (bin/postinstall.js): one line naming',
  '                                          `mhw install`; it installs nothing (Issue #113)',
].join('\n');

export const DOC = [
  [
    'mhw, the one entry point of the multi-harness managed workstation (Issue #67), run through ./mhw in a',
    'checkout and as mhw after an npm install (Issue #68). Its deprecated alias, ./workstation and the npm',
    '`workstation` command, was removed in v7 (Issue #206).',
  ].join('\n'),
  USAGE,
  [
    'Options for every subcommand: --overlay=DIR|none (default: the repository\'s overlay/), and',
    '--project=DIR for status (default: the git root of the current directory) and for check (no default:',
    'the project-brief section runs only when it is given).',
  ].join('\n'),
  [
    'mhw install-user and mhw install-admin stay the internals: mhw decides their flags and',
    'summarises their output, it renders nothing itself. Version key (Issue #57): a project declares the',
    "workstation release range it needs in a .workstation-version file, for example \">=3.1 <4\"; status",
    'compares it with the installed provenance stamp (ADR-0029) and never fails on a mismatch.',
  ].join('\n'),
  [
    'Environment, tests and probes only: WORKSTATION_MANAGED_ROOT prefixes every admin-layer path.',
    'node: modules only, Node 26 or later (engines.node). Never writes outside what the installers write. sudo runs only for',
    'install-admin --apply or --remove, after the owner confirmed in a terminal (or passed --yes) and',
    'sudo itself asked for the password (Issue #113).',
    '',
  ].join('\n'),
].join('\n\n');
