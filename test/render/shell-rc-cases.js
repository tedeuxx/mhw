// The S21 scenarios (#492): what test/render/shell-rc-golden.test.js runs through install.sh's start-up
// block step, cut out of the head's install.sh (which runs src/render/shell-rc.js) and, while the base
// revision still holds them, out of the base's install.sh (its rc_* and shell_rc_* functions).
// test/golden/S21/transcripts records the base's. Each scenario is one throwaway directory:
//   T/home  the HOME (its tree is what a transcript records after each run)
//   T/out   a directory outside HOME (its tree is recorded too: a ZDOTDIR there is never written)
// Paths in a fixture change, a ZDOTDIR and a --shell-rc start with H/ (HOME), O/ (outside) or S/ (<T>/homex, a
// sibling of HOME, recorded when it exists); a fixture text or link target may say @H or @O for their paths. These are the
// rc_* cases of global/install.test.sh, and the ones around them, as scenarios.

export const NAME = 'personal-multi-harness-workstation-configuration';
export const BEGIN = '# >>> ' + NAME + ': paste wrapper (ADR-0011); managed block, mhw uninstall removes it';
export const END = '# <<< ' + NAME + ': paste wrapper';
const TAG = '# ' + NAME + ': paste wrapper (ADR-0011)';
const L2C = '# ' + NAME + ': clean pastes into claude/codex/kiro-cli (ADR-0011)';
const L2S = '. "$HOME/.local/share/' + NAME + '/paste-filter.sh"';
/** The snippet the block sources, as the driver sets it (snippet_dest under the throwaway HOME). */
export const SNIPPET_REL = '.local/share/' + NAME + '/paste-filter.sh';

/**
 * @typedef {{ write: string, text: string } | { rm: string } | { symlink: string, to: string } | { mkdir: string }
 *   | { chmod: string, mode: number }} Change
 * @typedef {{ mode: 'install' | 'check' | 'dry-run' | 'uninstall', shellRc?: string, before?: Change[], label?: string }} Run
 * @typedef {{ name: string, shell?: string | null, uname?: 'Darwin' | 'Linux', zdotdir?: string, setup?: Change[],
 *   runs: Run[] }} Scenario
 */

const install = /** @type {Run} */ ({ mode: 'install' });
const check = /** @type {Run} */ ({ mode: 'check' });
const dry = /** @type {Run} */ ({ mode: 'dry-run' });
const uninstall = /** @type {Run} */ ({ mode: 'uninstall' });
/** @param {Run} r @param {string} label */
const as = (r, label) => ({ ...r, label });
/** @param {string} rc @returns {(r: Run) => Run} */
const at = (rc) => (r) => ({ ...r, shellRc: rc });

/** A block as install writes it, for a snippet under a HOME the driver names <T>/home. @param {string} body */
const blockWith = (body) => BEGIN + '\n' + body + '\n' + END + '\n';
// The fixture writes the throwaway HOME's absolute path where the text says @H.
const OURS = blockWith('[ -r "@H/' + SNIPPET_REL + '" ] && . "@H/' + SNIPPET_REL + '"');

const R = 'H/zshrc-throwaway';
const r = at(R);

/** @type {Scenario[]} */
export const SCENARIOS = [
  // install.test.sh: the default install under zsh writes ~/.zshrc only.
  { name: 'zsh-fresh', runs: [check, dry, install, as(install, 'install again'), as(check, 'check after install'),
    dry, uninstall, as(check, 'check after uninstall')] },
  { name: 'zsh-owner-file', setup: [{ write: 'H/.zshrc', text: 'export MINE=1\nalias ll="ls -l"\n' }, { chmod: 'H/.zshrc', mode: 0o644 }],
    runs: [dry, check, install, check, uninstall] },
  { name: 'zsh-owner-file-uninstall-twice', setup: [{ write: 'H/.zshrc', text: 'export MINE=1\n' }],
    runs: [install, uninstall, as(uninstall, 'uninstall again')] },
  { name: 'zsh-bare-name', shell: 'zsh', runs: [install, uninstall] },
  // --shell-rc=FILE: check, dry-run, install, again, a changed block, uninstall.
  { name: 'shell-rc-file', setup: [{ write: R, text: 'export OWNER=1\n' }],
    runs: [r(dry), r(check), r(install), r(as(install, 'install again')), r(as(check, 'check with the block')),
      r({ mode: 'check', label: 'check a changed block', before: [{ write: R, text: 'export OWNER=1\n' + blockWith('echo changed') }] }),
      r(as(install, 'install replaces a changed block')), r(uninstall)] },
  { name: 'shell-rc-file-missing', runs: [r(check), r(dry), r(install), r(uninstall)] },
  { name: 'shell-rc-file-new-directory', runs: [at('H/new/dir/rc')(install), at('H/new/dir/rc')(uninstall)] },
  { name: 'shell-rc-file-plus-defaults', setup: [{ write: 'H/.bashrc', text: 'export B=1\n' + OURS }],
    runs: [r(install), r(uninstall)] },
  // The earlier forms.
  { name: 'one-line-form', setup: [{ write: R, text: 'export A=1\n[ -r "/old/paste-filter.sh" ] && . "/old/paste-filter.sh"  ' + TAG + '\nexport B=2\n' }],
    runs: [r(check), r(dry), r(install), r(check)] },
  { name: 'one-line-form-uninstall', setup: [{ write: R, text: 'export A=1\nold line  ' + TAG + '\n' }], runs: [r(uninstall)] },
  { name: 'two-line-form-beside-block', setup: [{ write: R, text: 'export A=1\n' + L2C + '\n' + L2S + '\n' + OURS + 'export B=2\n' }],
    runs: [r(check), r(dry), r(install), r(check)] },
  { name: 'two-line-form-alone', setup: [{ write: R, text: 'export A=1\n' + L2C + '\n' + L2S + '\nexport B=2\n' }],
    runs: [r(check), r(install), r(uninstall)] },
  { name: 'two-line-near-misses', setup: [{ write: R, text: L2C + '\nexport C=3\n' + L2S + '\n' + L2C + '\n\n' + L2S + '\n' + L2C + '\n' }],
    runs: [r(check), r(install), r(uninstall)] },
  { name: 'two-line-inside-an-if-body', setup: [{ write: R, text: 'if true; then\n' + L2C + '\n' + L2S + '\nfi\n' }],
    runs: [r(check), r(install), r(as(install, 'install again')), r(uninstall)] },
  { name: 'two-line-after-each-opener', setup: [{ write: R, text: ['f() {', 'x &&', 'y ||', 'while :; do', 'else', 'then\t ']
    .map((o) => o + '\n' + L2C + '\n' + L2S + '\n').join('') }], runs: [r(install), r(uninstall)] },
  { name: 'two-line-after-blank-lines', setup: [{ write: R, text: 'if true; then\n  \n\t\n' + L2C + '\n' + L2S + '\nfi\n' }],
    runs: [r(install)] },
  { name: 'two-line-only-uninstall', setup: [{ write: R, text: 'export A=1\n' + L2C + '\n' + L2S + '\n' }], runs: [r(uninstall)] },
  { name: 'tag-inside-the-block', setup: [{ write: R, text: 'x\n' + BEGIN + '\nmine  ' + TAG + '\n' + END + '\n' }],
    runs: [r(check), r(install), r(uninstall)] },
  // Damaged markers: refused, nothing written or removed.
  { name: 'damaged-begin-only', setup: [{ write: R, text: 'x\n' + BEGIN + '\nmine\n' }], runs: [r(check), r(dry), r(install), r(uninstall)] },
  { name: 'damaged-end-before-begin', setup: [{ write: R, text: END + '\n' + BEGIN + '\n' }], runs: [r(install), r(uninstall)] },
  { name: 'damaged-two-blocks', setup: [{ write: R, text: OURS + 'between\n' + OURS }], runs: [r(check), r(install), r(uninstall)] },
  { name: 'damaged-nested-begin', setup: [{ write: R, text: BEGIN + '\n' + BEGIN + ' again\n' + END + '\n' }], runs: [r(install)] },
  { name: 'damaged-end-only', setup: [{ write: R, text: 'a\n' + END + '\n' }], runs: [r(install), r(uninstall)] },
  { name: 'damaged-default-zshrc', setup: [{ write: 'H/.zshrc', text: BEGIN + '\n' }], runs: [install, check, uninstall] },
  // The file's shape.
  { name: 'no-final-newline', setup: [{ write: R, text: 'export X=1' }], runs: [r(install), r(uninstall)] },
  { name: 'crlf-file', setup: [{ write: R, text: 'export X=1\r\n' + BEGIN + '\r\nold\r\n' + END + '\r\n' }], runs: [r(check), r(install), r(uninstall)] },
  { name: 'empty-file', setup: [{ write: R, text: '' }], runs: [r(install), r(uninstall)] },
  { name: 'non-ascii-file', setup: [{ write: R, text: 'export NAME="café ☕"\n' }], runs: [r(install), r(uninstall)] },
  { name: 'only-our-block-not-created', setup: [{ write: R, text: OURS }], runs: [r(check), r(uninstall)] },
  { name: 'symlinked-file', setup: [{ write: 'H/dotfiles/zshrc', text: 'export DOT=1\n' }, { chmod: 'H/dotfiles/zshrc', mode: 0o640 },
    { symlink: 'H/.zshrc', to: 'dotfiles/zshrc' }], runs: [install, check, uninstall] },
  { name: 'symlinked-file-only-block', setup: [{ write: 'H/dotfiles/zshrc', text: '' }, { symlink: 'H/.zshrc', to: 'dotfiles/zshrc' }],
    runs: [install, uninstall] },
  { name: 'dangling-link', setup: [{ symlink: 'H/.zshrc', to: 'missing-dotfiles/zshrc' }], runs: [check, dry, install, uninstall] },
  { name: 'a-directory', setup: [{ mkdir: 'H/rc-is-a-dir' }], runs: [at('H/rc-is-a-dir')(check), at('H/rc-is-a-dir')(install), at('H/rc-is-a-dir')(uninstall)] },
  { name: 'a-link-to-a-directory', setup: [{ mkdir: 'H/somedir' }, { symlink: 'H/.zshrc', to: 'somedir' }], runs: [install, uninstall] },
  // ZDOTDIR.
  { name: 'zdotdir-inside-home', zdotdir: 'H/zdot', runs: [install, check, uninstall] },
  { name: 'zdotdir-outside-home', zdotdir: 'O/zdot', setup: [{ write: 'O/zdot/.zshrc', text: 'export OWNER_ZSH=1\n' + OURS }],
    runs: [check, dry, install, uninstall] },
  // A sibling of HOME whose name starts with HOME's (<T>/homex) is outside HOME (PR #543 QA, M23).
  { name: 'zdotdir-sibling-of-home', zdotdir: 'S', setup: [{ write: 'S/.zshrc', text: 'export Z=1\n' + OURS }],
    runs: [check, install, uninstall] },
  { name: 'zdotdir-outside-home-shell-rc', zdotdir: 'O/zdot', setup: [{ write: 'O/zdot/.zshrc', text: OURS }], runs: [r(install), r(uninstall)] },
  // The shell decides the file.
  { name: 'bash-linux', shell: '/bin/bash', uname: 'Linux',
    setup: [{ write: 'H/.bash_profile', text: 'export OWNER_LOGIN=1\n[ -r ~/.bashrc ] && . ~/.bashrc\n' }],
    runs: [check, dry, install, check, uninstall] },
  { name: 'bash-darwin-owner-bash-profile', shell: '/bin/bash',
    setup: [{ write: 'H/.bash_profile', text: 'export OWNER_LOGIN=1\n[ -r ~/.bashrc ] && . ~/.bashrc\n' }, { chmod: 'H/.bash_profile', mode: 0o644 }],
    runs: [check, dry, install, as(install, 'install again'), check, uninstall] },
  { name: 'bash-darwin-bash-login-only', shell: '/bin/bash', setup: [{ write: 'H/.bash_login', text: 'export OWNER_BASH_LOGIN=1\n' }],
    runs: [install, uninstall] },
  { name: 'bash-darwin-both-login-files', shell: '/bin/bash',
    setup: [{ write: 'H/.bash_profile', text: 'export P=1\n' }, { write: 'H/.bash_login', text: 'export L=1\n' + OURS }],
    runs: [install, uninstall] },
  { name: 'bash-darwin-profile-only', shell: '/bin/bash', setup: [{ write: 'H/.profile', text: 'export OWNER_PROFILE=1\n' }],
    runs: [check, dry, install, uninstall] },
  { name: 'bash-darwin-no-login-file', shell: '/bin/bash', runs: [install, check, uninstall] },
  { name: 'bash-darwin-empty-bash-profile', shell: '/bin/bash', setup: [{ write: 'H/.bash_profile', text: '' }],
    runs: [install, uninstall] },
  { name: 'bash-darwin-dangling-bash-profile', shell: '/bin/bash', setup: [{ symlink: 'H/.bash_profile', to: 'nowhere' }],
    runs: [install, uninstall] },
  { name: 'bash-darwin-created-then-edited', shell: '/bin/bash',
    runs: [install, { mode: 'uninstall', label: 'uninstall after the owner added a line',
      before: [{ write: 'H/.bash_profile', text: 'export LATER=1\n' + OURS }] }] },
  { name: 'bash-bare-name', shell: 'bash', uname: 'Linux', runs: [install, uninstall] },
  // Uninstall deletes a file install created only when nothing but the block is in it, and never a link
  // (PR #543 QA, M11 and M12): blank lines the owner added stay; a link the owner put there stays.
  { name: 'created-then-blank-lines', runs: [install,
    { mode: 'uninstall', label: 'uninstall after the owner added blank lines', before: [{ write: 'H/.zshrc', text: '\n\n' + OURS }] }] },
  { name: 'created-then-linked', runs: [install,
    { mode: 'uninstall', label: 'uninstall after the owner replaced it with a link',
      before: [{ rm: 'H/.zshrc' }, { write: 'O/dot/zshrc', text: OURS }, { symlink: 'H/.zshrc', to: '@O/dot/zshrc' }] }] },
  // No file: another shell, SHELL empty, --shell-rc=none.
  { name: 'fish', shell: '/usr/local/bin/fish', setup: [{ write: 'H/.zshrc', text: 'z\n' + OURS }], runs: [check, dry, install, uninstall] },
  // SHELL empty, not unset: a shell that sets SHELL itself when it is unset (bash as sh does, from the
  // passwd entry) would make an unset SHELL read as the login shell on one machine and not on another.
  { name: 'shell-empty', shell: '', runs: [check, install, uninstall] },
  { name: 'shell-rc-none', setup: [{ write: 'H/.zshrc', text: 'export Z=1\n' + OURS }],
    runs: [at('none')(check), at('none')(dry), at('none')(install), at('none')(uninstall)] },
  // The list of created files.
  { name: 'created-list-kept-across-installs', runs: [install, as(install, 'install again'), uninstall] },
  { name: 'created-list-names-a-file-again', runs: [install,
    { mode: 'install', label: 'install after the owner removed the file', before: [{ rm: 'H/.zshrc' }] }, uninstall] },
];
