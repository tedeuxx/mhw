// mhw delivery-gate <gate> ... (#499, S29 of #470): the evidence gates of the reference CI/CD (ADR-0015
// lock 4 of 5, Issue #246) and the recovery reference (lock 5 of 5, Issue #247), the Node form of
// global/project-policy/delivery_gate.py, which this slice deletes.
//
//     mhw delivery-gate contract    --project=DIR [--repository=OWNER/NAME]
//     mhw delivery-gate container   --project=DIR --evidence=FILE --revision=SHA --checkout-head=SHA
//                                   --container-image=IMAGE [--no-container-check]
//     mhw delivery-gate installed-stg --project=DIR --evidence=FILE --revision=SHA --checkout-head=SHA
//     mhw delivery-gate classify    --project=DIR --rules=I[,J...]
//     mhw delivery-gate environment --name=ENV --protection=FILE
//     mhw delivery-gate recovery-plan --project=DIR --revision=SHA --prod-revision=SHA|none
//     mhw delivery-gate prod-validation --project=DIR --evidence=FILE --revision=SHA --checkout-head=SHA
//
// `recovery-plan` runs before the PROD deployment and prints `mode=`, `rollback_target=` and, for manual
// recovery, `runbook=`, `recovery_time_objective_minutes=` and `operator=` lines for $GITHUB_OUTPUT;
// `prod-validation` runs after it, and any exit other than 0 is the caller's signal to recover.
//
// `mhw policy check` (lock 3) validates the contract a project declares and reads no evidence. This
// command is what reads evidence: it applies a valid contract to one revision's results. Every gate
// re-validates the contract first, with that validator (check() of src/commands/project-policy.js, in
// this process: no other program runs, so nothing on PATH and no environment variable can stand in for
// it), so a gate never runs on a broken one. A validator that throws, answers an exit other than 0, 1 or
// 2, answers nothing, or answers 0 without its OK line, cannot decide: exit 2.
//
//     exit 0  the gate passes; `classify` also prints `class=` and `approval=` lines for $GITHUB_OUTPUT
//     exit 1  the gate blocks, one `BLOCK  <gate>: <reason>` line per reason on standard error
//     exit 2  a usage error, or it cannot decide; it never answers "pass" when it cannot check
//
// Fail closed throughout: a missing field, an unknown key, a result other than the literal `pass`, a
// severity outside the scale and an unreadable file all block. The gates check that evidence is complete,
// bound to the exact revision and inside the contract's floor. They cannot check that the project's own
// test command told the truth; see docs/reference-cicd.md, "What it does not cover".
//
// Parity with the original (test/project-policy/delivery-gate-golden.test.js, test/golden/S29/): JSON
// is read with the validator's strict parser (a repeated key and NaN refused, CPython's messages), a
// string is stripped and split into lines as Python does (src/lib/py.js, src/lib/py-text.js), and every
// message is the original's except the declared differences. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import {
  check as policyCheckFile, strictLoads, pyDumps, pyFloatRepr, codepointCompare, pathlibJoin, decodeUtf8,
  strerror, Refusal, JSONDecodeError, PyRecursionError, PyValueError, FILE_NAME, SCHEMA,
} from './project-policy.js';
import { pyStrip, isPyWs } from '../lib/py.js';
import { splitLines, utf8ErrorText } from '../lib/py-text.js';

/** @typedef {import('./project-policy.js').Json} Json */
/** @typedef {Map<string, Json>} Obj */

const SHA = /^[0-9a-f]{40}$/;
const IMAGE = /^[^@\s]+@sha256:[0-9a-f]{64}$/;
const BUG_ISSUE = /^(?:#[0-9]+|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[0-9]+)$/;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const DOCKERENV = '/.dockerenv';

const CONTAINER_KEYS = new Set(['layer', 'revision', 'container_image', 'test_layers', 'coverage',
  'critical_user_journeys', 'risk_scenarios', 'security_controls', 'findings']);
const INSTALLED_KEYS = new Set(['layer', 'revision', 'stg_deployed_revision', 'test_layers',
  'critical_user_journeys', 'risk_scenarios', 'security_controls', 'findings']);
const FINDING_KEYS = new Set(['id', 'severity', 'bug_issue']);
const PROD_KEYS = new Set(['layer', 'revision', 'prod_deployed_revision', 'critical_user_journeys', 'risk_scenarios']);

// One test record in a manual-recovery runbook, a whole line (see reference/runbook-template.md). [0-9],
// ASCII digits, as the original's; anchored at both ends, the original's fullmatch.
const TESTED = /^(?:[-*] )?Tested: ([0-9]{4}-[0-9]{2}-[0-9]{2}); recovered in ([0-9]{1,6}) minutes?; by (@[A-Za-z0-9-]+)$/;

/** The refusal of an argument holding U+FFFD, which is what a byte that is not UTF-8 decodes to. */
export const NOT_UTF8 = 'an argument is not valid UTF-8 (or holds U+FFFD), so no gate decides on it';

/** A usage error, or an input the gate cannot decide on: exit 2. */
export class Usage extends Error {}

/**
 * @typedef {{ code: number, lines: string[] }} Answer
 * @typedef {(file: string, schema: string) => Answer} Checker
 * @typedef {{ check?: Checker, schema?: string, dockerenv?: string, platform?: string,
 *             inside?: (project: string, relative: string) => string | null }} Opts
 */

// -- Python's strings -------------------------------------------------------------------------------

/** Python's str.lstrip(char): the leading run of one character removed. @param {string} s @param {string} ch */
function lstrip(s, ch) {
  let a = 0;
  while (a < s.length && s[a] === ch) a++;
  return s.slice(a);
}

/** re.sub(r"~~.*?~~", "", line) for a line with no \n. @param {string} line */
function unstrike(line) {
  let out = '';
  let rest = line;
  for (;;) {
    const open = rest.indexOf('~~');
    const close = open < 0 ? -1 : rest.indexOf('~~', open + 2);
    if (close < 0) return out + rest;
    out += rest.slice(0, open);
    rest = rest.slice(close + 2);
  }
}

/** Python's "%s" of a contract value. @param {Json | undefined} v */
function pyStr(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return pyFloatRepr(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v === null || v === undefined) return 'None';
  return pyDumps(v);
}

/** json.dumps of a value read with .get(): an absent key is None. @param {Json | undefined} v */
const dumps = (v) => pyDumps(v === undefined ? null : v);

/** Python's truthiness of a JSON value. @param {Json | undefined} v */
function truthy(v) {
  if (v === undefined || v === null || v === false || v === '' || v === 0 || v === 0n) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  return true;
}

/** @param {Json | undefined} v @returns {v is Obj} */
const isObj = (v) => v instanceof Map;
/** Sorted, Python's str order. @param {Iterable<string>} xs */
const sorted = (xs) => [...xs].sort(codepointCompare);

/**
 * A value of the contract, which the validator has passed, so every path exists.
 * @param {Json} doc @param {...string} keys @returns {any}
 */
function at(doc, ...keys) {
  /** @type {Json | undefined} */
  let v = doc;
  for (const k of keys) v = /** @type {Obj} */ (v).get(k);
  return v;
}

// -- the contract ---------------------------------------------------------------------------------

/**
 * The validator, in this process, held to its own three answers: anything else is 2, it cannot decide.
 * @param {string} file @param {Opts} [opts] @returns {Answer}
 */
export function policyCheck(file, opts = {}) {
  const checker = opts.check || policyCheckFile;
  /** @type {Answer} */
  let r;
  try {
    r = checker(file, opts.schema || SCHEMA);
  } catch (e) {
    return { code: 2, lines: ['ERROR  mhw policy check could not run: ' + (e instanceof Error ? e.name : 'Error')] };
  }
  const lines = r && Array.isArray(r.lines) ? r.lines : [];
  const code = r ? r.code : undefined;
  if (![0, 1, 2].includes(/** @type {number} */ (code)) || !lines.length) {
    return { code: 2, lines: ['ERROR  mhw policy check gave no answer (exit ' + String(code) + ')', ...lines] };
  }
  if (code === 0 && !lines[0].startsWith('OK  ')) {
    return { code: 2, lines: ['ERROR  mhw policy check exited 0 without its OK line', ...lines] };
  }
  return { code: /** @type {number} */ (code), lines };
}

/**
 * The parsed file with the validator's strictness (no repeated key, no NaN), or Refusal.
 * @param {string} p @returns {Json}
 */
function strictRead(p) {
  let raw;
  try {
    raw = fs.readFileSync(p);
  } catch (e) {
    throw new Refusal('unreadable or malformed: ' + strerror(e));
  }
  const bad = utf8ErrorText(raw);
  if (bad !== null) throw new Refusal('unreadable or malformed: ' + bad);
  try {
    return strictLoads(decodeUtf8(raw));
  } catch (e) {
    if (e instanceof Refusal) throw new Refusal('malformed: ' + e.message);
    if (e instanceof JSONDecodeError || e instanceof PyRecursionError || e instanceof PyValueError) {
      throw new Refusal('unreadable or malformed: ' + e.message);
    }
    throw e;
  }
}

/**
 * [contract, blocks]. The contract is valid only when blocks is empty.
 * @param {string} project @param {Opts} opts @returns {[Json | null, string[]]}
 */
export function loadContract(project, opts = {}) {
  const file = pathlibJoin(project, FILE_NAME, opts.platform || process.platform);
  const { code, lines } = policyCheck(file, opts);
  if (code === 2) throw new Usage('the validator cannot decide on ' + file + ': ' + lines.join('; '));
  if (code !== 0) return [null, lines.map((l) => 'contract: ' + l)];
  // The gates read the contract with the validator's strictness, never a looser second parse.
  try {
    return [strictRead(file), []];
  } catch (e) {
    if (e instanceof Refusal) return [null, ['contract: FAIL  ' + e.message]];
    throw e;
  }
}

/**
 * True when the record's first status line, with struck text and emphasis removed, reads exactly
 * `accepted` (one final period allowed). `accepted later` or `accepted, then superseded` do not.
 * @param {string} text
 */
export function madrStatusAccepted(text) {
  for (const line of splitLines(text)) {
    const plain = pyStrip(lstrip(pyStrip(unstrike(line).replaceAll('*', '')), '-'));
    // re.match(r"(?i)status\s*:\s*(.*)"): "status" in any case (with u, ſ is an s, as in Python's re).
    if (!/^status/iu.test(plain)) continue;
    let k = 'status'.length;
    while (k < plain.length && isPyWs(plain[k])) k++;
    if (plain[k] !== ':') continue;
    let value = pyStrip(plain.slice(k + 1)).toLowerCase();
    if (value.endsWith('.')) value = value.slice(0, -1);
    return pyStrip(value) === 'accepted';
  }
  return false;
}

/**
 * The text of the file relative names under project, decoded as UTF-8, or null when it is missing,
 * outside the project or undecodable (Python's open(..., encoding="utf-8").read()).
 * @param {string} project @param {string} relative @param {Opts} opts
 */
function readInside(project, relative, opts) {
  const file = (opts.inside || inside)(project, relative);
  if (file === null) return null;
  try {
    // Universal newlines: \r\n and \r read as \n.
    return decodeUtf8(fs.readFileSync(file)).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  } catch {
    return null;
  }
}

/**
 * The contract is valid, governs this repository, and its MADR and runbook exist.
 * @param {string} project @param {string | undefined} repository @param {Opts} [opts]
 */
export function gateContract(project, repository, opts = {}) {
  const [contract, blocks] = loadContract(project, opts);
  if (blocks.length) return blocks;
  const c = /** @type {Json} */ (contract);
  if (repository !== undefined && at(c, 'project') !== repository) {
    blocks.push('contract: it governs ' + pyStr(at(c, 'project')) + ', this run is in ' + repository);
  }
  const madr = at(c, 'madr', 'path');
  const text = readInside(project, madr, opts);
  if (text === null) {
    blocks.push('contract: the project MADR ' + madr + ' is missing, unreadable or outside the project');
  } else if (!madrStatusAccepted(text)) {
    blocks.push('contract: the project MADR ' + madr + ' has no status line reading accepted');
  }
  const recovery = at(c, 'recovery');
  if (at(recovery, 'mode') === 'manual' && (opts.inside || inside)(project, at(recovery, 'runbook', 'path')) === null) {
    blocks.push('contract: the recovery runbook ' + at(recovery, 'runbook', 'path') + ' is missing or outside the project');
  }
  return blocks;
}

/** os.path.realpath, which does not fail on a missing path. @param {string} p */
function realpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The real path of the file relative names under project, or null when it is missing or leaves it.
 *
 * The path is rebuilt from directory listings, one component at a time, so the file opened is one the
 * listing returned, never a string from the contract. The schema already refuses `..` and a leading `/`;
 * the last check also refuses a symbolic link that leaves the project, so a contract cannot make the gate
 * read another file and call it the project's MADR.
 * @param {string} project @param {string} relative
 */
export function inside(project, relative) {
  const root = realpath(project);
  let current = root;
  for (const part of relative.replaceAll('\\', '/').split('/')) {
    let names;
    try {
      names = fs.readdirSync(current);
    } catch {
      return null;
    }
    const match = names.find((name) => name === part);
    if (match === undefined) return null;
    current = path.join(current, match);
  }
  let target;
  try {
    target = fs.realpathSync.native(current);
  } catch {
    return null;
  }
  const under = target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  if (!under || path.parse(target).root !== path.parse(root).root) return null;
  try {
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

// -- evidence -------------------------------------------------------------------------------------

/**
 * [doc, blocks]: the evidence file as a JSON object, or why it is not one.
 * @param {string} p @returns {[Obj | null, string[]]}
 */
export function readEvidence(p) {
  let raw;
  try {
    raw = fs.readFileSync(p);
  } catch (e) {
    return [null, ['evidence: ' + p + ' is missing or unreadable (' + strerror(e) + ')']];
  }
  const bad = utf8ErrorText(raw);
  if (bad !== null) return [null, ['evidence: ' + p + ' is malformed (' + bad + ')']];
  let doc;
  try {
    doc = strictLoads(decodeUtf8(raw));
  } catch (e) {
    if (e instanceof Refusal || e instanceof JSONDecodeError || e instanceof PyRecursionError || e instanceof PyValueError) {
      return [null, ['evidence: ' + p + ' is malformed (' + e.message + ')']];
    }
    throw e;
  }
  if (!isObj(doc)) return [null, ['evidence: ' + p + ' is not a JSON object']];
  return [doc, []];
}

/**
 * Each required id is reported, and every reported result is the literal `pass`.
 * @param {string} gate @param {Obj} doc @param {string} key @param {string[]} required
 * @param {string[]} blocks @param {boolean} [requireAll]
 */
function results(gate, doc, key, required, blocks, requireAll = true) {
  const value = doc.get(key);
  if (!isObj(value)) {
    blocks.push(gate + ': ' + key + ' missing (an object of id -> result)');
    return;
  }
  for (const name of requireAll ? required : []) {
    if (!value.has(name)) blocks.push(gate + ': ' + key + ' ' + name + ' has no result (missing mandatory evidence)');
  }
  for (const name of sorted(value.keys())) {
    const result = value.get(name);
    if (requireAll && !required.includes(name)) blocks.push(gate + ': ' + key + ' ' + name + ' is not in the contract');
    else if (result === 'inconclusive') blocks.push(gate + ': ' + key + ' ' + name + ' is inconclusive (inconclusive evidence blocks)');
    else if (result !== 'pass') blocks.push(gate + ': ' + key + ' ' + name + ' is ' + dumps(result) + ', not pass');
  }
}

/** @param {string} gate @param {Obj} doc @param {Json} contract @param {string[]} blocks */
function findings(gate, doc, contract, blocks) {
  const list = doc.get('findings');
  if (!Array.isArray(list)) {
    blocks.push(gate + ': findings missing (a list, empty when there are none)');
    return;
  }
  /** @type {string[]} */
  const tolerated = at(contract, 'severity', 'tolerated');
  list.forEach((finding, index) => {
    const where = gate + ': finding ' + index;
    if (!isObj(finding)) {
      blocks.push(where + ' is not an object');
      return;
    }
    const unknown = sorted([...finding.keys()].filter((k) => !FINDING_KEYS.has(k)));
    if (unknown.length) blocks.push(where + ' carries unknown key(s) ' + unknown.join(', '));
    const severity = finding.get('severity');
    const issue = finding.get('bug_issue');
    if (severity === undefined || severity === null) {
      blocks.push(where + ' has no severity (unclassified findings block)');
    } else if (typeof severity !== 'string' || !SEVERITIES.includes(severity)) {
      blocks.push(where + ' severity ' + pyDumps(severity) + ' is not on the scale (unknown severity)');
    } else if (!tolerated.includes(severity)) {
      blocks.push(where + ' is ' + severity + ', which the contract does not tolerate');
    } else if (!(typeof issue === 'string' && BUG_ISSUE.test(issue))) {
      blocks.push(where + ' is a tolerated low finding without a bug Issue');
    }
  });
}

/**
 * @param {string} gate @param {Obj} doc @param {string} revision @param {string} checkoutHead
 * @param {string[]} blocks
 */
function binding(gate, doc, revision, checkoutHead, blocks) {
  if (!SHA.test(revision || '')) throw new Usage('--revision must be a full 40-character commit SHA');
  if (checkoutHead !== revision) blocks.push(gate + ': the checkout is at ' + checkoutHead + ', not the revision ' + revision);
  if (doc.get('revision') !== revision) {
    blocks.push(gate + ': the evidence names revision ' + dumps(doc.get('revision')) + ', not ' + revision);
  }
}

/** The contract's ids of a scenario list. @param {Json} contract @param {string} key @returns {string[]} */
const ids = (contract, key) => at(contract, 'mandatory_scenarios', key).map((/** @type {Obj} */ s) => s.get('id'));

/**
 * @param {string} gate @param {Obj} doc @param {Json} contract @param {Set<string>} keys
 * @param {string} layer @param {string[]} blocks
 */
function common(gate, doc, contract, keys, layer, blocks) {
  const unknown = sorted([...doc.keys()].filter((k) => !keys.has(k)));
  if (unknown.length) blocks.push(gate + ': evidence carries unknown key(s) ' + unknown.join(', '));
  if (doc.get('layer') !== layer) blocks.push(gate + ': evidence layer is ' + dumps(doc.get('layer')) + ', not ' + layer);
  const layers = doc.get('test_layers');
  if (!isObj(layers) || !layers.size) {
    blocks.push(gate + ': test_layers missing or empty (every applicable layer reports)');
  } else {
    results(gate, doc, 'test_layers', [], blocks, false);
  }
  results(gate, doc, 'critical_user_journeys', ids(contract, 'critical_user_journeys'), blocks);
  results(gate, doc, 'risk_scenarios', ids(contract, 'risk_scenarios'), blocks);
  findings(gate, doc, contract, blocks);
}

/** A number of the evidence (bool is not one, as in Python). @param {Json | undefined} v @returns {v is number | bigint} */
const isNumber = (v) => typeof v === 'number' || typeof v === 'bigint';

/**
 * Containerised evidence for the exact revision, before STG and before PROD. The in-container check is
 * on unless the caller turns it off; only the suites do, to exercise the other branches on a host. The
 * reference workflow never passes --no-container-check.
 * @param {string} project @param {string} evidence @param {string} revision @param {string} checkoutHead
 * @param {string} image @param {boolean} [requireContainer] @param {Opts} [opts]
 */
export function gateContainer(project, evidence, revision, checkoutHead, image, requireContainer = true, opts = {}) {
  const gate = 'container';
  const [contract, cblocks] = loadContract(project, opts);
  if (cblocks.length) return cblocks;
  const [doc, blocks] = readEvidence(evidence);
  if (blocks.length) return blocks;
  const d = /** @type {Obj} */ (doc);
  const c = /** @type {Json} */ (contract);
  if (!IMAGE.test(image || '')) blocks.push(gate + ': image ' + image + ' is not pinned by digest (name@sha256:<64 hex>)');
  if (requireContainer && !fs.existsSync(opts.dockerenv || DOCKERENV)) blocks.push(gate + ': this step is not running in a container');
  if (d.get('container_image') !== image) {
    blocks.push(gate + ': the evidence names image ' + dumps(d.get('container_image')) + ', not ' + image);
  }
  binding(gate, d, revision, checkoutHead, blocks);
  common(gate, d, c, CONTAINER_KEYS, 'container', blocks);
  const coverage = d.get('coverage');
  const wanted = at(c, 'coverage');
  const keys = isObj(coverage) ? sorted(coverage.keys()) : [];
  if (!isObj(coverage) || keys.join('\u0000') !== 'metric\u0000percent') {
    blocks.push(gate + ': coverage missing (an object with metric and percent only)');
  } else {
    const metric = coverage.get('metric');
    const percent = coverage.get('percent');
    const threshold = wanted.get('threshold_percent');
    if (metric !== wanted.get('metric')) {
      blocks.push(gate + ': coverage is ' + dumps(metric) + ', the contract counts ' + pyStr(wanted.get('metric')));
    } else if (!isNumber(percent) || !(percent >= 0 && percent <= 100)) {
      // also refuses NaN and infinity
      blocks.push(gate + ': coverage ' + dumps(percent) + ' is not a percentage from 0 to 100');
    } else if (percent < threshold) {
      blocks.push(gate + ': coverage ' + dumps(percent) + ' is below the threshold ' + pyStr(threshold));
    }
  }
  // The full minimum: every control the contract names reports pass in the container.
  results(gate, d, 'security_controls', at(c, 'mandatory_scenarios', 'security_controls'), blocks);
  return blocks;
}

/**
 * The installed STG runs the exact revision, and its tests pass, before PROD.
 * @param {string} project @param {string} evidence @param {string} revision @param {string} checkoutHead
 * @param {Opts} [opts]
 */
export function gateInstalled(project, evidence, revision, checkoutHead, opts = {}) {
  const gate = 'installed-stg';
  const [contract, cblocks] = loadContract(project, opts);
  if (cblocks.length) return cblocks;
  const [doc, blocks] = readEvidence(evidence);
  if (blocks.length) return blocks;
  const d = /** @type {Obj} */ (doc);
  const c = /** @type {Json} */ (contract);
  binding(gate, d, revision, checkoutHead, blocks);
  const deployed = d.get('stg_deployed_revision');
  if (deployed !== revision) {
    blocks.push(gate + ': STG reports it runs ' + dumps(deployed) + ', not ' + revision + ' (an unreadable revision blocks too)');
  }
  common(gate, d, c, INSTALLED_KEYS, 'installed-stg', blocks);
  // Not every control applies to an installed environment, so only the reported ones are read; at least
  // one must be reported, and each reported one must pass.
  const controls = d.get('security_controls');
  /** @type {string[]} */
  const named = at(c, 'mandatory_scenarios', 'security_controls');
  if (!isObj(controls) || !controls.size) {
    blocks.push(gate + ': security_controls missing or empty (installed security validation)');
  } else {
    results(gate, d, 'security_controls', named, blocks, false);
    for (const name of sorted([...controls.keys()].filter((k) => !named.includes(k)))) {
      blocks.push(gate + ': security_controls ' + name + ' is not in the contract');
    }
  }
  return blocks;
}

// -- authorisation --------------------------------------------------------------------------------

/**
 * [class, approval, blocks]. A change matching a high rule is high; matching none blocks.
 * @param {string} project @param {string} rules @param {Opts} [opts]
 * @returns {[string | null, string | null, string[]]}
 */
export function classify(project, rules, opts = {}) {
  const [contract, blocks] = loadContract(project, opts);
  if (blocks.length) return [null, null, blocks];
  const c = /** @type {Json} */ (contract);
  /** @type {Obj[]} */
  const model = at(c, 'risk_classification', 'rules');
  const picked = (rules || '').split(',').map((p) => pyStrip(p)).filter((p) => p);
  if (!picked.length) return [null, null, ['classify: no rule matched (an unclassified change blocks before approval)']];
  /** @type {Json[]} */
  const classes = [];
  for (const part of picked) {
    if (!/^[0-9]+$/.test(part) || BigInt(part) >= BigInt(model.length)) {
      blocks.push('classify: ' + pyDumps(part) + ' is not a rule index of the contract (0 to ' + (model.length - 1) + ')');
    } else {
      classes.push(/** @type {Json} */ (model[Number(part)].get('class')));
    }
  }
  if (blocks.length) return [null, null, blocks];
  // Conservative conflict rule: a change that matches any high rule is high.
  const risk = classes.includes('high') ? 'high' : 'low';
  const approval = at(c, 'approval', risk === 'high' ? 'high_risk' : 'low_risk');
  return [risk, pyStr(approval), []];
}

/**
 * The environment the owner approves in exists and requires a reviewer before a job runs.
 * @param {string} name @param {string} protection
 */
export function gateEnvironment(name, protection) {
  const gate = 'environment';
  const [doc, blocks] = readEvidence(protection);
  if (blocks.length) return blocks.map((b) => b.replace('evidence:', gate + ':'));
  const d = /** @type {Obj} */ (doc);
  if (d.get('name') !== name) {
    return [gate + ': the protection read is for ' + dumps(d.get('name')) + ', not ' + name
      + ' (a missing environment is created unprotected when a job names it)'];
  }
  const rules = d.get('protection_rules');
  const reviewers = Array.isArray(rules)
    ? rules.filter((r) => isObj(r) && r.get('type') === 'required_reviewers' && truthy(r.get('reviewers')))
    : [];
  if (!reviewers.length) return [gate + ': ' + name + ' has no required reviewer, so nothing waits for the owner\'s approval'];
  return [];
}

// -- recovery (ADR-0015 lock 5 of 5, Issue #247) --------------------------------------------------

/**
 * [[date, minutes]] of the runbook's test records. Only a whole line in the record form counts: an
 * indented, struck (`~~...~~`) or annotated line does not, so nothing is read from a line that is not
 * exactly a record.
 * @param {string} text @returns {Array<[string, number]>}
 */
export function runbookRecords(text) {
  /** @type {Array<[string, number]>} */
  const records = [];
  for (const line of splitLines(text)) {
    const m = TESTED.exec(line);
    if (m) records.push([m[1], Number(m[2])]);
  }
  return records;
}

/**
 * [outputs, blocks]. Recovery is prepared before PROD exposure, or the deployment does not start.
 *
 * automatic-rollback: the version to return to is the one PROD runs now, a full SHA other than the
 * revision, or `none` before the first deployment (recovery is then to withdraw it). manual: the runbook
 * is a file in the project with a test record dated the contract's `last_tested`, every such record within
 * the recovery-time objective.
 * @param {string} project @param {string} revision @param {string} prodRevision @param {Opts} [opts]
 * @returns {[string[] | null, string[]]}
 */
export function recoveryPlan(project, revision, prodRevision, opts = {}) {
  const gate = 'recovery-plan';
  if (!SHA.test(revision || '')) throw new Usage('--revision must be a full 40-character commit SHA');
  const [contract, blocks] = loadContract(project, opts);
  if (blocks.length) return [null, blocks];
  const recovery = at(/** @type {Json} */ (contract), 'recovery');
  /** @type {string} */
  let target;
  if (prodRevision === 'none') {
    target = 'none';
  } else if (!SHA.test(prodRevision || '')) {
    blocks.push(gate + ': PROD reports it runs ' + dumps(prodRevision) + ', not a full commit SHA or none (an unreadable '
      + 'PROD revision blocks: there would be nothing known to return to)');
    target = 'None';
  } else if (prodRevision === revision) {
    blocks.push(gate + ': PROD already runs ' + revision + ', so there is no previous version to return to');
    target = 'None';
  } else {
    target = prodRevision;
  }
  const mode = recovery.get('mode');
  const outputs = ['mode=' + pyStr(mode), 'rollback_target=' + target];
  if (mode === 'manual') {
    const runbook = recovery.get('runbook');
    const rel = runbook.get('path');
    const lastTested = runbook.get('last_tested');
    const text = readInside(project, rel, opts);
    const rto = recovery.get('recovery_time_objective_minutes');
    if (text === null) {
      blocks.push(gate + ': the runbook ' + rel + ' is missing, unreadable or outside the project');
    } else {
      const dated = runbookRecords(text).filter(([date]) => date === lastTested).map(([, minutes]) => minutes);
      const worst = dated.length ? Math.max(...dated) : 0;
      if (!dated.length) {
        blocks.push(gate + ': the runbook ' + rel + ' has no test record dated ' + lastTested + ', the contract\'s '
          + 'last_tested (an untested runbook blocks)');
      } else if (worst > rto) {
        blocks.push(gate + ': the runbook\'s test on ' + lastTested + ' recovered in ' + worst + ' minutes, over the '
          + 'recovery-time objective of ' + pyStr(rto));
      }
    }
    outputs.push('runbook=' + rel, 'recovery_time_objective_minutes=' + pyStr(rto), 'operator=' + pyStr(recovery.get('operator')));
  }
  return [blocks.length ? null : outputs, blocks];
}

/**
 * PROD runs the exact revision and every critical validation passes; anything else recovers. A malformed
 * or missing evidence file blocks with exit 1, not 2: a PROD that cannot be validated is treated as a
 * failed validation, so the caller's recovery job runs.
 * @param {string} project @param {string} evidence @param {string} revision @param {string} checkoutHead
 * @param {Opts} [opts]
 */
export function gateProdValidation(project, evidence, revision, checkoutHead, opts = {}) {
  const gate = 'prod-validation';
  const [contract, cblocks] = loadContract(project, opts);
  if (cblocks.length) return cblocks;
  const [doc, blocks] = readEvidence(evidence);
  if (blocks.length) return blocks;
  const d = /** @type {Obj} */ (doc);
  const c = /** @type {Json} */ (contract);
  binding(gate, d, revision, checkoutHead, blocks);
  const unknown = sorted([...d.keys()].filter((k) => !PROD_KEYS.has(k)));
  if (unknown.length) blocks.push(gate + ': evidence carries unknown key(s) ' + unknown.join(', '));
  if (d.get('layer') !== 'prod') blocks.push(gate + ': evidence layer is ' + dumps(d.get('layer')) + ', not prod');
  const deployed = d.get('prod_deployed_revision');
  if (deployed !== revision) {
    blocks.push(gate + ': PROD reports it runs ' + dumps(deployed) + ', not ' + revision + ' (an unreadable revision blocks too)');
  }
  results(gate, d, 'critical_user_journeys', ids(c, 'critical_user_journeys'), blocks);
  results(gate, d, 'risk_scenarios', ids(c, 'risk_scenarios'), blocks);
  return blocks;
}

// -- the command line -----------------------------------------------------------------------------

/**
 * The --key=value arguments, by key without its dashes; flags as true.
 * @param {string[]} args @param {string[]} allowed @param {string[]} [flags]
 * @returns {Record<string, string | true>}
 */
function parse(args, allowed, flags = []) {
  /** @type {Record<string, string | true>} */
  const values = {};
  for (const arg of args) {
    if (flags.includes(arg)) {
      values[arg.slice(2)] = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? '' : arg.slice(eq + 1);
    if (eq < 0 || !allowed.includes(key) || !value || Object.hasOwn(values, key.slice(2))) {
      throw new Usage('unknown, empty or repeated argument ' + arg);
    }
    values[key.slice(2)] = value;
  }
  return values;
}

/** @param {Record<string, string | true>} v @param {string} gate @param {string[]} keys */
function need(v, gate, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(v, key)) throw new Usage(gate + ' needs --' + key);
  }
}

/** @param {Record<string, string | true>} v @param {string} k @returns {string} */
const str = (v, k) => /** @type {string} */ (v[k]);
/** @param {Record<string, string | true>} v */
const projectOf = (v) => (Object.hasOwn(v, 'project') ? str(v, 'project') : '.');

/**
 * One gate: [passed lines, blocks].
 * @param {string} command @param {string[]} args @param {Opts} opts @returns {[string[], string[]]}
 */
function run(command, args, opts) {
  if (command === 'contract') {
    const v = parse(args, ['--project', '--repository']);
    return [['OK  contract: valid, bound to this repository, MADR accepted'],
      gateContract(projectOf(v), Object.hasOwn(v, 'repository') ? str(v, 'repository') : undefined, opts)];
  }
  if (command === 'container') {
    const v = parse(args, ['--project', '--evidence', '--revision', '--checkout-head', '--container-image'], ['--no-container-check']);
    need(v, 'container', ['evidence', 'revision', 'checkout-head', 'container-image']);
    const blocks = gateContainer(projectOf(v), str(v, 'evidence'), str(v, 'revision'), str(v, 'checkout-head'),
      str(v, 'container-image'), !v['no-container-check'], opts);
    return [['OK  container: complete green evidence for ' + str(v, 'revision')], blocks];
  }
  if (command === 'installed-stg') {
    const v = parse(args, ['--project', '--evidence', '--revision', '--checkout-head']);
    need(v, 'installed-stg', ['evidence', 'revision', 'checkout-head']);
    const blocks = gateInstalled(projectOf(v), str(v, 'evidence'), str(v, 'revision'), str(v, 'checkout-head'), opts);
    return [['OK  installed-stg: STG runs ' + str(v, 'revision') + ' and its tests pass'], blocks];
  }
  if (command === 'classify') {
    // --rules may be empty on purpose: that is the unclassified case, and it blocks.
    const rules = args.filter((a) => a.startsWith('--rules='));
    const v = parse(args.filter((a) => !a.startsWith('--rules=')), ['--project']);
    if (rules.length !== 1) throw new Usage('classify needs exactly one --rules=I[,J...] (it may be empty)');
    const [risk, approval, blocks] = classify(projectOf(v), rules[0].slice('--rules='.length), opts);
    return [['class=' + risk, 'approval=' + approval], blocks];
  }
  if (command === 'environment') {
    const v = parse(args, ['--name', '--protection']);
    if (Object.keys(v).sort(codepointCompare).join(',') !== 'name,protection') throw new Usage('environment needs --name and --protection');
    return [['OK  environment: ' + str(v, 'name') + ' requires a reviewer'], gateEnvironment(str(v, 'name'), str(v, 'protection'))];
  }
  if (command === 'recovery-plan') {
    const v = parse(args, ['--project', '--revision', '--prod-revision']);
    need(v, 'recovery-plan', ['revision', 'prod-revision']);
    const [passed, blocks] = recoveryPlan(projectOf(v), str(v, 'revision'), str(v, 'prod-revision'), opts);
    return [passed || [], blocks];
  }
  if (command === 'prod-validation') {
    const v = parse(args, ['--project', '--evidence', '--revision', '--checkout-head']);
    need(v, 'prod-validation', ['evidence', 'revision', 'checkout-head']);
    const blocks = gateProdValidation(projectOf(v), str(v, 'evidence'), str(v, 'revision'), str(v, 'checkout-head'), opts);
    return [['OK  prod-validation: PROD runs ' + str(v, 'revision') + ' and its critical validations pass'], blocks];
  }
  throw new Usage('a gate: contract, container, installed-stg, classify, environment, recovery-plan or prod-validation');
}

/** @param {number} fd @param {string[]} lines */
function emit(fd, lines) {
  if (lines.length) fs.writeSync(fd, lines.join('\n') + '\n');
}

/**
 * `mhw delivery-gate <gate> ...`. The CLI calls this with what follows `delivery-gate`.
 * @param {string[]} argv @param {Record<string, string | undefined>} [_env] @param {Opts} [opts]
 * @returns {number}
 */
export function main(argv, _env = {}, opts = {}) {
  const [command = '', ...args] = argv;
  /** @type {[string[], string[]]} */
  let answer;
  try {
    // An argument that was not valid UTF-8 reaches Node with U+FFFD in place of its bytes, where Python kept
    // them as surrogates: one value could then name another file or equal another name, and a gate could
    // pass where the original blocked. No such argument is decided on (#499, QA B3).
    if (argv.some((a) => a.includes('\uFFFD'))) throw new Usage(NOT_UTF8);
    answer = run(command, args, opts);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    emit(2, ['mhw delivery-gate: ' + e.message]);
    return 2;
  }
  const [passed, blocks] = answer;
  if (blocks.length) {
    emit(2, blocks.map((b) => 'BLOCK  ' + b));
    return 1;
  }
  emit(1, passed);
  return 0;
}
