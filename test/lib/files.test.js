// fsx (atomic write, backup beside write), JSON and TOML read and write, in a throwaway directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomic, backupBeside, writeWithBackup, BACKUP_SUFFIX } from '../../src/lib/fsx.js';
import { readJson, writeJson, stringifyJson } from '../../src/lib/json.js';
import { readToml, writeToml, parseToml, stringifyToml } from '../../src/lib/toml.js';

const POSIX = process.platform !== 'win32';

/** @param {(dir: string) => void} fn */
function inTemp(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-files-')));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} p */
const mode = (p) => fs.lstatSync(p).mode & 0o777;

test('writeFileAtomic writes the bytes, creates the directory and leaves no temporary file', () => inTemp((dir) => {
  const f = path.join(dir, 'a', 'b', 'config');
  writeFileAtomic(f, 'one\n');
  writeFileAtomic(f, 'two\n', { mode: 0o600 });
  assert.equal(fs.readFileSync(f, 'utf8'), 'two\n');
  if (POSIX) assert.equal(mode(f), 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['config']);
}));

test('writeFileAtomic replaces a symbolic link at the path, never writes through it', { skip: !POSIX && 'symlinks' }, () => inTemp((dir) => {
  const victim = path.join(dir, 'victim');
  fs.writeFileSync(victim, 'keep\n');
  const f = path.join(dir, 'config');
  fs.symlinkSync(victim, f);
  writeFileAtomic(f, 'new\n');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep\n');
  assert.equal(fs.lstatSync(f).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(f, 'utf8'), 'new\n');
}));

test('backupBeside keeps an owner-only copy of a regular file, and nothing for a missing one or a link', () => inTemp((dir) => {
  const f = path.join(dir, 'settings.json');
  assert.equal(backupBeside(f), null);
  fs.writeFileSync(f, '{"mine": true}\n');
  if (POSIX) fs.chmodSync(f, 0o644);
  const b = backupBeside(f);
  assert.equal(b, f + BACKUP_SUFFIX);
  assert.equal(fs.readFileSync(/** @type {string} */ (b), 'utf8'), '{"mine": true}\n');
  if (POSIX) assert.equal(mode(/** @type {string} */ (b)), 0o600);
  if (POSIX) {
    const l = path.join(dir, 'linked.json');
    fs.symlinkSync(f, l);
    assert.equal(backupBeside(l), null);
  }
}));

test('writeWithBackup backs up the previous file and writes the new one; backup:false keeps none', () => inTemp((dir) => {
  const f = path.join(dir, 'c.json');
  assert.deepEqual(writeWithBackup(f, 'v1\n'), { backup: null });
  assert.deepEqual(writeWithBackup(f, 'v2\n'), { backup: f + BACKUP_SUFFIX });
  assert.equal(fs.readFileSync(f + BACKUP_SUFFIX, 'utf8'), 'v1\n');
  assert.equal(fs.readFileSync(f, 'utf8'), 'v2\n');
  const g = path.join(dir, 'd.json');
  writeWithBackup(g, 'v1\n', { backup: false });
  writeWithBackup(g, 'v2\n', { backup: false });
  assert.equal(fs.existsSync(g + BACKUP_SUFFIX), false);
}));

test('JSON: a missing file reads as the fallback, a malformed one throws with its path, writes round-trip', () => inTemp((dir) => {
  const f = path.join(dir, 's.json');
  assert.equal(readJson(f), null);
  assert.deepEqual(readJson(f, {}), {});
  fs.writeFileSync(f, '{"a": ');
  assert.throws(() => readJson(f), (e) => e instanceof Error && e.message.startsWith(f + ': not valid JSON'));
  const value = { permissions: { deny: ['Bash(git push --force:*)'] }, n: 1, unicode: 'ação' };
  writeJson(f, value);
  assert.deepEqual(readJson(f), value);
  assert.equal(fs.readFileSync(f, 'utf8'), stringifyJson(value));
  assert.ok(stringifyJson(value).startsWith('{\n  "permissions"') && stringifyJson(value).endsWith('}\n'));
  assert.equal(fs.readFileSync(f + BACKUP_SUFFIX, 'utf8'), '{"a": ', 'the malformed file was kept as the backup');
}));

test('TOML: the shapes the Codex config carries parse and round-trip (pure-JS library)', () => inTemp((dir) => {
  const text = [
    'model = "example-model"',
    'model_reasoning_effort = "medium"',
    '',
    '[mcp_servers.example]',
    'command = "/usr/bin/true"',
    'args = ["--flag", "value with spaces"]',
    'env = { EXAMPLE = "1" }',
    '',
    '[[hooks.UserPromptSubmit]]',
    'command = ["/bin/sh", "-c", "exit 0"]',
    'timeout = 5',
    '',
  ].join('\n');
  const v = parseToml(text);
  assert.equal(v.model, 'example-model');
  assert.deepEqual(v.mcp_servers.example.args, ['--flag', 'value with spaces']);
  assert.equal(v.hooks.UserPromptSubmit[0].timeout, 5);
  const f = path.join(dir, 'config.toml');
  assert.equal(readToml(f), null);
  writeToml(f, v);
  assert.deepEqual(readToml(f), v);
  assert.ok(stringifyToml(v).endsWith('\n'));
  fs.writeFileSync(f, 'model = \n');
  assert.throws(() => readToml(f), (e) => e instanceof Error && e.message.startsWith(f + ': not valid TOML'));
}));
