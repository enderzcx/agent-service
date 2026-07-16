import {
  buildSessionTokenTransferCall,
  createSessionUserOperationDraft,
  estimateSessionUserOperation
} from '../src/aa/session.js';
import { resolveRuntimeProfile } from '../src/chain/profile.js';
import { HttpJsonRpcClient } from '../src/chain/rpc.js';

const PROBE_SENDER = '0x1000000000000000000000000000000000000001';
const PROBE_RECIPIENT = '0x4000000000000000000000000000000000000004';
const PROBE_SESSION_ID = `0x${'11'.repeat(32)}` as const;
const PROBE_ACTION_ID = `0x${'22'.repeat(32)}` as const;

function describeError(error: unknown): Readonly<Record<string, unknown>> {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const candidate = error as {
    readonly name?: unknown;
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
  return {
    name: candidate.name,
    code: candidate.code,
    message: candidate.message,
    details: candidate.details
  };
}

const profile = resolveRuntimeProfile(process.env);
const operation = buildSessionTokenTransferCall({
  profile,
  sessionId: PROBE_SESSION_ID,
  recipient: PROBE_RECIPIENT,
  rawAmount: 1n,
  actionId: PROBE_ACTION_ID
});
const draft = createSessionUserOperationDraft({
  profile,
  sender: PROBE_SENDER,
  nonce: 0n,
  operation
});

try {
  const result = await estimateSessionUserOperation({
    draft,
    bundlerRpc: new HttpJsonRpcClient(profile.bundlerUrl)
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        command: 'aa.estimate.probe',
        status: 'estimated',
        canWrite: false,
        verificationLevel: result.verificationLevel,
        accountReadiness: 'not_verified',
        result
      },
      (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2
    )}\n`
  );
} catch (error) {
  const details = describeError(error);
  const remoteRejection = details['code'] === 'rpc_remote_error';
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: remoteRejection,
        command: 'aa.estimate.probe',
        status: remoteRejection ? 'bundler_rejected' : 'probe_failed',
        canWrite: false,
        verificationLevel: 'READONLY_BUNDLER_ESTIMATE',
        accountReadiness: 'not_verified',
        error: details
      },
      null,
      2
    )}\n`
  );
  if (!remoteRejection) process.exitCode = 1;
}
