import { z } from 'zod';

import type { VerificationLevel } from '../kernel/verification.js';
import {
  deserializeAssetAmount,
  serializeAssetAmount,
  type AssetAmount,
  type SerializedAssetAmount
} from '../money/amount.js';

const aggregateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;

export const COMMERCE_STATES = [
  'identity_pending',
  'negotiation_pending',
  'settlement_pending',
  'settlement_simulated',
  'service_pending',
  'receipt_ready',
  'completed_simulation',
  'failed'
] as const;

export const JOB_STATES = [
  'created',
  'running_simulation',
  'succeeded_simulation',
  'failed_simulation',
  'receipted'
] as const;

const serializedAmountSchema = z
  .object({
    schemaVersion: z.literal(1),
    assetId: z.string().min(1),
    decimals: z.number().int().min(0).max(255),
    raw: z.string().regex(/^(0|[1-9][0-9]*)$/)
  })
  .strict();

const commerceRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().regex(aggregateIdPattern),
    version: z.number().int().min(0),
    state: z.enum(COMMERCE_STATES),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    identityEvidenceId: z.string().regex(aggregateIdPattern).nullable(),
    negotiationId: z.string().regex(aggregateIdPattern).nullable(),
    termsHash: z.string().regex(hashPattern).nullable(),
    settlement: serializedAmountSchema.nullable(),
    settlementEvidenceId: z.string().regex(aggregateIdPattern).nullable(),
    settlementOperationId: z.string().regex(aggregateIdPattern).nullable(),
    jobId: z.string().regex(aggregateIdPattern).nullable(),
    receiptId: z.string().regex(aggregateIdPattern).nullable(),
    serviceEvidenceId: z.string().regex(aggregateIdPattern).nullable(),
    finalOutcome: z.enum(['success', 'failure']).nullable(),
    failureReasonCode: z.string().regex(aggregateIdPattern).nullable()
  })
  .strict();

const jobSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.string().regex(aggregateIdPattern),
    runId: z.string().regex(aggregateIdPattern),
    version: z.number().int().min(0),
    state: z.enum(JOB_STATES),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    serviceResultId: z.string().regex(aggregateIdPattern).nullable(),
    evidenceId: z.string().regex(aggregateIdPattern).nullable(),
    resultOutcome: z.enum(['success', 'failure']).nullable(),
    failureReasonCode: z.string().regex(aggregateIdPattern).nullable(),
    receiptId: z.string().regex(aggregateIdPattern).nullable()
  })
  .strict();

export type CommerceState = (typeof COMMERCE_STATES)[number];
export type JobState = (typeof JOB_STATES)[number];
export type CommerceRun = Readonly<z.infer<typeof commerceRunSchema>>;
export type Job = Readonly<z.infer<typeof jobSchema>>;

interface OccurredCommand {
  readonly occurredAt: string;
}

export type CommerceCommand =
  | (OccurredCommand & {
      readonly type: 'verify_identity';
      readonly evidenceId: string;
      readonly verificationLevel: Extract<VerificationLevel, 'LOCAL_UNIT' | 'READONLY_RPC'>;
    })
  | (OccurredCommand & {
      readonly type: 'accept_terms';
      readonly negotiationId: string;
      readonly termsHash: string;
      readonly settlement: AssetAmount;
    })
  | (OccurredCommand & {
      readonly type: 'record_settlement_simulation';
      readonly evidenceId: string;
      readonly operationId: string;
      readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
    })
  | (OccurredCommand & { readonly type: 'attach_job'; readonly jobId: string })
  | (OccurredCommand & {
      readonly type: 'record_simulation_receipt';
      readonly jobId: string;
      readonly receiptId: string;
      readonly serviceEvidenceId: string;
      readonly outcome: 'success' | 'failure';
      readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
    })
  | (OccurredCommand & { readonly type: 'complete_simulation' })
  | (OccurredCommand & {
      readonly type: 'fail';
      readonly reasonCode: string;
      readonly evidenceId: string | null;
      readonly verificationLevel: Extract<
        VerificationLevel,
        'LOCAL_UNIT' | 'DRY_RUN_SIMULATED'
      >;
    });

export type JobCommand =
  | (OccurredCommand & { readonly type: 'start_simulation' })
  | (OccurredCommand & {
      readonly type: 'record_simulation_success';
      readonly serviceResultId: string;
      readonly evidenceId: string;
      readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
    })
  | (OccurredCommand & {
      readonly type: 'record_simulation_failure';
      readonly serviceResultId: string;
      readonly evidenceId: string;
      readonly reasonCode: string;
      readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
    })
  | (OccurredCommand & {
      readonly type: 'attach_receipt';
      readonly receiptId: string;
      readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
    });

export class WorkflowStateError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'WorkflowStateError';
    this.code = code;
    this.details = details;
  }
}

function corruptState(
  aggregateType: 'commerce' | 'job',
  state: string,
  reason: string,
  details: Readonly<Record<string, unknown>> = {}
): never {
  throw new WorkflowStateError(
    `${aggregateType} state ${state} is internally inconsistent: ${reason}.`,
    'workflow_state_corrupt',
    { aggregateType, state, reason, ...details }
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireId(value: string, label: string): void {
  if (!aggregateIdPattern.test(value)) {
    throw new WorkflowStateError(`${label} is invalid.`, 'workflow_id_invalid', {
      label,
      value
    });
  }
}

function requireHash(value: string, label: string): void {
  if (!hashPattern.test(value)) {
    throw new WorkflowStateError(`${label} must be a 32-byte hex hash.`, 'workflow_hash_invalid', {
      label,
      value
    });
  }
}

function requireOccurredAt(occurredAt: string, previous?: string): void {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== occurredAt) {
    throw new WorkflowStateError(
      'Command occurredAt must be a canonical ISO timestamp.',
      'workflow_time_invalid',
      { occurredAt }
    );
  }
  if (previous && timestamp < Date.parse(previous)) {
    throw new WorkflowStateError(
      'Command time cannot precede aggregate time.',
      'workflow_time_regression',
      { occurredAt, previous }
    );
  }
}

function requireState(
  actual: string,
  allowed: readonly string[],
  command: string
): void {
  if (!allowed.includes(actual)) {
    throw new WorkflowStateError(
      `Command ${command} is not allowed from ${actual}.`,
      'workflow_transition_invalid',
      { command, actual, allowed }
    );
  }
}

function requireVerification(
  actual: VerificationLevel,
  allowed: readonly VerificationLevel[],
  command: string
): void {
  if (!allowed.includes(actual)) {
    throw new WorkflowStateError(
      `Command ${command} cannot claim ${actual}.`,
      'workflow_verification_invalid',
      { command, actual, allowed }
    );
  }
}

function isCanonicalSerializedAmount(value: SerializedAssetAmount): boolean {
  try {
    const normalized = serializeAssetAmount(deserializeAssetAmount(value));
    return (
      value.schemaVersion === normalized.schemaVersion &&
      value.assetId === normalized.assetId &&
      value.decimals === normalized.decimals &&
      value.raw === normalized.raw
    );
  } catch {
    return false;
  }
}

export function parseCommerceRun(value: unknown): CommerceRun {
  const parsed = commerceRunSchema.safeParse(value);
  if (!parsed.success) {
    corruptState('commerce', 'unknown', 'schema validation failed', {
      issues: parsed.error.issues
    });
  }
  const run = parsed.data;
  if (run.settlement !== null && !isCanonicalSerializedAmount(run.settlement)) {
    corruptState('commerce', run.state, 'settlement amount is invalid or non-canonical');
  }
  const negotiated =
    run.identityEvidenceId !== null &&
    run.negotiationId !== null &&
    run.termsHash !== null &&
    run.settlement !== null;
  const settled =
    negotiated &&
    run.settlementEvidenceId !== null &&
    run.settlementOperationId !== null;
  const serviceAttached = settled && run.jobId !== null;
  const receipted =
    serviceAttached &&
    run.receiptId !== null &&
    run.serviceEvidenceId !== null &&
    run.finalOutcome !== null;

  switch (run.state) {
    case 'identity_pending':
      if (
        run.identityEvidenceId !== null ||
        run.negotiationId !== null ||
        run.termsHash !== null ||
        run.settlement !== null ||
        run.settlementEvidenceId !== null ||
        run.settlementOperationId !== null ||
        run.jobId !== null ||
        run.receiptId !== null ||
        run.serviceEvidenceId !== null ||
        run.finalOutcome !== null ||
        run.failureReasonCode !== null
      ) {
        corruptState('commerce', run.state, 'future fields are populated');
      }
      break;
    case 'negotiation_pending':
      if (
        run.identityEvidenceId === null ||
        run.negotiationId !== null ||
        run.termsHash !== null ||
        run.settlement !== null ||
        run.settlementEvidenceId !== null ||
        run.settlementOperationId !== null ||
        run.jobId !== null ||
        run.receiptId !== null ||
        run.serviceEvidenceId !== null ||
        run.finalOutcome !== null ||
        run.failureReasonCode !== null
      ) {
        corruptState('commerce', run.state, 'identity or future-field invariant failed');
      }
      break;
    case 'settlement_pending':
      if (
        !negotiated ||
        run.settlementEvidenceId !== null ||
        run.settlementOperationId !== null ||
        run.jobId !== null ||
        run.receiptId !== null ||
        run.serviceEvidenceId !== null ||
        run.finalOutcome !== null ||
        run.failureReasonCode !== null
      ) {
        corruptState('commerce', run.state, 'negotiation or future-field invariant failed');
      }
      break;
    case 'settlement_simulated':
      if (
        !settled ||
        run.jobId !== null ||
        run.receiptId !== null ||
        run.serviceEvidenceId !== null ||
        run.finalOutcome !== null ||
        run.failureReasonCode !== null
      ) {
        corruptState('commerce', run.state, 'settlement or future-field invariant failed');
      }
      break;
    case 'service_pending':
      if (
        !serviceAttached ||
        run.receiptId !== null ||
        run.serviceEvidenceId !== null ||
        run.finalOutcome !== null ||
        run.failureReasonCode !== null
      ) {
        corruptState('commerce', run.state, 'job or future-field invariant failed');
      }
      break;
    case 'receipt_ready':
    case 'completed_simulation':
      if (!receipted || run.failureReasonCode !== null) {
        corruptState('commerce', run.state, 'receipt evidence invariant failed');
      }
      break;
    case 'failed':
      if (run.failureReasonCode === null) {
        corruptState('commerce', run.state, 'failure reason is missing');
      }
      break;
  }
  return deepFreeze(run);
}

export function parseJob(value: unknown): Job {
  const parsed = jobSchema.safeParse(value);
  if (!parsed.success) {
    corruptState('job', 'unknown', 'schema validation failed', {
      issues: parsed.error.issues
    });
  }
  const job = parsed.data;
  const hasResult =
    job.serviceResultId !== null && job.evidenceId !== null && job.resultOutcome !== null;
  switch (job.state) {
    case 'created':
    case 'running_simulation':
      if (
        job.serviceResultId !== null ||
        job.evidenceId !== null ||
        job.resultOutcome !== null ||
        job.failureReasonCode !== null ||
        job.receiptId !== null
      ) {
        corruptState('job', job.state, 'result fields are populated before completion');
      }
      break;
    case 'succeeded_simulation':
      if (
        !hasResult ||
        job.resultOutcome !== 'success' ||
        job.failureReasonCode !== null ||
        job.receiptId !== null
      ) {
        corruptState('job', job.state, 'success result invariant failed');
      }
      break;
    case 'failed_simulation':
      if (
        !hasResult ||
        job.resultOutcome !== 'failure' ||
        job.failureReasonCode === null ||
        job.receiptId !== null
      ) {
        corruptState('job', job.state, 'failure result invariant failed');
      }
      break;
    case 'receipted':
      if (
        !hasResult ||
        job.receiptId === null ||
        (job.resultOutcome === 'success' && job.failureReasonCode !== null) ||
        (job.resultOutcome === 'failure' && job.failureReasonCode === null)
      ) {
        corruptState('job', job.state, 'receipt result invariant failed');
      }
      break;
  }
  return deepFreeze(job);
}

export function createCommerceRun(input: {
  readonly runId: string;
  readonly occurredAt: string;
}): CommerceRun {
  requireId(input.runId, 'runId');
  requireOccurredAt(input.occurredAt);
  return parseCommerceRun({
    schemaVersion: 1,
    runId: input.runId,
    version: 0,
    state: 'identity_pending',
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    identityEvidenceId: null,
    negotiationId: null,
    termsHash: null,
    settlement: null,
    settlementEvidenceId: null,
    settlementOperationId: null,
    jobId: null,
    receiptId: null,
    serviceEvidenceId: null,
    finalOutcome: null,
    failureReasonCode: null
  });
}

function nextCommerceRun(
  run: CommerceRun,
  occurredAt: string,
  patch: Readonly<Partial<CommerceRun>>
): CommerceRun {
  requireOccurredAt(occurredAt, run.updatedAt);
  return parseCommerceRun({
    ...run,
    ...patch,
    version: run.version + 1,
    updatedAt: occurredAt
  });
}

export function advanceCommerceRun(runInput: CommerceRun, command: CommerceCommand): CommerceRun {
  const run = parseCommerceRun(runInput);
  switch (command.type) {
    case 'verify_identity':
      requireState(run.state, ['identity_pending'], command.type);
      requireVerification(command.verificationLevel, ['LOCAL_UNIT', 'READONLY_RPC'], command.type);
      requireId(command.evidenceId, 'evidenceId');
      return nextCommerceRun(run, command.occurredAt, {
        state: 'negotiation_pending',
        identityEvidenceId: command.evidenceId
      });
    case 'accept_terms': {
      requireState(run.state, ['negotiation_pending'], command.type);
      requireId(command.negotiationId, 'negotiationId');
      requireHash(command.termsHash, 'termsHash');
      const settlement = serializeAssetAmount(command.settlement);
      if (settlement.raw === '0') {
        throw new WorkflowStateError(
          'Settlement amount must be positive.',
          'workflow_settlement_invalid'
        );
      }
      return nextCommerceRun(run, command.occurredAt, {
        state: 'settlement_pending',
        negotiationId: command.negotiationId,
        termsHash: command.termsHash.toLowerCase(),
        settlement
      });
    }
    case 'record_settlement_simulation':
      requireState(run.state, ['settlement_pending'], command.type);
      requireVerification(command.verificationLevel, ['DRY_RUN_SIMULATED'], command.type);
      requireId(command.evidenceId, 'evidenceId');
      requireId(command.operationId, 'operationId');
      return nextCommerceRun(run, command.occurredAt, {
        state: 'settlement_simulated',
        settlementEvidenceId: command.evidenceId,
        settlementOperationId: command.operationId
      });
    case 'attach_job':
      requireState(run.state, ['settlement_simulated'], command.type);
      requireId(command.jobId, 'jobId');
      return nextCommerceRun(run, command.occurredAt, {
        state: 'service_pending',
        jobId: command.jobId
      });
    case 'record_simulation_receipt':
      requireState(run.state, ['service_pending'], command.type);
      requireVerification(command.verificationLevel, ['DRY_RUN_SIMULATED'], command.type);
      if (run.jobId !== command.jobId) {
        throw new WorkflowStateError(
          'Receipt job does not match the Commerce Run.',
          'workflow_job_mismatch',
          { expected: run.jobId, actual: command.jobId }
        );
      }
      requireId(command.receiptId, 'receiptId');
      requireId(command.serviceEvidenceId, 'serviceEvidenceId');
      return nextCommerceRun(run, command.occurredAt, {
        state: 'receipt_ready',
        receiptId: command.receiptId,
        serviceEvidenceId: command.serviceEvidenceId,
        finalOutcome: command.outcome
      });
    case 'complete_simulation':
      requireState(run.state, ['receipt_ready'], command.type);
      return nextCommerceRun(run, command.occurredAt, { state: 'completed_simulation' });
    case 'fail':
      requireState(
        run.state,
        COMMERCE_STATES.filter(
          (state) => state !== 'completed_simulation' && state !== 'failed'
        ),
        command.type
      );
      requireVerification(command.verificationLevel, ['LOCAL_UNIT', 'DRY_RUN_SIMULATED'], command.type);
      requireId(command.reasonCode, 'reasonCode');
      if (command.evidenceId !== null) requireId(command.evidenceId, 'evidenceId');
      return nextCommerceRun(run, command.occurredAt, {
        state: 'failed',
        failureReasonCode: command.reasonCode
      });
  }
}

export function createJob(input: {
  readonly jobId: string;
  readonly runId: string;
  readonly occurredAt: string;
}): Job {
  requireId(input.jobId, 'jobId');
  requireId(input.runId, 'runId');
  requireOccurredAt(input.occurredAt);
  return parseJob({
    schemaVersion: 1,
    jobId: input.jobId,
    runId: input.runId,
    version: 0,
    state: 'created',
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    serviceResultId: null,
    evidenceId: null,
    resultOutcome: null,
    failureReasonCode: null,
    receiptId: null
  });
}

function nextJob(
  job: Job,
  occurredAt: string,
  patch: Readonly<Partial<Job>>
): Job {
  requireOccurredAt(occurredAt, job.updatedAt);
  return parseJob({ ...job, ...patch, version: job.version + 1, updatedAt: occurredAt });
}

export function advanceJob(jobInput: Job, command: JobCommand): Job {
  const job = parseJob(jobInput);
  switch (command.type) {
    case 'start_simulation':
      requireState(job.state, ['created'], command.type);
      return nextJob(job, command.occurredAt, { state: 'running_simulation' });
    case 'record_simulation_success':
      requireState(job.state, ['running_simulation'], command.type);
      requireVerification(command.verificationLevel, ['DRY_RUN_SIMULATED'], command.type);
      requireId(command.serviceResultId, 'serviceResultId');
      requireId(command.evidenceId, 'evidenceId');
      return nextJob(job, command.occurredAt, {
        state: 'succeeded_simulation',
        serviceResultId: command.serviceResultId,
        evidenceId: command.evidenceId,
        resultOutcome: 'success'
      });
    case 'record_simulation_failure':
      requireState(job.state, ['running_simulation'], command.type);
      requireVerification(command.verificationLevel, ['DRY_RUN_SIMULATED'], command.type);
      requireId(command.serviceResultId, 'serviceResultId');
      requireId(command.evidenceId, 'evidenceId');
      requireId(command.reasonCode, 'reasonCode');
      return nextJob(job, command.occurredAt, {
        state: 'failed_simulation',
        serviceResultId: command.serviceResultId,
        evidenceId: command.evidenceId,
        resultOutcome: 'failure',
        failureReasonCode: command.reasonCode
      });
    case 'attach_receipt':
      requireState(job.state, ['succeeded_simulation', 'failed_simulation'], command.type);
      requireVerification(command.verificationLevel, ['DRY_RUN_SIMULATED'], command.type);
      requireId(command.receiptId, 'receiptId');
      return nextJob(job, command.occurredAt, {
        state: 'receipted',
        receiptId: command.receiptId
      });
  }
}

export function verificationLevelForCommerceCommand(
  command: CommerceCommand
): VerificationLevel {
  switch (command.type) {
    case 'verify_identity':
    case 'record_settlement_simulation':
    case 'record_simulation_receipt':
    case 'fail':
      return command.verificationLevel;
    case 'accept_terms':
      return 'LOCAL_UNIT';
    case 'attach_job':
    case 'complete_simulation':
      return 'DRY_RUN_SIMULATED';
  }
}

export function evidenceIdsForCommerceCommand(command: CommerceCommand): readonly string[] {
  switch (command.type) {
    case 'verify_identity':
    case 'record_settlement_simulation':
      return Object.freeze([command.evidenceId]);
    case 'record_simulation_receipt':
      return Object.freeze([command.serviceEvidenceId]);
    case 'fail':
      return Object.freeze(command.evidenceId === null ? [] : [command.evidenceId]);
    case 'accept_terms':
    case 'attach_job':
    case 'complete_simulation':
      return Object.freeze([]);
  }
}

export function verificationLevelForJobCommand(command: JobCommand): VerificationLevel {
  return command.type === 'start_simulation'
    ? 'DRY_RUN_SIMULATED'
    : command.verificationLevel;
}

export function evidenceIdsForJobCommand(command: JobCommand): readonly string[] {
  switch (command.type) {
    case 'record_simulation_success':
    case 'record_simulation_failure':
      return Object.freeze([command.evidenceId]);
    case 'start_simulation':
    case 'attach_receipt':
      return Object.freeze([]);
  }
}

export type { SerializedAssetAmount };
