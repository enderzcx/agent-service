export const WRITE_ACTIONS = [
  'bundler.sendUserOperation',
  'rpc.sendRawTransaction',
  'contract.deploy',
  'contract.configure',
  'token.approve',
  'token.transfer',
  'bridge.deposit'
] as const;

export type WriteAction = (typeof WRITE_ACTIONS)[number];

export interface WriteIntent {
  readonly action: WriteAction;
  readonly profileFingerprint: string;
  readonly maxRawAmount?: bigint;
}

export interface WriteGate {
  assertAllowed(intent: WriteIntent): never;
}

export class ChainWriteDeniedError extends Error {
  readonly code = 'chain_write_not_authorized';
  readonly details: Readonly<Record<string, unknown>>;

  constructor(intent: WriteIntent) {
    super(`Chain write is not authorized: ${intent.action}`);
    this.name = 'ChainWriteDeniedError';
    this.details = Object.freeze({
      action: intent.action,
      profileFingerprint: intent.profileFingerprint,
      maxRawAmount: intent.maxRawAmount?.toString() ?? null
    });
  }
}

class DenyAllWriteGate implements WriteGate {
  assertAllowed(intent: WriteIntent): never {
    throw new ChainWriteDeniedError(intent);
  }
}

export function createDenyAllWriteGate(): WriteGate {
  return Object.freeze(new DenyAllWriteGate());
}
