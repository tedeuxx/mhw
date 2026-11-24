// #590: the paste wrapper is removed, so the user-layer installer writes no shell snippet (paste-filter.sh),
// no start-up block in ~/.zshrc, ~/.bashrc or the bash login file, and no list of the start-up files it
// created; on a HOME an earlier install left them in, it takes them out with a backup. The S25 goldens were
// recorded while install wrote them. This takes the wrapper's material out of BOTH sides before they are
// compared, so everything else is still held to the transcripts; test/render/shell-rc.test.js and
// test/install/install-user.test.js hold the removal itself. S25's expected-differences.json names it.
//   - every path of the snippet, of the created-files list, and of a start-up file (and its backups);
//   - a dry run's WOULD WRITE block for the snippet;
//   - every output line that names the snippet, the start-up block or its markers, or the NOTE that asked
//     the owner to add the line by hand.

const NAME = 'personal-multi-harness-workstation-configuration';

/** A path of the wrapper's material, as a tree records it (relative to the HOME). @param {string} p */
export const wrapperPath = (p) => /(?:^|\/)paste-filter\.sh$|(?:^|\/)shell-rc-created\.list$/.test(p)
  || /(?:^|\/)(?:\.zshrc|\.bashrc|\.bash_profile|\.bash_login|rc)(?:\.pmhwc-backup(?:\.\d+)?)?$/.test(p);

/** An output line about the wrapper's material. @param {string} line */
const wrapperLine = (line) => line.includes('paste-filter.sh') || line.includes(NAME + ': paste wrapper')
  || /paste-wrapper (?:start-up )?block|activates the paste wrapper|automatic paste cleaning|the shell start-up block/.test(line);

/** Output without the wrapper's material. @param {string} text */
export function stripWrapperOutput(text) {
  const out = text.replace(/^WOULD WRITE ([^\n]*paste-filter\.sh) \((?:\d+|<N>) bytes\):\n----- begin \1\n[\s\S]*?----- end \1\n/gm, '');
  return out.split('\n').filter((l) => !wrapperLine(l)).join('\n');
}

/**
 * The runs of a scenario without the wrapper's material, either side.
 * @template {{ stdout: string, stderr: string, tree: Array<{ path: string }> }} R
 * @param {R[]} runs
 * @returns {R[]}
 */
export function stripWrapper(runs) {
  return runs.map((r) => ({ ...r, stdout: stripWrapperOutput(r.stdout), stderr: stripWrapperOutput(r.stderr), tree: r.tree.filter((e) => !wrapperPath(e.path)) }));
}
