import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const candidates = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean);

const patterns = [
  { name: 'private key assignment', regex: /PRIVATE_KEY\s*=\s*0x[a-fA-F0-9]{64}/ },
  { name: 'mnemonic assignment', regex: /MNEMONIC\s*=\s*["']?[a-z]+(?:\s+[a-z]+){11,23}/i },
  { name: 'GitHub token', regex: /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: 'AWS access key', regex: /\bAKIA[A-Z0-9]{16}\b/ },
  { name: 'PEM private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];

const findings = [];
for (const file of candidates) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (contents.includes('\0')) continue;
  for (const pattern of patterns) {
    if (pattern.regex.test(contents)) findings.push(`${file}: ${pattern.name}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Secret scan failed:\n${findings.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret scan passed (${candidates.length} files).\n`);
}
