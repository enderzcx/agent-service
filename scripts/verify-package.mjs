import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'agent-service-package-'));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options
  });
}

try {
  const packResult = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', temporaryRoot])
  );
  const filename = packResult?.[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack did not return an archive filename.');
  }

  const consumerRoot = join(temporaryRoot, 'consumer');
  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify({ name: 'agent-service-package-check', private: true, type: 'module' })}\n`,
    'utf8'
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(temporaryRoot, filename)
    ],
    { cwd: consumerRoot }
  );

  const importOutput = run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "import { formatAssetAmount, parseAssetAmount, resolveRuntimeProfile } from '@enderzcx/agent-service';",
        "const profile = resolveRuntimeProfile({ KTRACE_CHAIN_PROFILE: 'botchain_testnet' });",
        "const amount = parseAssetAmount('1.000001', { assetId: profile.settlementAsset.assetId, decimals: profile.settlementAsset.decimals });",
        "process.stdout.write(JSON.stringify({ chainId: profile.chainId, caip2: profile.caip2, raw: amount.raw.toString(), formatted: formatAssetAmount(amount) }));"
      ].join(' ')
    ],
    { cwd: consumerRoot }
  );
  const importedProfile = JSON.parse(importOutput);
  if (
    importedProfile.chainId !== 968 ||
    importedProfile.caip2 !== 'eip155:968' ||
    importedProfile.raw !== '1000001' ||
    importedProfile.formatted !== '1.000001'
  ) {
    throw new Error('Installed package exports returned the wrong profile or amount semantics.');
  }

  const binOutput = run(
    join(consumerRoot, 'node_modules', '.bin', 'agent-service'),
    ['profile', 'show'],
    {
      cwd: consumerRoot,
      env: { ...process.env, KTRACE_CHAIN_PROFILE: 'botchain_testnet' }
    }
  );
  const binResult = JSON.parse(binOutput);
  if (binResult.ok !== true || binResult.canWrite !== false) {
    throw new Error('Installed package CLI did not preserve the deny-write boundary.');
  }

  process.stdout.write('Isolated package install passed (exports and bin).\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
