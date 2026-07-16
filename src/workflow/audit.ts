import { z } from 'zod';

import { VERIFICATION_LEVELS, type VerificationLevel } from '../kernel/verification.js';
import type { ProfileStore } from '../storage/profileStore.js';

const aggregateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const statePattern = /^[a-z][a-z0-9_]*$/;

const auditEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().min(1).max(128),
    aggregateType: z.enum(['commerce', 'job']),
    aggregateId: z.string().regex(aggregateIdPattern),
    aggregateVersion: z.number().int().min(0),
    command: z.string().regex(statePattern),
    fromState: z.string().regex(statePattern).nullable(),
    toState: z.string().regex(statePattern),
    occurredAt: z.iso.datetime(),
    verificationLevel: z.enum(VERIFICATION_LEVELS),
    evidenceIds: z.array(z.string().regex(aggregateIdPattern))
  })
  .strict();

export type AuditEvent = Readonly<z.infer<typeof auditEventSchema>>;

interface AppendAuditEventInput {
  readonly aggregateType: AuditEvent['aggregateType'];
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly command: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly occurredAt: string;
  readonly verificationLevel: VerificationLevel;
  readonly evidenceIds: readonly string[];
}

function eventIdFor(input: AppendAuditEventInput): string {
  return `audit:${input.aggregateType}:${input.aggregateId}:${String(input.aggregateVersion).padStart(6, '0')}`;
}

export function parseAuditEvent(value: unknown): AuditEvent {
  return Object.freeze(auditEventSchema.parse(value));
}

export async function appendAuditEvent(
  store: ProfileStore,
  input: AppendAuditEventInput
): Promise<AuditEvent> {
  const event = parseAuditEvent({
    schemaVersion: 1,
    eventId: eventIdFor(input),
    ...input,
    evidenceIds: [...input.evidenceIds]
  });
  await store.create({
    kind: 'audit',
    id: event.eventId,
    verificationLevel: event.verificationLevel,
    payload: event
  });
  return event;
}
