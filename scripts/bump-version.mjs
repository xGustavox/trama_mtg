import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , beforeSha, afterSha] = process.argv;
if (!afterSha) throw new Error('Uso: node scripts/bump-version.mjs <sha-anterior> <sha-atual>');

const zeroSha = /^0+$/.test(beforeSha || '');
const range = zeroSha ? afterSha : `${beforeSha}..${afterSha}`;
const log = execFileSync('git', ['log', '--format=%s%n%b%x1e', range], { encoding: 'utf8' });
const commits = log
  .split('\x1e')
  .map((entry) => entry.trim())
  .filter((entry) => entry && !entry.includes('[skip version]'))
  .map((entry) => {
    const [subject, ...bodyLines] = entry.split(/\r?\n/);
    return { subject: subject.trim(), body: bodyLines.join('\n').trim() };
  });

if (!commits.length) process.exit(0);

const bumpLevel = commits.reduce((level, commit) => {
  const breaking = /^[a-z]+(?:\([^)]+\))?!:/i.test(commit.subject)
    || /BREAKING[ -]CHANGE:/i.test(commit.body);
  if (breaking) return 3;
  if (/^feat(?:\([^)]+\))?:/i.test(commit.subject)) return Math.max(level, 2);
  return Math.max(level, 1);
}, 0);

const versionData = JSON.parse(readFileSync('version.json', 'utf8'));
const parts = versionData.version.split('.').map(Number);
if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
  throw new Error(`Versão inválida em version.json: ${versionData.version}`);
}

if (bumpLevel === 3) {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
} else if (bumpLevel === 2) {
  parts[1] += 1;
  parts[2] = 0;
} else {
  parts[2] += 1;
}

const version = parts.join('.');
const changes = commits.map(({ subject }) => subject
  .replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, '')
  .replace(/^./, (character) => character.toUpperCase()));
const entry = {
  version,
  date: new Date().toISOString().slice(0, 10),
  changes,
};

versionData.version = version;
versionData.updatedAt = entry.date;
versionData.history = [entry, ...(versionData.history || [])].slice(0, 20);
writeFileSync('version.json', `${JSON.stringify(versionData, null, 2)}\n`);
console.log(`Versão atualizada para ${version}`);
