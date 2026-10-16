#!/usr/bin/env node
// Builds the ActQL agent skills from a checkout of actql/actql.
//
//   node tools/build.mjs --docs <path to actql checkout> [--ref <sha>]
//   node tools/build.mjs --docs <path> --check      # fail if anything is stale
//
// For each skill in skills.json: write the SKILL.md front matter (name,
// description, license, metadata), copy the listed documentation pages into
// references/ (mirroring the docs/ tree, with links to pages outside the
// skill rewritten to actql.com or GitHub), write agents/openai.yaml, and
// validate the result against the Agent Skills specification limits.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, posix, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const check = args.includes('--check');
const docsRoot = option('--docs');
if (!docsRoot) { console.error('usage: node tools/build.mjs --docs <actql checkout> [--ref <sha>] [--check]'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(root, 'skills.json'), 'utf8'));
const ref = option('--ref') ?? execFileSync('git', ['-C', docsRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const site = manifest.docs.site.replace(/\/$/, '');
const github = `https://github.com/${manifest.docs.repo}/blob/${ref}`;
const SECRET = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/;

const problems = [];
const stale = [];
const fail = (skill, message) => problems.push(`${skill}: ${message}`);

/** Site URL for a documentation path, or a GitHub URL when the page is not on the site. */
function pageUrl(docPath) {
  const p = docPath.replace(/\\/g, '/');
  const m = /^docs\/(.+?)\.md$/.exec(p);
  if (!m) return `${github}/${p}`;
  const rel = m[1];
  const special = {authoring: 'guides/authoring', cli: 'guides/cli', 'connectors/README': 'connectors',
    'contributing/README': 'contributing', 'spec/README': 'spec'};
  if (special[rel]) return `${site}/${special[rel]}`;
  if (/^(getting-started|concepts|guides|reference|connectors|spec|contributing)\//.test(rel)) return `${site}/${rel}`;
  return `${github}/${p}`;
}

/** Rewrites the relative links of one page copied into a skill. */
function rewriteLinks(markdown, docPath, included) {
  const dir = posix.dirname(docPath);
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (match, bang, label, target, title) => {
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return match;
    const [path, hash = ''] = target.split('#');
    const resolved = posix.normalize(posix.join(dir, path));
    if (included.has(resolved)) return match;
    const url = bang ? `${github.replace('/blob/', '/raw/')}/${resolved}` : pageUrl(resolved);
    return `${bang}[${label}](${url}${hash ? `#${hash}` : ''}${title})`;
  });
}

function emit(path, content) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) stale.push(relative(root, path));
    return;
  }
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, content);
}

function frontMatter(skill) {
  const lines = ['---', `name: ${skill.name}`, `description: ${JSON.stringify(skill.description)}`,
    `license: ${manifest.docs.license}`, 'metadata:', `  actql-docs-repo: ${manifest.docs.repo}`,
    `  actql-docs-ref: ${ref}`, '  actql-version: "0.1"', `  actql-skills-version: "${manifest.version}"`, '---'];
  return lines.join('\n') + '\n';
}

for (const skill of manifest.skills) {
  const dir = join(root, 'skills', skill.name);
  const skillFile = join(dir, 'SKILL.md');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill.name) || skill.name.length > 64) fail(skill.name, 'name must be 1-64 lowercase letters, digits and single hyphens');
  if (!skill.description || skill.description.length > 1024) fail(skill.name, 'description must be 1-1024 characters');
  if (!existsSync(skillFile)) { fail(skill.name, 'skills/<name>/SKILL.md is missing'); continue; }
  const source = readFileSync(skillFile, 'utf8');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  const skillMd = frontMatter(skill) + body;
  emit(skillFile, skillMd);
  const bodyLines = body.split('\n').length;
  if (bodyLines > 500) fail(skill.name, `SKILL.md body is ${bodyLines} lines; keep it under 500`);
  if (SECRET.test(skillMd)) fail(skill.name, 'SKILL.md contains a secret-like value');

  // references/
  const included = new Set(skill.references);
  const referencesDir = join(dir, 'references');
  const generated = new Set();
  for (const docPath of skill.references) {
    const from = join(docsRoot, docPath);
    if (!existsSync(from)) { fail(skill.name, `missing documentation page ${docPath}`); continue; }
    const target = join(referencesDir, docPath.replace(/^docs\//, ''));
    const text = readFileSync(from, 'utf8');
    if (SECRET.test(text)) { fail(skill.name, `${docPath} contains a secret-like value`); continue; }
    const rewritten = rewriteLinks(text, docPath, included);
    const header = `<!-- Generated from ${manifest.docs.repo}@${ref.slice(0, 12)} ${docPath}; do not edit. The published page is ${pageUrl(docPath)} -->\n`;
    emit(target, header + rewritten);
    generated.add(relative(dir, target));
    // Every relative link in a copied page must resolve inside the skill.
    for (const m of rewritten.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const link = m[1];
      if (/^[a-z]+:/i.test(link)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(docPath), link));
      if (!included.has(resolved)) fail(skill.name, `${docPath} links to ${link}, which is not in this skill and was not rewritten`);
    }
  }
  if (!check && existsSync(referencesDir)) {
    // Remove pages no longer listed.
    const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const p of walk(referencesDir)) if (!generated.has(relative(dir, p))) rmSync(p);
  }

  // Every references/ and scripts/ path the body names must exist.
  for (const m of body.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)) {
    const named = m[1].replace(/<[^>]+>/, '');
    if (named.includes('<')) continue;
    const p = join(dir, named);
    if (!/<name>/.test(m[1]) && !existsSync(p)) fail(skill.name, `SKILL.md names ${m[1]} but it does not exist`);
    if (named.startsWith('scripts/') && existsSync(p) && !(statSync(p).mode & 0o111)) fail(skill.name, `${named} is not executable`);
  }

  // agents/openai.yaml (Codex and ChatGPT read it; others ignore it)
  const openai = ['interface:', `  display_name: ${JSON.stringify(skill.displayName)}`, 'policy:',
    `  allow_implicit_invocation: ${skill.allowImplicitInvocation ? 'true' : 'false'}`, ''].join('\n');
  emit(join(dir, 'agents', 'openai.yaml'), openai);
}

// Plugin manifests for Claude Code list the same skills.
const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
if (plugin.name !== 'actql') problems.push('.claude-plugin/plugin.json: name must be actql');
if (!marketplace.plugins?.some(p => p.name === 'actql')) problems.push('.claude-plugin/marketplace.json: plugin actql is not listed');

if (stale.length) { console.error(`stale (run without --check):\n  ${stale.join('\n  ')}`); process.exit(1); }
if (problems.length) { console.error(`problems:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`${manifest.skills.length} skills ${check ? 'verified' : 'built'} from ${manifest.docs.repo}@${ref.slice(0, 12)}`);
