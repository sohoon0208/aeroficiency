import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lockPath = join(projectRoot, 'package-lock.json');
const lockSource = readFileSync(lockPath, 'utf8');
const lock = JSON.parse(lockSource);
const checkOnly = process.argv.includes('--check');
const licenseFilePattern = /^(licen[cs]e|copying|notice)(\..*)?$/i;

function packageNameFromPath(packagePath) {
  const tail = packagePath.split('node_modules/').at(-1);
  if (tail.startsWith('@')) return tail.split('/').slice(0, 2).join('/');
  return tail.split('/')[0];
}

function normalizedLicense(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map((item) => item?.type).filter(Boolean).join(' OR ');
  return '';
}

function inferLicense(text) {
  if (/\bMIT License\b/i.test(text)) return 'MIT';
  if (/Apache License\s+Version 2\.0/i.test(text)) return 'Apache-2.0';
  if (/Mozilla Public License\s+Version 2\.0/i.test(text)) return 'MPL-2.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3/i.test(text)) return 'LGPL-3.0-or-later';
  return 'SEE PRESERVED LICENSE TEXT';
}

const packages = Object.entries(lock.packages)
  .filter(([packagePath, metadata]) => packagePath.startsWith('node_modules/') && !metadata.dev)
  .map(([packagePath, metadata]) => {
    const directory = join(projectRoot, packagePath);
    const packageJsonPath = join(directory, 'package.json');
    const optional = Boolean(metadata.optional);
    const installed = !optional && existsSync(packageJsonPath);
    if (!optional && !installed) throw new Error(`Run npm ci before generating licenses; missing ${packagePath}.`);
    const packageJson = installed ? JSON.parse(readFileSync(packageJsonPath, 'utf8')) : {};
    const licenseFiles = installed
      ? readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && licenseFilePattern.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          text: readFileSync(join(directory, entry.name), 'utf8').replace(/\r\n/g, '\n').trim(),
        }))
        .filter((entry) => entry.text.length > 0)
      : [];
    const combinedText = licenseFiles.map((entry) => entry.text).join('\n\n');
    const license = normalizedLicense(packageJson.license)
      || normalizedLicense(metadata.license)
      || inferLicense(combinedText);
    return {
      name: packageJson.name || packageNameFromPath(packagePath),
      version: packageJson.version || metadata.version,
      license,
      optional,
      installed,
      packagePath,
      licenseFiles,
    };
  })
  .sort((left, right) => `${left.name}@${left.version}:${left.packagePath}`.localeCompare(`${right.name}@${right.version}:${right.packagePath}`));

const textGroups = new Map();
for (const item of packages) {
  for (const file of item.licenseFiles) {
    const hash = createHash('sha256').update(file.text).digest('hex');
    const group = textGroups.get(hash) ?? { hash, text: file.text, sources: [] };
    group.sources.push(`${item.name}@${item.version} (${file.name})`);
    textGroups.set(hash, group);
  }
}

const lockHash = createHash('sha256').update(lockSource).digest('hex');
const inventory = [
  '# Locked production dependency license inventory',
  '',
  'Generated deterministically by `npm run licenses:generate` from the non-development package graph in `package-lock.json`.',
  '',
  `- Lockfile SHA-256: \`${lockHash}\``,
  `- Locked production package entries: ${packages.length}`,
  `- Non-optional installed entries with inspected metadata: ${packages.filter((item) => item.installed).length}`,
  `- Distinct preserved root license/notice documents: ${textGroups.size}`,
  '',
  'This is a conservative superset of browser/worker runtime code. Optional platform packages are inventoried from lock metadata but deliberately excluded from host-dependent text/status generation, so this artifact is identical on macOS and Linux. They are not present in the generated application bundle. Package authors retain all rights described by their own terms.',
  '',
  '| Package | Version | License expression | Status |',
  '|---|---:|---|---|',
  ...packages.map((item) => `| \`${item.name}\` | \`${item.version}\` | ${item.license.replace(/\|/g, '\\|')} | ${item.optional ? 'optional platform package; lock metadata' : 'installed'} |`),
  '',
].join('\n');

const texts = [
  'AEROCIENCY — PRESERVED PRODUCTION DEPENDENCY LICENSE AND NOTICE TEXTS',
  '',
  `Lockfile SHA-256: ${lockHash}`,
  'Generated deterministically from installed root license, licence, copying, and notice files.',
  'See npm-production-inventory.md for the complete locked production dependency list.',
  '',
  ...[...textGroups.values()].sort((left, right) => left.hash.localeCompare(right.hash)).flatMap((group, index) => [
    '================================================================================',
    `DOCUMENT ${index + 1} — SHA-256 ${group.hash}`,
    `APPLIES TO: ${group.sources.sort().join('; ')}`,
    '================================================================================',
    group.text,
    '',
  ]),
].join('\n');

const outputs = new Map([
  [join(projectRoot, 'THIRD_PARTY_LICENSES', 'npm-production-inventory.md'), inventory],
  [join(projectRoot, 'THIRD_PARTY_LICENSES', 'npm-production-license-texts.txt'), texts],
  [join(projectRoot, 'public', 'THIRD_PARTY_LICENSES', 'npm-production-inventory.md'), inventory],
  [join(projectRoot, 'public', 'THIRD_PARTY_LICENSES', 'npm-production-license-texts.txt'), texts],
]);

let mismatch = false;
for (const [path, content] of outputs) {
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      console.error(`Outdated generated license artifact: ${path.slice(projectRoot.length + 1)}`);
      mismatch = true;
    }
  } else {
    writeFileSync(path, content);
  }
}

if (mismatch) process.exitCode = 1;
else console.log(`${checkOnly ? 'Verified' : 'Generated'} ${packages.length} production dependency entries and ${textGroups.size} distinct license/notice documents.`);
