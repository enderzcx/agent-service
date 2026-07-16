import { createHash, randomUUID } from 'node:crypto';

import { buildSessionTokenTransferCall } from '../src/aa/session.js';
import { resolveRuntimeProfile } from '../src/chain/profile.js';
import { parseAssetAmount } from '../src/money/amount.js';
import { createFileProfileStore } from '../src/storage/profileStore.js';
import { executeDryRunFixture } from '../src/workflow/dryRun.js';

const profile = resolveRuntimeProfile(process.env);
const dataRoot = process.env['KTRACE_DATA_DIR']?.trim() || '.runtime';
const fixtureId = randomUUID();
const runId = `run-${fixtureId}`;
const jobId = `job-${fixtureId}`;
const negotiationId = `terms-${fixtureId}`;
const termsHash = `0x${createHash('sha256').update(`botchain-fixture:${fixtureId}`).digest('hex')}`;
const sessionId = `0x${createHash('sha256').update(`session:${fixtureId}`).digest('hex')}` as const;
const actionId = `0x${createHash('sha256').update(`action:${fixtureId}`).digest('hex')}` as const;
const settlement = parseAssetAmount('2.5', {
  assetId: profile.settlementAsset.assetId,
  decimals: profile.settlementAsset.decimals
});
const settlementOperation = buildSessionTokenTransferCall({
  profile,
  sessionId,
  recipient: '0x4000000000000000000000000000000000000004',
  amount: settlement,
  actionId
});
const store = createFileProfileStore({ profile, rootDir: dataRoot });

const result = await executeDryRunFixture({
  profile,
  store,
  runId,
  jobId,
  identitySubject: 'agent:fixture-buyer',
  negotiationId,
  termsHash,
  settlement,
  settlementOperation,
  serviceSimulator: {
    execute(input) {
      return Promise.resolve({
        fixture: 'deterministic-service-simulation',
        runId: input.runId,
        settlementRaw: input.settlement.raw
      });
    }
  }
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      command: 'workflow.dry-run',
      canWrite: false,
      verificationLevel: result.receipt.verificationLevel,
      namespace: store.identity.namespace,
      dataRoot,
      runId,
      jobId,
      commerceState: result.commerceRun.state,
      jobState: result.job.state,
      receiptId: result.receipt.receiptId,
      receiptHash: result.receipt.receiptHash,
      transactionHash: result.receipt.transactionHash,
      userOperationHash: result.receipt.userOperationHash
    },
    null,
    2
  )}\n`
);
