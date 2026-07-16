import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { SessionOperation } from '../aa/session.js';
import {
  buildProfileFingerprint,
  type ChainRuntimeProfile
} from '../chain/profile.js';
import type { VerificationLevel } from '../kernel/verification.js';
import {
  serializeAssetAmount,
  type AssetAmount,
  type SerializedAssetAmount
} from '../money/amount.js';
import type { JsonValue, ProfileStore } from '../storage/profileStore.js';
import { appendAuditEvent } from './audit.js';
import {
  advanceCommerceRun,
  advanceJob,
  createCommerceRun,
  createJob as createJobAggregate,
  evidenceIdsForCommerceCommand,
  evidenceIdsForJobCommand,
  parseCommerceRun,
  parseJob,
  verificationLevelForCommerceCommand,
  verificationLevelForJobCommand,
  type CommerceCommand,
  type CommerceRun,
  type Job,
  type JobCommand
} from './stateMachine.js';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const serializedAmountSchema = z
  .object({
    schemaVersion: z.literal(1),
    assetId: z.string().min(1),
    decimals: z.number().int().min(0).max(255),
    raw: z.string().regex(/^(0|[1-9][0-9]*)$/)
  })
  .strict();

const receiptCoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: z.string().regex(idPattern),
    runId: z.string().regex(idPattern),
    jobId: z.string().regex(idPattern),
    negotiationId: z.string().regex(idPattern),
    outcome: z.literal('simulated_success'),
    verificationLevel: z.literal('DRY_RUN_SIMULATED'),
    canWrite: z.literal(false),
    profileFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    settlement: serializedAmountSchema,
    identityEvidenceId: z.string().regex(idPattern),
    settlementEvidenceId: z.string().regex(idPattern),
    serviceEvidenceId: z.string().regex(idPattern),
    serviceResultId: z.string().regex(idPattern),
    transactionHash: z.null(),
    userOperationHash: z.null(),
    createdAt: z.iso.datetime()
  })
  .strict();

const receiptSchema = receiptCoreSchema
  .extend({ receiptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
  .strict();

export type SimulationReceipt = Readonly<z.infer<typeof receiptSchema>>;

interface ExecuteDryRunFixtureInput {
  readonly profile: ChainRuntimeProfile;
  readonly store: ProfileStore;
  readonly clock?: () => Date;
  readonly runId: string;
  readonly jobId: string;
  readonly identitySubject: string;
  readonly negotiationId: string;
  readonly termsHash: string;
  readonly settlement: AssetAmount;
  readonly settlementOperation: SessionOperation;
  readonly serviceSimulator: DryRunServiceSimulator;
}

export interface DryRunServiceSimulationInput {
  readonly runId: string;
  readonly jobId: string;
  readonly identitySubject: string;
  readonly negotiationId: string;
  readonly termsHash: string;
  readonly settlement: SerializedAssetAmount;
}

export interface DryRunServiceSimulator {
  execute(input: DryRunServiceSimulationInput): Promise<JsonValue>;
}

export interface DryRunFixtureResult {
  readonly commerceRun: CommerceRun;
  readonly job: Job;
  readonly receipt: SimulationReceipt;
}

export class DryRunWorkflowError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'DryRunWorkflowError';
    this.code = code;
    this.details = details;
  }
}

function asJson(value: unknown): JsonValue {
  const parsed = z.json().safeParse(value);
  if (!parsed.success) {
    throw new DryRunWorkflowError(
      'Workflow artifact is not lossless JSON.',
      'workflow_artifact_invalid',
      { issues: parsed.error.issues }
    );
  }
  return parsed.data;
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function receiptHash(core: Readonly<z.infer<typeof receiptCoreSchema>>): `sha256:${string}` {
  const digest = createHash('sha256').update(canonicalJson(asJson(core))).digest('hex');
  return `sha256:${digest}`;
}

export function verifySimulationReceipt(receipt: unknown): receipt is SimulationReceipt {
  const parsed = receiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  const { receiptHash: actual, ...core } = parsed.data;
  return actual === receiptHash(receiptCoreSchema.parse(core));
}

function derivedId(base: string, suffix: string): string {
  const value = `${base}:${suffix}`;
  if (!idPattern.test(value)) {
    throw new DryRunWorkflowError(
      'Derived workflow artifact ID is invalid.',
      'workflow_fixture_id_invalid',
      { base, suffix, value }
    );
  }
  return value;
}

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DryRunWorkflowError('Workflow clock returned an invalid date.', 'workflow_clock_invalid');
  }
  return value.toISOString();
}

function assertProfile(input: ExecuteDryRunFixtureInput): string {
  const expected = buildProfileFingerprint(input.profile);
  if (
    input.store.identity.fingerprint !== expected.fingerprint ||
    input.store.identity.namespace !== expected.namespace
  ) {
    throw new DryRunWorkflowError(
      'Workflow store does not belong to the active Runtime Profile.',
      'workflow_profile_mismatch',
      { expected, actual: input.store.identity }
    );
  }
  return expected.fingerprint;
}

function assertSettlementOperation(
  operation: SessionOperation,
  settlement: SerializedAssetAmount,
  profileFingerprint: string
): void {
  if (
    operation.kind !== 'session-token-transfer' ||
    operation.canWrite !== false ||
    operation.verificationLevel !== 'DRY_RUN_SIMULATED' ||
    operation.profileFingerprint !== profileFingerprint ||
    operation.settlement === null ||
    canonicalJson(asJson(operation.settlement)) !== canonicalJson(asJson(settlement))
  ) {
    throw new DryRunWorkflowError(
      'Settlement operation does not match the dry-run profile and amount.',
      'workflow_settlement_operation_invalid'
    );
  }
}

function preflightFixtureInput(
  input: ExecuteDryRunFixtureInput,
  occurredAt: string,
  identityEvidenceId: string,
  settlementEvidenceId: string,
  operationId: string
): void {
  if (
    typeof input.identitySubject !== 'string' ||
    input.identitySubject.trim().length === 0 ||
    input.identitySubject !== input.identitySubject.trim()
  ) {
    throw new DryRunWorkflowError(
      'Fixture identity subject is invalid.',
      'workflow_identity_subject_invalid'
    );
  }
  if (!input.serviceSimulator || typeof input.serviceSimulator.execute !== 'function') {
    throw new DryRunWorkflowError(
      'Fixture service simulator is missing.',
      'workflow_service_simulator_invalid'
    );
  }

  let preview = createCommerceRun({ runId: input.runId, occurredAt });
  preview = advanceCommerceRun(preview, {
    type: 'verify_identity',
    evidenceId: identityEvidenceId,
    verificationLevel: 'LOCAL_UNIT',
    occurredAt
  });
  preview = advanceCommerceRun(preview, {
    type: 'accept_terms',
    negotiationId: input.negotiationId,
    termsHash: input.termsHash,
    settlement: input.settlement,
    occurredAt
  });
  preview = advanceCommerceRun(preview, {
    type: 'record_settlement_simulation',
    evidenceId: settlementEvidenceId,
    operationId,
    verificationLevel: 'DRY_RUN_SIMULATED',
    occurredAt
  });
  advanceCommerceRun(preview, {
    type: 'attach_job',
    jobId: input.jobId,
    occurredAt
  });
  createJobAggregate({ jobId: input.jobId, runId: input.runId, occurredAt });
}

async function createCommerce(
  store: ProfileStore,
  runId: string,
  occurredAt: string
): Promise<CommerceRun> {
  const run = createCommerceRun({ runId, occurredAt });
  await store.create({
    kind: 'workflow',
    id: runId,
    verificationLevel: 'LOCAL_UNIT',
    payload: asJson(run)
  });
  await appendAuditEvent(store, {
    aggregateType: 'commerce',
    aggregateId: runId,
    aggregateVersion: run.version,
    command: 'create',
    fromState: null,
    toState: run.state,
    occurredAt,
    verificationLevel: 'LOCAL_UNIT',
    evidenceIds: []
  });
  return run;
}

async function transitionCommerce(
  store: ProfileStore,
  runId: string,
  command: CommerceCommand
): Promise<CommerceRun> {
  const record = await store.get('workflow', runId);
  if (!record) {
    throw new DryRunWorkflowError('Commerce Run is missing.', 'workflow_record_missing', {
      runId
    });
  }
  const current = parseCommerceRun(record.payload);
  const next = advanceCommerceRun(current, command);
  const verificationLevel = verificationLevelForCommerceCommand(command);
  await store.update({
    kind: 'workflow',
    id: runId,
    expectedRevision: record.revision,
    verificationLevel,
    payload: asJson(next)
  });
  await appendAuditEvent(store, {
    aggregateType: 'commerce',
    aggregateId: runId,
    aggregateVersion: next.version,
    command: command.type,
    fromState: current.state,
    toState: next.state,
    occurredAt: command.occurredAt,
    verificationLevel,
    evidenceIds: evidenceIdsForCommerceCommand(command)
  });
  return next;
}

async function createJob(
  store: ProfileStore,
  jobId: string,
  runId: string,
  occurredAt: string
): Promise<Job> {
  const job = createJobAggregate({ jobId, runId, occurredAt });
  await store.create({
    kind: 'job',
    id: jobId,
    verificationLevel: 'LOCAL_UNIT',
    payload: asJson(job)
  });
  await appendAuditEvent(store, {
    aggregateType: 'job',
    aggregateId: jobId,
    aggregateVersion: job.version,
    command: 'create',
    fromState: null,
    toState: job.state,
    occurredAt,
    verificationLevel: 'LOCAL_UNIT',
    evidenceIds: []
  });
  return job;
}

async function transitionJob(
  store: ProfileStore,
  jobId: string,
  command: JobCommand
): Promise<Job> {
  const record = await store.get('job', jobId);
  if (!record) {
    throw new DryRunWorkflowError('Job is missing.', 'workflow_record_missing', { jobId });
  }
  const current = parseJob(record.payload);
  const next = advanceJob(current, command);
  const verificationLevel = verificationLevelForJobCommand(command);
  await store.update({
    kind: 'job',
    id: jobId,
    expectedRevision: record.revision,
    verificationLevel,
    payload: asJson(next)
  });
  await appendAuditEvent(store, {
    aggregateType: 'job',
    aggregateId: jobId,
    aggregateVersion: next.version,
    command: command.type,
    fromState: current.state,
    toState: next.state,
    occurredAt: command.occurredAt,
    verificationLevel,
    evidenceIds: evidenceIdsForJobCommand(command)
  });
  return next;
}

async function createArtifact(
  store: ProfileStore,
  kind: 'identity' | 'negotiation' | 'user-operation' | 'evidence' | 'service-result' | 'receipt',
  id: string,
  verificationLevel: VerificationLevel,
  payload: unknown
): Promise<void> {
  await store.create({ kind, id, verificationLevel, payload: asJson(payload) });
}

export async function executeDryRunFixture(
  input: ExecuteDryRunFixtureInput
): Promise<DryRunFixtureResult> {
  const profileFingerprint = assertProfile(input);
  const clock = input.clock ?? (() => new Date());
  const settlement = serializeAssetAmount(input.settlement);
  assertSettlementOperation(input.settlementOperation, settlement, profileFingerprint);

  const identityId = derivedId(input.runId, 'identity');
  const identityEvidenceId = derivedId(input.runId, 'identity-evidence');
  const operationId = derivedId(input.runId, 'user-operation');
  const settlementEvidenceId = derivedId(input.runId, 'settlement-evidence');
  const serviceResultId = derivedId(input.jobId, 'service-result');
  const serviceEvidenceId = derivedId(input.jobId, 'service-evidence');
  const receiptId = derivedId(input.runId, 'receipt');

  const createdAt = timestamp(clock);
  preflightFixtureInput(
    input,
    createdAt,
    identityEvidenceId,
    settlementEvidenceId,
    operationId
  );
  await createCommerce(input.store, input.runId, createdAt);

  const identityObservedAt = timestamp(clock);
  await createArtifact(input.store, 'identity', identityId, 'LOCAL_UNIT', {
    schemaVersion: 1,
    identityId,
    runId: input.runId,
    subject: input.identitySubject,
    status: 'verified_fixture',
    evidenceId: identityEvidenceId,
    observedAt: identityObservedAt
  });
  await createArtifact(input.store, 'evidence', identityEvidenceId, 'LOCAL_UNIT', {
    schemaVersion: 1,
    evidenceId: identityEvidenceId,
    kind: 'identity_fixture',
    verificationLevel: 'LOCAL_UNIT',
    canWrite: false,
    observedAt: identityObservedAt
  });
  let commerceRun = await transitionCommerce(input.store, input.runId, {
    type: 'verify_identity',
    evidenceId: identityEvidenceId,
    verificationLevel: 'LOCAL_UNIT',
    occurredAt: identityObservedAt
  });

  const negotiatedAt = timestamp(clock);
  await createArtifact(input.store, 'negotiation', input.negotiationId, 'LOCAL_UNIT', {
    schemaVersion: 1,
    negotiationId: input.negotiationId,
    runId: input.runId,
    status: 'accepted_fixture',
    termsHash: input.termsHash.toLowerCase(),
    settlement,
    acceptedAt: negotiatedAt
  });
  commerceRun = await transitionCommerce(input.store, input.runId, {
    type: 'accept_terms',
    negotiationId: input.negotiationId,
    termsHash: input.termsHash,
    settlement: input.settlement,
    occurredAt: negotiatedAt
  });

  const settlementObservedAt = timestamp(clock);
  await createArtifact(input.store, 'user-operation', operationId, 'DRY_RUN_SIMULATED', {
    schemaVersion: 1,
    operationId,
    runId: input.runId,
    operationKind: input.settlementOperation.kind,
    sessionId: input.settlementOperation.sessionId,
    actionId: input.settlementOperation.actionId,
    callData: input.settlementOperation.callData,
    settlement,
    profileFingerprint,
    verificationLevel: 'DRY_RUN_SIMULATED',
    canWrite: false,
    submissionStatus: 'not_submitted'
  });
  await createArtifact(
    input.store,
    'evidence',
    settlementEvidenceId,
    'DRY_RUN_SIMULATED',
    {
      schemaVersion: 1,
      evidenceId: settlementEvidenceId,
      kind: 'settlement_operation_dry_run',
      operationId,
      settlement,
      verificationLevel: 'DRY_RUN_SIMULATED',
      canWrite: false,
      transactionHash: null,
      userOperationHash: null,
      observedAt: settlementObservedAt
    }
  );
  commerceRun = await transitionCommerce(input.store, input.runId, {
    type: 'record_settlement_simulation',
    evidenceId: settlementEvidenceId,
    operationId,
    verificationLevel: 'DRY_RUN_SIMULATED',
    occurredAt: settlementObservedAt
  });

  const jobCreatedAt = timestamp(clock);
  let job = await createJob(input.store, input.jobId, input.runId, jobCreatedAt);
  commerceRun = await transitionCommerce(input.store, input.runId, {
    type: 'attach_job',
    jobId: input.jobId,
    occurredAt: jobCreatedAt
  });
  job = await transitionJob(input.store, input.jobId, {
    type: 'start_simulation',
    occurredAt: timestamp(clock)
  });

  const serviceResult = asJson(
    await input.serviceSimulator.execute({
      runId: input.runId,
      jobId: input.jobId,
      identitySubject: input.identitySubject,
      negotiationId: input.negotiationId,
      termsHash: input.termsHash.toLowerCase(),
      settlement
    })
  );
  const serviceCompletedAt = timestamp(clock);
  await createArtifact(input.store, 'service-result', serviceResultId, 'DRY_RUN_SIMULATED', {
    schemaVersion: 1,
    serviceResultId,
    runId: input.runId,
    jobId: input.jobId,
    outcome: 'simulated_success',
    result: serviceResult,
    completedAt: serviceCompletedAt
  });
  await createArtifact(input.store, 'evidence', serviceEvidenceId, 'DRY_RUN_SIMULATED', {
    schemaVersion: 1,
    evidenceId: serviceEvidenceId,
    kind: 'service_fixture_result',
    serviceResultId,
    verificationLevel: 'DRY_RUN_SIMULATED',
    canWrite: false,
    observedAt: serviceCompletedAt
  });
  job = await transitionJob(input.store, input.jobId, {
    type: 'record_simulation_success',
    serviceResultId,
    evidenceId: serviceEvidenceId,
    verificationLevel: 'DRY_RUN_SIMULATED',
    occurredAt: serviceCompletedAt
  });

  const receiptCreatedAt = timestamp(clock);
  const receiptCore = receiptCoreSchema.parse({
    schemaVersion: 1,
    receiptId,
    runId: input.runId,
    jobId: input.jobId,
    negotiationId: input.negotiationId,
    outcome: 'simulated_success',
    verificationLevel: 'DRY_RUN_SIMULATED',
    canWrite: false,
    profileFingerprint,
    settlement,
    identityEvidenceId,
    settlementEvidenceId,
    serviceEvidenceId,
    serviceResultId,
    transactionHash: null,
    userOperationHash: null,
    createdAt: receiptCreatedAt
  });
  const receipt = Object.freeze(
    receiptSchema.parse({ ...receiptCore, receiptHash: receiptHash(receiptCore) })
  );
  await createArtifact(input.store, 'receipt', receiptId, 'DRY_RUN_SIMULATED', receipt);

  job = await transitionJob(input.store, input.jobId, {
    type: 'attach_receipt',
    receiptId,
    verificationLevel: 'DRY_RUN_SIMULATED',
    occurredAt: receiptCreatedAt
  });
  commerceRun = await transitionCommerce(input.store, input.runId, {
    type: 'record_simulation_receipt',
    jobId: input.jobId,
    receiptId,
    serviceEvidenceId,
    outcome: 'success',
    verificationLevel: 'DRY_RUN_SIMULATED',
    occurredAt: receiptCreatedAt
  });
  commerceRun = await transitionCommerce(input.store, input.runId, {
    type: 'complete_simulation',
    occurredAt: receiptCreatedAt
  });

  return Object.freeze({ commerceRun, job, receipt });
}
