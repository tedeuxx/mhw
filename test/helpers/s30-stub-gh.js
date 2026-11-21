// The stub gh of the method issue sync suites (#500, S30 of #470): a line-for-line port of STUB_GH in the
// deleted .github/scripts/method_issue_sync_test.py. It logs every call, with the token it was given by
// name (never by value) and whether GITHUB_TOKEN reached it, to STUB_LOG, and keeps the Issues in
// STUB_STATE. The live parity arm also runs the original against the Python stub itself, read from the
// base revision, which is what holds this port to the original. Tests only; no network.
import fs from 'node:fs';

const statePath = /** @type {string} */ (process.env.STUB_STATE);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const token = process.env.GH_TOKEN || '';
/** @type {Record<string, string>} */
const names = { 'tok-mhw': 'MHW_TOKEN', 'tok-skills': 'MHW_SKILLS_TOKEN' };
const who = names[token] || 'other';
fs.appendFileSync(/** @type {string} */ (process.env.STUB_LOG), JSON.stringify({ args, token: who, github_token: 'GITHUB_TOKEN' in process.env }) + '\n');

const repo = () => (args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null);
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
/** @param {string} flag */
const value = (flag) => args[args.indexOf(flag) + 1];
/** A body file as Python's open().read() reads it: newlines universal. @param {string} file */
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
/** Written synchronously, then exit. @param {string} text @param {number} [code] @param {number} [fd] */
function out(text, code = 0, fd = 1) {
  fs.writeSync(fd, text + '\n');
  process.exit(code);
}
const verb = args.slice(0, 2).join(' ');

if (verb === 'issue view' && repo() === 'tedeuxx/mhw') {
  out(args.includes('comments') ? JSON.stringify({ comments: state.mhw_comments }) : JSON.stringify(state.mhw));
} else if (verb === 'issue comment' && repo() === 'tedeuxx/mhw') {
  const body = read(value('--body-file'));
  state.mhw_comments.push({ body, author: { login: 'github-actions' } });
  save();
  out('https://github.com/tedeuxx/mhw/issues/7#c');
} else if (verb === 'issue list' && repo() === 'tedeuxx/tadeumendonca-skills') {
  out(JSON.stringify(state.skills));
} else if (verb === 'issue create') {
  const n = 900 + state.skills.length;
  const body = read(value('--body-file'));
  state.skills.push({
    number: n, title: value('--title'), state: 'OPEN', author: { login: 'app/tedeuxx-mhw-mirror' },
    url: 'https://github.com/tedeuxx/tadeumendonca-skills/issues/' + n, body,
  });
  save();
  out('https://github.com/tedeuxx/tadeumendonca-skills/issues/' + n);
} else if (['issue close', 'issue reopen', 'issue edit', 'issue comment', 'issue view'].includes(verb)) {
  out('ok');
} else {
  out('stub gh: unexpected call', 9, 2);
}
