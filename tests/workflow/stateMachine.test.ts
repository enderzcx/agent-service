import { describe, expect, it } from 'vitest';

import { parseAssetAmount } from '../../src/money/amount.js';
import {
  advanceCommerceRun,
  advanceJob,
  createCommerceRun,
  createJob,
  parseCommerceRun,
  parseJob
} from '../../src/workflow/stateMachine.js';

const USDT = {
  assetId: 'eip155:968/erc20:0x75edc9335175fc0552d51d48439f229c10420fe3',
  decimals: 6
} as const;
const TERMS_HASH = `0x${'aa'.repeat(32)}`;
const time = (seconds: number) => `2026-07-16T10:00:${String(seconds).padStart(2, '0')}.000Z`;

describe('Commerce Run state machine', () => {
  it('advances only through the explicit dry-run commerce lifecycle', () => {
    let run = createCommerceRun({ runId: 'commerce-001', occurredAt: time(0) });
    run = advanceCommerceRun(run, {
      type: 'verify_identity',
      evidenceId: 'identity-evidence-001',
      verificationLevel: 'LOCAL_UNIT',
      occurredAt: time(1)
    });
    run = advanceCommerceRun(run, {
      type: 'accept_terms',
      negotiationId: 'negotiation-001',
      termsHash: TERMS_HASH,
      settlement: parseAssetAmount('2.5', USDT),
      occurredAt: time(2)
    });
    run = advanceCommerceRun(run, {
      type: 'record_settlement_simulation',
      evidenceId: 'settlement-evidence-001',
      operationId: 'user-operation-001',
      verificationLevel: 'DRY_RUN_SIMULATED',
      occurredAt: time(3)
    });
    run = advanceCommerceRun(run, {
      type: 'attach_job',
      jobId: 'job-001',
      occurredAt: time(4)
    });
    run = advanceCommerceRun(run, {
      type: 'record_simulation_receipt',
      jobId: 'job-001',
      receiptId: 'receipt-001',
      serviceEvidenceId: 'service-evidence-001',
      outcome: 'success',
      verificationLevel: 'DRY_RUN_SIMULATED',
      occurredAt: time(5)
    });
    run = advanceCommerceRun(run, { type: 'complete_simulation', occurredAt: time(6) });

    expect(run.state).toBe('completed_simulation');
    expect(run.version).toBe(6);
    expect(run.settlement?.raw).toBe('2500000');
    expect(run.finalOutcome).toBe('success');
    expect(Object.isFrozen(run)).toBe(true);
  });

  it('rejects skipped, replayed, and falsely on-chain transitions', () => {
    const initial = createCommerceRun({ runId: 'commerce-001', occurredAt: time(0) });
    expect(() =>
      advanceCommerceRun(initial, {
        type: 'accept_terms',
        negotiationId: 'negotiation-001',
        termsHash: TERMS_HASH,
        settlement: parseAssetAmount('2.5', USDT),
        occurredAt: time(1)
      })
    ).toThrowError(expect.objectContaining({ code: 'workflow_transition_invalid' }));

    const identified = advanceCommerceRun(initial, {
      type: 'verify_identity',
      evidenceId: 'identity-evidence-001',
      verificationLevel: 'LOCAL_UNIT',
      occurredAt: time(1)
    });
    expect(() =>
      advanceCommerceRun(identified, {
        type: 'verify_identity',
        evidenceId: 'identity-evidence-002',
        verificationLevel: 'LOCAL_UNIT',
        occurredAt: time(2)
      })
    ).toThrowError(expect.objectContaining({ code: 'workflow_transition_invalid' }));

    const negotiated = advanceCommerceRun(identified, {
      type: 'accept_terms',
      negotiationId: 'negotiation-001',
      termsHash: TERMS_HASH,
      settlement: parseAssetAmount('2.5', USDT),
      occurredAt: time(2)
    });
    expect(() =>
      advanceCommerceRun(negotiated, {
        type: 'record_settlement_simulation',
        evidenceId: 'settlement-evidence-001',
        operationId: 'user-operation-001',
        verificationLevel: 'OWNER_APPROVED_TESTNET_WRITE',
        occurredAt: time(3)
      } as never)
    ).toThrowError(expect.objectContaining({ code: 'workflow_verification_invalid' }));
  });

  it('rejects persisted state labels whose required evidence fields are missing', () => {
    const initial = createCommerceRun({ runId: 'commerce-001', occurredAt: time(0) });
    expect(() =>
      parseCommerceRun({ ...initial, state: 'completed_simulation' })
    ).toThrowError(expect.objectContaining({ code: 'workflow_state_corrupt' }));
  });
});

describe('Job state machine', () => {
  it('tracks a successful service simulation through receipt attachment', () => {
    let job = createJob({ jobId: 'job-001', runId: 'commerce-001', occurredAt: time(0) });
    job = advanceJob(job, { type: 'start_simulation', occurredAt: time(1) });
    job = advanceJob(job, {
      type: 'record_simulation_success',
      serviceResultId: 'service-result-001',
      evidenceId: 'service-evidence-001',
      verificationLevel: 'DRY_RUN_SIMULATED',
      occurredAt: time(2)
    });
    job = advanceJob(job, {
      type: 'attach_receipt',
      receiptId: 'receipt-001',
      verificationLevel: 'DRY_RUN_SIMULATED',
      occurredAt: time(3)
    });

    expect(job).toEqual(
      expect.objectContaining({
        state: 'receipted',
        version: 3,
        resultOutcome: 'success',
        receiptId: 'receipt-001'
      })
    );
  });

  it('records failure explicitly and still permits a failure receipt', () => {
    let job = createJob({ jobId: 'job-001', runId: 'commerce-001', occurredAt: time(0) });
    job = advanceJob(job, { type: 'start_simulation', occurredAt: time(1) });
    job = advanceJob(job, {
      type: 'record_simulation_failure',
      serviceResultId: 'service-result-001',
      evidenceId: 'service-evidence-001',
      reasonCode: 'fixture_failed',
      verificationLevel: 'DRY_RUN_SIMULATED',
      occurredAt: time(2)
    });
    job = advanceJob(job, {
      type: 'attach_receipt',
      receiptId: 'receipt-001',
      verificationLevel: 'DRY_RUN_SIMULATED',
      occurredAt: time(3)
    });

    expect(job.state).toBe('receipted');
    expect(job.resultOutcome).toBe('failure');
    expect(job.failureReasonCode).toBe('fixture_failed');
  });

  it('rejects a receipted job without a service result and receipt reference', () => {
    const initial = createJob({ jobId: 'job-001', runId: 'commerce-001', occurredAt: time(0) });
    expect(() => parseJob({ ...initial, state: 'receipted' })).toThrowError(
      expect.objectContaining({ code: 'workflow_state_corrupt' })
    );
  });
});
