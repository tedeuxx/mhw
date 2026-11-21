// The S31 golden cases (#501): each is a fresh fixture repository (test/helpers/s31.js) and the canary's
// steps run in order inside it. {D} is the case directory and {sha:TAG} the fixture commit a tag names.
// The fixture tags: fx-old (the floor without `cmd git reset --hard`), fx-good (with it), fx-broken (the
// fake mhw breaks every check it can), fx-install-fails (its `mhw install --yes` exits 1); HEAD is
// fx-install-fails, and rel/x names fx-old (a tag whose default package name is sanitised). Every value is synthetic.

/**
 * @typedef {{ canary: string[] }
 *   | { write: string, text: string }
 *   | { symlink: string, target: string }
 *   | { mkdir: string }} Step
 * @typedef {{ name: string, steps: Step[], why: string, tarballs?: string[] }} Case
 */

const run = (/** @type {string} */ src, /** @type {string} */ tgz, /** @type {string} */ work, /** @type {string[]} */ more = []) =>
  ['run', '--source', '{D}/pkg/src-' + src, '--tgz', '{D}/pkg/mhw-' + tgz + '.tgz', '--work', '{D}/' + work, ...more];

/** @type {Case[]} */
export const CASES = [
  {
    name: 'pack',
    why: 'pack builds from git archive of a ref of the checkout the script sits in: HEAD, a tag (default name), a full SHA; refuses any other ref and a used name',
    steps: [
      { canary: ['pack', '--ref', 'HEAD', '--name', 'HEAD', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'fx-old', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', '{sha:fx-good}', '--name', 'good', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'main~1', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'no-such-tag', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'HEAD', '--name', 'HEAD', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'rel/x', '--out', '{D}/pkg2'] },
    ],
    tarballs: ['pkg/mhw-HEAD.tgz', 'pkg/mhw-fx-old.tgz', 'pkg/mhw-good.tgz', 'pkg2/mhw-rel_x.tgz'],
  },
  {
    name: 'run-good',
    why: 'every check passes on a fresh install and on an upgrade; a stamp naming another commit is one FAIL',
    steps: [
      { canary: ['pack', '--ref', 'fx-good', '--name', 'good', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'fx-old', '--name', 'old', '--out', '{D}/pkg'] },
      { canary: run('good', 'good', 'fresh', ['--commit', '{sha:fx-good}']) },
      { canary: run('good', 'good', 'upgrade', ['--from-tgz', '{D}/pkg/mhw-old.tgz', '--commit', '{sha:fx-good}']) },
      { canary: run('good', 'good', 'wrong-commit', ['--commit', '{sha:fx-old}']) },
      { canary: run('good', 'good', 'no-commit') },
    ],
  },
  {
    name: 'run-broken',
    why: 'a package that drops a floor rule, does not block in one hook, renders a different Kiro hook, reports DRIFT and leaves files behind: every check that can fail fails',
    steps: [
      { canary: ['pack', '--ref', 'fx-broken', '--name', 'broken', '--out', '{D}/pkg'] },
      { canary: run('broken', 'broken', 'fresh') },
    ],
  },
  {
    name: 'run-floor-mismatch',
    why: 'the source tree carries a floor rule the installed package does not render (the upgrade-from tag as head)',
    steps: [
      { canary: ['pack', '--ref', 'fx-good', '--name', 'good', '--out', '{D}/pkg'] },
      { canary: ['pack', '--ref', 'fx-old', '--name', 'old', '--out', '{D}/pkg'] },
      { canary: run('good', 'old', 'fresh') },
    ],
  },
  {
    name: 'run-install-fails',
    why: 'mhw install exiting 1, and npm refusing a tgz that is not one, both stop the run at exit 1 with no summary',
    steps: [
      { canary: ['pack', '--ref', 'HEAD', '--name', 'HEAD', '--out', '{D}/pkg'] },
      { canary: run('HEAD', 'HEAD', 'fresh') },
      { write: 'pkg/mhw-garbage.tgz', text: 'not a tarball\n' },
      { canary: run('HEAD', 'HEAD', 'upgrade', ['--from-tgz', '{D}/pkg/mhw-garbage.tgz']) },
    ],
  },
  {
    name: 'run-refusals',
    why: 'a work directory that is not empty, a floor line outside the grammar, a floor file pointing outside the source, and no floor entry at all are each refused with exit 2',
    steps: [
      { canary: ['pack', '--ref', 'fx-good', '--name', 'good', '--out', '{D}/pkg'] },
      { write: 'busy/x', text: 'x\n' },
      { canary: run('good', 'good', 'busy') },
      { write: 'bad/global/deny-floor.conf', text: 'cmd rm $(boom)\n' },
      { canary: ['run', '--source', '{D}/bad', '--tgz', '{D}/pkg/mhw-good.tgz', '--work', '{D}/w-bad'] },
      { write: 'bad2/global/deny-floor.conf', text: 'cmd\n' },
      { canary: ['run', '--source', '{D}/bad2', '--tgz', '{D}/pkg/mhw-good.tgz', '--work', '{D}/w-bad2'] },
      { write: 'outside/deny-floor.conf', text: 'cmd ls\n' },
      { mkdir: 'linked/global' },
      { symlink: 'linked/global/deny-floor.conf', target: '{D}/outside/deny-floor.conf' },
      { canary: ['run', '--source', '{D}/linked', '--tgz', '{D}/pkg/mhw-good.tgz', '--work', '{D}/w-linked'] },
      { write: 'empty/global/deny-floor.conf', text: '# nothing\n\n' },
      { canary: ['run', '--source', '{D}/empty', '--tgz', '{D}/pkg/mhw-good.tgz', '--work', '{D}/w-empty'] },
    ],
  },
  {
    name: 'usage',
    why: 'no subcommand, an unknown one, and a missing required option are usage errors with exit 2',
    steps: [
      { canary: [] },
      { canary: ['deploy'] },
      { canary: ['pack', '--out', '{D}/pkg'] },
      { canary: ['run', '--source', '{D}/x', '--work', '{D}/w'] },
    ],
  },
];
