// The stub gh of the milestone suite (#475): a line-for-line port of the STUB in the deleted
// method/scripts/milestone.test.py, so the golden transcripts recorded against that stub replay here.
// It logs its argv (one JSON array per line) to MILESTONE_STUB_LOG and keeps the milestone in
// MILESTONE_STUB_STATE. The live parity arm also runs the Node routes against the Python stub itself,
// read from the base revision, which is what holds this port to the original. Tests only.
import fs from 'node:fs';

const statePath = /** @type {string} */ (process.env.MILESTONE_STUB_STATE);
const logPath = /** @type {string} */ (process.env.MILESTONE_STUB_LOG);
const args = process.argv.slice(2);
fs.appendFileSync(logPath, JSON.stringify(args) + '\n', 'utf8');

/** Written synchronously (a pipe is asynchronous on macOS), then exit. @param {string} text @param {number} code */
function exit(text, code, fd = 1) {
  fs.writeSync(fd, text + '\n');
  process.exit(code);
}

if (process.env.MILESTONE_STUB_FAIL === '1') exit('stub gh failure', 9, 2);
if (args[0] === 'repo' && args[1] === 'view') exit('owner/repo', 0);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (!args.length || args[0] !== 'api') exit('unsupported stub command', 8, 2);
const endpoint = args[1];
/** The values of every -f key=value, split at the first "=". */
const fields = () => Object.fromEntries(args.flatMap((v, i) => (v === '-f' ? [args[i + 1]] : [])).map((f) => {
  const at = f.indexOf('=');
  return [f.slice(0, at), f.slice(at + 1)];
}));
if (endpoint.includes('?state=all')) exit(JSON.stringify([[state.milestone]]), 0);
if (endpoint.endsWith('/milestones') && args.includes('POST')) {
  const values = fields();
  const created = { ...state.milestone, number: 8, title: values.title, description: values.description ?? '' };
  exit(JSON.stringify(created), 0);
}
if (endpoint.endsWith('/milestones/404')) exit('not found', 1, 2);
if (endpoint.endsWith('/milestones/7') && !args.includes('PATCH')) {
  const current = { ...state.milestone };
  const race = process.env.MILESTONE_STUB_RACE_AFTER_GET;
  if (race) {
    state.milestone.description = race;
    state.race_observed = race;
    fs.writeFileSync(statePath, JSON.stringify(state));
  }
  exit(JSON.stringify(current), 0);
}
if (endpoint.endsWith('/milestones/7') && args.includes('PATCH')) {
  const updated = { ...state.milestone, ...fields() };
  state.milestone = updated;
  fs.writeFileSync(statePath, JSON.stringify(state));
  exit(JSON.stringify(updated), 0);
}
exit('unsupported endpoint', 8, 2);
