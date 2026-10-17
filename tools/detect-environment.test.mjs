import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const script=resolve(dirname(fileURLToPath(import.meta.url)),'../skills/actql/scripts/detect-environment.sh');
const python=process.env.ACTQL_TEST_SKILL_PYTHON??'python3';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function fixture(t,{name='project',versions={}}={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'actql-skill-detection-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'),directory=join(root,name);mkdirSync(bin);mkdirSync(directory);
  for(const [command,version] of Object.entries({actql:'ActQL 0.1',node:'v22.22.0',npm:'10.9.2',python3:'Python 3.13.11',uv:'uv 0.9.0',...versions})) {
    const path=join(bin,command),actual=command==='node'?process.execPath:command==='python3'?python:undefined;
    const lines=['#!/bin/sh','if [ "$1" = "--version" ] || [ "$1" = "version" ]; then',
      `  printf '%s\\n' ${quote(version)}`,'else',
      actual===undefined?'  exit 2':`  exec ${quote(actual)} "$@"`,'fi',''];
    writeFileSync(path,lines.join('\n'));chmodSync(path,0o755);
  }
  const detect=()=>{
    const result=spawnSync('/bin/bash',[script],{cwd:directory,env:{PATH:bin+':/usr/bin:/bin',LANG:'C'},encoding:'utf8',timeout:5000});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
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

test('first setup needs no installed version tool or language runtime',t=>{
  const f=fixture(t),minimal=join(f.root,'minimal');mkdirSync(minimal);
  symlinkSync('/usr/bin/od',join(minimal,'od'));
  const result=spawnSync('/bin/bash',[script],{cwd:f.directory,env:{PATH:minimal,LANG:'C'},encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0);assert.equal(result.stderr,'');
  const value=JSON.parse(result.stdout);assert.equal(value.cwd,f.directory);
  for(const field of ['actql_cli','node','npm','python','uv'])assert.equal(value[field],null);
  assert.equal(value.project.aql_files,0);assert.equal(value.project.state_dir,false);
});


test('inline Python dependencies are read from the actual project table',t=>{
  const f=fixture(t);f.put('pyproject.toml','[project]\ndependencies = ["actql>=0.1", "actql-sdk>=0.1"]\n');
  const d=f.detect().value.dependencies;assert.equal(d.actql_python,true);assert.equal(d.actql_sdk_python,true);
});

test('Poetry dependency names use Python package normalization without matching a different package',t=>{
  const f=fixture(t);f.put('pyproject.toml','[tool.poetry.dependencies]\nACTQL_SDK = "*"\nactql-extra = "*"\npython = ">=3.11"\n');
  const d=f.detect().value.dependencies;assert.equal(d.actql_python,false);assert.equal(d.actql_sdk_python,true);
});

test('unrelated JSON keys and TOML tool settings are not package dependencies',t=>{
  const f=fixture(t);f.put('package.json',JSON.stringify({scripts:{'@actql/node':'unrelated'},description:'@actql/sdk'}));
  f.put('pyproject.toml','[tool.example]\nactql = "unrelated"\nactql-sdk = "unrelated"\n');
  assert.deepEqual(f.detect().value.dependencies,{actql_node:false,actql_sdk:false,actql_python:false,actql_sdk_python:false});
});

test('JSON dependencies use their exact package names and preserve manifest bytes',t=>{
  const f=fixture(t),body=JSON.stringify({dependencies:{'@actql/node-extra':'*'},devDependencies:{'@actql/sdk':'*'}});
  f.put('package.json',body);const d=f.detect().value.dependencies;
  assert.equal(d.actql_node,false);assert.equal(d.actql_sdk,true);assert.equal(readFileSync(join(f.directory,'package.json'),'utf8'),body);
});

test('malformed existing manifests are unknown instead of reporting a missing dependency',t=>{
  const f=fixture(t);f.put('package.json','{"dependencies":');f.put('pyproject.toml','[project]\ndependencies = [');
  assert.deepEqual(f.detect().value.dependencies,{actql_node:null,actql_sdk:null,actql_python:null,actql_sdk_python:null});
});

test('existing manifests remain unknown when no language parser is installed',t=>{
  const f=fixture(t),minimal=join(f.root,'minimal');mkdirSync(minimal);symlinkSync('/usr/bin/od',join(minimal,'od'));
  f.put('package.json','{"dependencies":{"@actql/node":"*"}}');f.put('pyproject.toml','[project]\ndependencies = ["actql"]\n');
  const result=spawnSync('/bin/bash',[script],{cwd:f.directory,env:{PATH:minimal,LANG:'C'},encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout).dependencies,{actql_node:null,actql_sdk:null,actql_python:null,actql_sdk_python:null});
});


function nodeOnlyDetection(f) {
  const minimal=join(f.root,'node-only');mkdirSync(minimal);
  for(const command of ['od','head','tr'])symlinkSync('/usr/bin/'+command,join(minimal,command));
  symlinkSync(process.execPath,join(minimal,'node'));
  const result=spawnSync('/bin/bash',[script],{cwd:f.directory,env:{PATH:minimal,LANG:'C'},encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.stderr,'');
  return JSON.parse(result.stdout);
}

test('the actual Node parser reads dependency tables when Python is absent',t=>{
  const f=fixture(t);f.put('package.json',JSON.stringify({dependencies:{'@actql/node':'*'},scripts:{'@actql/sdk':'unrelated'}}));
  const value=nodeOnlyDetection(f);assert.equal(value.python,null);
  assert.deepEqual(value.dependencies,{actql_node:true,actql_sdk:false,actql_python:false,actql_sdk_python:false});
});

test('a malformed dependency table is unknown on both actual JSON parser paths',t=>{
  const f=fixture(t);f.put('package.json','{"dependencies":null}');
  for(const value of [f.detect().value,nodeOnlyDetection(f)]){
    assert.equal(value.dependencies.actql_node,null);assert.equal(value.dependencies.actql_sdk,null);
  }
});


test('PEP621 optional groups retain declared normalized package identities',t=>{
  const f=fixture(t);f.put('pyproject.toml','[project]\noptional-dependencies = { dev = ["ActQL[cache]>=0.1", "actql_sdk @ https://example.invalid/sdk.whl"] }\n');
  const d=f.detect().value.dependencies;assert.equal(d.actql_python,true);assert.equal(d.actql_sdk_python,true);
});

test('Poetry development and named groups are declarations without importing packages',t=>{
  const f=fixture(t);f.put('pyproject.toml','[tool.poetry.dev-dependencies]\nactql_sdk = "*"\n[tool.poetry.group.dev.dependencies]\nactql = { version = "*", optional = true }\n');
  const d=f.detect().value.dependencies;assert.equal(d.actql_python,true);assert.equal(d.actql_sdk_python,true);
});
