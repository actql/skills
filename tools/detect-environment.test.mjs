import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const script=resolve(dirname(fileURLToPath(import.meta.url)),'../skills/actql/scripts/detect-environment.sh');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function fixture(t,{name='project',versions={}}={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'actql-skill-detection-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'),directory=join(root,name);mkdirSync(bin);mkdirSync(directory);
  for(const [command,version] of Object.entries({actql:'ActQL 0.1',node:'v22.22.0',npm:'10.9.2',python3:'Python 3.13.11',uv:'uv 0.9.0',...versions})) {
    const path=join(bin,command);writeFileSync(path,`#!/bin/sh\nprintf '%s\\n' ${quote(version)}\n`);chmodSync(path,0o755);
  }
  const detect=()=>{
    const result=spawnSync('/bin/bash',[script],{cwd:directory,env:{PATH:bin+':/usr/bin:/bin',LANG:'C'},encoding:'utf8',timeout:5000});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
    return {value:JSON.parse(result.stdout),raw:result.stdout};
  };
  return {root,directory,detect,put:(path,value)=>writeFileSync(join(directory,path),value)};
}

test('setup detection preserves the existing JSON fields and does not change project bytes',t=>{
  const f=fixture(t);f.put('package.json','{"dependencies":{"@actql/node":"0.1.0"}}');
  f.put('pyproject.toml','[project]\ndependencies = [\n  "actql>=0.1",\n]\n');
  f.put('actql.config.json','{"version":"actql-config/0.1"}\n');f.put('connectors.json','{}\n');
  const before=readFileSync(join(f.directory,'actql.config.json'));
  const {value}=f.detect();assert.equal(value.cwd,f.directory);assert.equal(value.actql_cli,'ActQL 0.1');
  assert.equal(value.node,'v22.22.0');assert.equal(value.python,'Python 3.13.11');
  assert.deepEqual(value.project,{package_json:true,pyproject_toml:true,actql_config:true,connectors_file:true,state_dir:false,aql_files:0});
  assert.deepEqual(value.dependencies,{actql_node:true,actql_sdk:false,actql_python:true,actql_sdk_python:false});
  assert.deepEqual(readFileSync(join(f.directory,'actql.config.json')),before);
});

test('setup JSON preserves whitespace, quotes, backslashes and Unicode in the actual working directory',t=>{
  const f=fixture(t,{name:'project\n\t"\\東京\r'});const {value}=f.detect();assert.equal(value.cwd,f.directory);
});

test('setup JSON escapes control characters in tool version output',t=>{
  const version='ActQL\t"quoted"\\name\b\f\x01';
  const f=fixture(t,{versions:{actql:version}});assert.equal(f.detect().value.actql_cli,version);
});

test('one Program filename remains one file when its name contains newlines',t=>{
  const f=fixture(t);f.put('one\nprogram.aql','SELECT 1;\n');assert.equal(f.detect().value.project.aql_files,1);
});

test('a directory with an aql suffix is not counted as a Program file',t=>{
  const f=fixture(t);mkdirSync(join(f.directory,'not-a-program.aql'));f.put('query.aql','SELECT 1;');
  assert.equal(f.detect().value.project.aql_files,1);
});


test('setup JSON represents every non-NUL ASCII control in a working directory',t=>{
  const controls=Array.from({length:31},(_,index)=>String.fromCharCode(index+1)).join('');
  const f=fixture(t,{name:'project-'+controls});assert.equal(f.detect().value.cwd,f.directory);
});
