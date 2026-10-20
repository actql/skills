import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../skills/actql/scripts/detect-environment.sh', import.meta.url));
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t, {name = 'project', cli = 'ActQL 0.1'} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'actql-skill-environment-')));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bin = join(root, 'bin'), cwd = join(root, name);
  mkdirSync(bin); mkdirSync(cwd);
  for (const [command, version] of Object.entries({
    node: 'v22.22.0', npm: '10.0.0', python3: 'Python 3.11.0', uv: 'uv 0.1.0',
    ...(cli === null ? {} : {actql: cli}),
  })) {
    writeFileSync(join(bin, command), '#!/bin/sh\nprintf \'%s\\n\' ' + shellQuote(version) + '\n', {mode: 0o755});
  }
  return {cwd, detect: () => JSON.parse(execFileSync('/bin/bash', [script], {
    cwd, encoding: 'utf8', timeout: 10000,
    env: {PATH: bin + ':/usr/bin:/bin', HOME: root, LANG: 'en_US.UTF-8'},
  }))};
}

test('setup discovery returns exact JSON strings for ordinary directory and version metadata', t => {
  const name = 'project "quoted" \\ 日本語\nline\twith\u0007control';
  const cli = 'ActQL "fixture" \\ 日本語\t\u0007';
  const {cwd, detect} = fixture(t, {name, cli});
  const actual = detect();
  assert.equal(actual.cwd, cwd);
  assert.equal(actual.actql_cli, cli);
  assert.equal(actual.node, 'v22.22.0');
  assert.equal(actual.python, 'Python 3.11.0');
});

test('setup discovery counts actual aql files rather than lines or directory contents', t => {
  const {cwd, detect} = fixture(t);
  writeFileSync(join(cwd, 'first\ncontinued.aql'), 'SELECT 1;\n');
  writeFileSync(join(cwd, 'second.aql'), 'SELECT 2;\n');
  mkdirSync(join(cwd, 'folder.aql'));
  writeFileSync(join(cwd, 'folder.aql', 'not-a-program'), 'metadata');
  assert.equal(detect().project.aql_files, 2);
});

test('setup discovery keeps absent CLI, project flags and dependency metadata separate', t => {
  const {cwd, detect} = fixture(t, {cli: null});
  const empty = detect();
  assert.equal(empty.actql_cli, null);
  assert.deepEqual(empty.project, {
    package_json: false, pyproject_toml: false, actql_config: false,
    connectors_file: false, state_dir: false, aql_files: 0,
  });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({dependencies: {'@actql/node': '0.1.0'}}));
  writeFileSync(join(cwd, 'pyproject.toml'), '[project]\ndependencies = [\n  "actql-sdk>=0.1"\n]\n');
  writeFileSync(join(cwd, 'actql.config.json'), '{}\n');
  const actual = detect();
  assert.equal(actual.project.package_json, true);
  assert.equal(actual.project.pyproject_toml, true);
  assert.equal(actual.project.actql_config, true);
  assert.equal(actual.project.state_dir, false);
  assert.deepEqual(actual.dependencies, {
    actql_node: true, actql_sdk: false, actql_python: false, actql_sdk_python: true,
  });
});
