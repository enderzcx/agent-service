import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSessionTokenTransferCall } from '../../src/aa/session.js';
import { BOTCHAIN_TESTNET_PROFILE } from '../../src/chain/profile.js';
import { parseAssetAmount } from '../../src/money/amount.js';
import {
  createFileProfileStore,
  createMemoryProfileStore,
  type ProfileStore
} from '../../src/storage/profileStore.js';
import {
  executeDryRunFixture,
  verifySimulationReceipt
} from '../../src/workflow/dryRun.js';
import { parseCommerceRun, parseJob } from '../../src/workflow/stateMachine.js';

const FIXED_TIME = new Date('2026-07-16T10:00:00.000Z');
const SESSION_ID = `0x${'11'.repeat(32)}` as const;
const ACTION_ID = `0x${'22'.repeat(32)}` as const;
const TERMS_HASH = `0x${'aa'.repeat(32)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

function exerciseFixture(label: string, createStore: () => Promise<ProfileStore>): void {
  describe(label, () => {
    it('persists a complete simulation receipt/evidence/audit chain without on-chain claims', async () => {
      const store = await createStore();
      let serviceCalls = 0;
      const settlement = parseAssetAmount('2.5', {
        assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId,
        decimals: BOTCHAIN_TESTNET_PROFILE.settlementAsset.decimals
      });
      const settlementOperation = buildSessionTokenTransferCall({
        profile: BOTCHAIN_TESTNET_PROFILE,
        sessionId: SESSION_ID,
        recipient: '0x4000000000000000000000000000000000000004',
        amount: settlement,
        actionId: ACTION_ID
      });

      const result = await executeDryRunFixture({
        profile: BOTCHAIN_TESTNET_PROFILE,
        store,
        clock: () => FIXED_TIME,
        runId: 'commerce-001',
        jobId: 'job-001',
        identitySubject: 'agent:buyer-001',
        negotiationId: 'negotiation-001',
        termsHash: TERMS_HASH,
        settlement,
        settlementOperation,
        serviceSimulator: {
          execute(serviceInput) {
            serviceCalls += 1;
            expect(serviceInput.settlement.raw).toBe('2500000');
            return Promise.resolve({ delivered: 'fixture-result' });
          }
        }
      });

      expect(serviceCalls).toBe(1);
      expect(result.commerceRun.state).toBe('completed_simulation');
      expect(result.job.state).toBe('receipted');
      expect(result.receipt.outcome).toBe('simulated_success');
      expect(result.receipt.verificationLevel).toBe('DRY_RUN_SIMULATED');
      expect(result.receipt.canWrite).toBe(false);
      expect(result.receipt.transactionHash).toBeNull();
      expect(result.receipt.userOperationHash).toBeNull();
      expect(result.receipt.settlement.raw).toBe('2500000');
      expect(result.receipt.settlement.decimals).toBe(6);
      expect(verifySimulationReceipt(result.receipt)).toBe(true);
      expect(
        verifySimulationReceipt({
          ...result.receipt,
          settlement: { ...result.receipt.settlement, raw: '2500001' }
        })
      ).toBe(false);
      await expect(store.list('identity')).resolves.toHaveLength(1);
      await expect(store.list('negotiation')).resolves.toHaveLength(1);
      await expect(store.list('workflow')).resolves.toHaveLength(1);
      await expect(store.list('job')).resolves.toHaveLength(1);
      await expect(store.list('service-result')).resolves.toHaveLength(1);
      await expect(store.list('user-operation')).resolves.toHaveLength(1);
      await expect(store.list('receipt')).resolves.toHaveLength(1);
      await expect(store.list('evidence')).resolves.toHaveLength(3);
      await expect(store.list('audit')).resolves.toHaveLength(11);

      const workflowBefore = await store.get('workflow', 'commerce-001');
      await store.create({
        kind: 'audit',
        id: 'audit-injected-001',
        verificationLevel: 'LOCAL_UNIT',
        payload: { claimedState: 'failed' }
      });
      await expect(store.get('workflow', 'commerce-001')).resolves.toEqual(workflowBefore);
    });

    it('does not create a receipt when the service simulator fails', async () => {
      const store = await createStore();
      const settlement = parseAssetAmount('2.5', {
        assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId,
        decimals: BOTCHAIN_TESTNET_PROFILE.settlementAsset.decimals
      });
      const settlementOperation = buildSessionTokenTransferCall({
        profile: BOTCHAIN_TESTNET_PROFILE,
        sessionId: SESSION_ID,
        recipient: '0x4000000000000000000000000000000000000004',
        amount: settlement,
        actionId: ACTION_ID
      });

      await expect(
        executeDryRunFixture({
          profile: BOTCHAIN_TESTNET_PROFILE,
          store,
          clock: () => FIXED_TIME,
          runId: 'commerce-failure-001',
          jobId: 'job-failure-001',
          identitySubject: 'agent:buyer-001',
          negotiationId: 'negotiation-failure-001',
          termsHash: TERMS_HASH,
          settlement,
          settlementOperation,
          serviceSimulator: {
            execute() {
              return Promise.reject(new Error('fixture service failed'));
            }
          }
        })
      ).rejects.toThrow('fixture service failed');

      await expect(store.list('receipt')).resolves.toHaveLength(0);
      const workflowRecord = await store.get('workflow', 'commerce-failure-001');
      const jobRecord = await store.get('job', 'job-failure-001');
      expect(workflowRecord).not.toBeNull();
      expect(jobRecord).not.toBeNull();
      expect(parseCommerceRun(workflowRecord?.payload).state).toBe('service_pending');
      expect(parseJob(jobRecord?.payload).state).toBe('running_simulation');
    });
  });
}

exerciseFixture('memory workflow adapter', () =>
  Promise.resolve(
    createMemoryProfileStore({ profile: BOTCHAIN_TESTNET_PROFILE, clock: () => FIXED_TIME })
  )
);

exerciseFixture('atomic-file workflow adapter', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-service-workflow-'));
  temporaryRoots.push(rootDir);
  return createFileProfileStore({
    profile: BOTCHAIN_TESTNET_PROFILE,
    rootDir,
    clock: () => FIXED_TIME
  });
});

describe('dry-run fixture preflight', () => {
  it('rejects a settlement amount that is not bound to the SessionOperation before writing', async () => {
    const store = createMemoryProfileStore({
      profile: BOTCHAIN_TESTNET_PROFILE,
      clock: () => FIXED_TIME
    });
    const operationAmount = parseAssetAmount('2.5', {
      assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId,
      decimals: BOTCHAIN_TESTNET_PROFILE.settlementAsset.decimals
    });
    const settlementOperation = buildSessionTokenTransferCall({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sessionId: SESSION_ID,
      recipient: '0x4000000000000000000000000000000000000004',
      amount: operationAmount,
      actionId: ACTION_ID
    });

    await expect(
      executeDryRunFixture({
        profile: BOTCHAIN_TESTNET_PROFILE,
        store,
        clock: () => FIXED_TIME,
        runId: 'commerce-mismatch-001',
        jobId: 'job-mismatch-001',
        identitySubject: 'agent:buyer-001',
        negotiationId: 'negotiation-mismatch-001',
        termsHash: TERMS_HASH,
        settlement: parseAssetAmount('3', {
          assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId,
          decimals: BOTCHAIN_TESTNET_PROFILE.settlementAsset.decimals
        }),
        settlementOperation,
        serviceSimulator: {
          execute() {
            return Promise.resolve({ delivered: 'must-not-run' });
          }
        }
      })
    ).rejects.toEqual(
      expect.objectContaining({ code: 'workflow_settlement_operation_invalid' })
    );
    await expect(store.list('workflow')).resolves.toHaveLength(0);
  });
});
