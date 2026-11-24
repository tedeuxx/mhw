// The engine of the delivery gates Action (#592, slice 6 of the CLI native baseline PRD, ADR-0046):
// actions/delivery-gates/action.yml runs this file with the node it sets up, from the Action's own
// checkout, so a project references `uses: tedeuxx/mhw/actions/delivery-gates@<ref>` and installs no mhw.
// `mhw policy check`, `mhw delivery-gate` and `mhw docs-baseline check` left the CLI with this slice; their
// code is unchanged and answers here.
//
//     node src/action/gates.js policy check [--project=DIR | --file=PATH]
//     node src/action/gates.js delivery-gate <gate> ...      (src/commands/delivery-gate.js)
//     node src/action/gates.js docs-baseline check ...       (src/commands/docs-baseline.js)
//     node src/action/gates.js --action                      the Action's step: the inputs from MHW_INPUT_*
//
// The first three take the arguments the three commands took, word for word, and keep their exit
// contract (exit 0 pass, 1 block, 2 usage or cannot decide): the golden transcripts of S28 and S29 run
// against this file (test/project-policy/*-golden.test.js). `--action` builds those argument lists from
// the Action's inputs (plan() below), runs each in a child process of this file, forwards its output,
// appends its `key=value` stdout lines to $GITHUB_OUTPUT where the gate prints outputs, and stops at the
// first exit other than 0, which it returns. The `contract` gate is two runs: the validator
// (`policy check`), then the contract gate. node: modules only.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as policyMain } from '../commands/project-policy.js';
import { main as deliveryGateMain } from '../commands/delivery-gate.js';
import { checkMain as docsBaselineMain } from '../commands/docs-baseline.js';

const SELF = fileURLToPath(import.meta.url);

/** @type {Record<string, (argv: string[], env: Record<string, string | undefined>) => number>} */
export const COMMANDS = {
  policy: (argv, env) => policyMain(argv, env),
  'delivery-gate': (argv, env) => deliveryGateMain(argv, env),
  'docs-baseline': docsBaselineMain,
};

/** The gates the Action's `gate` input accepts, in the order a delivery runs them. */
export const GATES = ['contract', 'container', 'installed-stg', 'classify', 'environment', 'recovery-plan',
  'prod-validation', 'docs-baseline'];

/** The gates whose stdout carries `key=value` lines for $GITHUB_OUTPUT. */
export const OUTPUT_GATES = new Set(['classify', 'recovery-plan']);

export const USAGE = 'usage: node src/action/gates.js policy check ... | delivery-gate <gate> ... | docs-baseline check ... | --action';

/**
 * One of the three commands, by its old CLI word.
 * @param {string[]} argv @param {Record<string, string | undefined>} env @returns {number}
 */
export function dispatch(argv, env) {
  if (argv.length && Object.hasOwn(COMMANDS, argv[0])) return COMMANDS[argv[0]](argv.slice(1), env);
  fs.writeSync(2, USAGE + '\n');
  return 2;
}

/**
 * The Action's inputs, read from MHW_INPUT_<NAME> (upper case, `-` as `_`); an absent one is ''.
 * @param {Record<string, string | undefined>} env @returns {(name: string) => string}
 */
export function inputs(env) {
  return (name) => env['MHW_INPUT_' + name.toUpperCase().replaceAll('-', '_')] ?? '';
}

/**
 * The argument lists one gate runs, or an error. A flag a gate requires is always passed, empty when
 * its input is empty, so the gate itself refuses it in its own words; an optional one only when set.
 * @param {(name: string) => string} input
 * @returns {{ runs: string[][] } | { error: string }}
 */
export function plan(input) {
  const gate = input('gate');
  const project = '--project=' + (input('project-dir') || '.');
  /** @param {string[]} names */
  const flags = (...names) => names.map((n) => '--' + n + '=' + input(n));
  switch (gate) {
    case 'contract': {
      const repository = input('repository');
      return { runs: [
        ['policy', 'check', project],
        ['delivery-gate', 'contract', project, ...(repository ? ['--repository=' + repository] : [])],
      ] };
    }
    case 'container':
      return { runs: [['delivery-gate', 'container', project,
        ...flags('evidence', 'revision', 'checkout-head', 'container-image'),
        ...(input('no-container-check') === 'true' ? ['--no-container-check'] : [])]] };
    case 'installed-stg':
    case 'prod-validation':
      return { runs: [['delivery-gate', gate, project, ...flags('evidence', 'revision', 'checkout-head')]] };
    case 'classify':
      return { runs: [['delivery-gate', 'classify', project, ...flags('rules')]] };
    case 'environment':
      return { runs: [['delivery-gate', 'environment', ...flags('name', 'protection')]] };
    case 'recovery-plan':
      return { runs: [['delivery-gate', 'recovery-plan', project, ...flags('revision', 'prod-revision')]] };
    case 'docs-baseline': {
      /** @type {string[]} */
      const optional = [];
      for (const n of ['head', 'body-file', 'manifest']) if (input(n)) optional.push('--' + n + '=' + input(n));
      return { runs: [['docs-baseline', 'check', ...flags('base'), ...optional, project]] };
    }
    default:
      return { error: 'unknown gate ' + JSON.stringify(gate) + ' (' + GATES.join(', ') + ')' };
  }
}

/**
 * The `key=value` lines of a gate's stdout, for $GITHUB_OUTPUT.
 * @param {string} stdout @returns {string[]}
 */
export function outputLines(stdout) {
  return stdout.split('\n').filter((l) => /^[a-z_]+=[^\n]*$/.test(l));
}

/**
 * The Action's step.
 * @param {Record<string, string | undefined>} env
 * @param {{ out: (s: string) => void, err: (s: string) => void, cwd: string }} io
 * @returns {number}
 */
export function runAction(env, io) {
  const input = inputs(env);
  const p = plan(input);
  if ('error' in p) {
    io.err('BLOCK  delivery gates action: ' + p.error + '\n');
    return 2;
  }
  const outputs = OUTPUT_GATES.has(input('gate')) ? env.GITHUB_OUTPUT : undefined;
  for (const argv of p.runs) {
    const code = runOne(argv, env, io, outputs);
    if (code !== 0) return code;
  }
  return 0;
}

/**
 * One gate run in a child process of this file: its output forwarded, its `key=value` lines appended
 * to `outputs` when it passes. Its exit code; 2 when it ended on a signal.
 * @param {string[]} argv @param {Record<string, string | undefined>} env
 * @param {{ out: (s: string) => void, err: (s: string) => void, cwd: string }} io
 * @param {string | undefined} outputs @returns {number}
 */
export function runOne(argv, env, io, outputs) {
  const r = spawnSync(process.execPath, [SELF, ...argv], { cwd: io.cwd, env, encoding: 'utf8' });
  const stdout = r.stdout || '';
  if (stdout) io.out(stdout);
  if (r.stderr) io.err(r.stderr);
  if (r.status !== 0) return r.status === null ? 2 : r.status;
  if (outputs) writeOutputs(outputs, stdout);
  return 0;
}

/**
 * Append a passing gate's `key=value` lines, and nothing else it printed, to the output file.
 * @param {string} outputs @param {string} stdout
 */
export function writeOutputs(outputs, stdout) {
  const lines = outputLines(stdout);
  if (lines.length) fs.appendFileSync(outputs, lines.join('\n') + '\n');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  const argv = process.argv.slice(2);
  process.exitCode = argv[0] === '--action'
    ? runAction(process.env, { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), cwd: process.cwd() })
    : dispatch(argv, process.env);
}
