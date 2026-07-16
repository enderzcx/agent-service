import { describe, expect, it } from 'vitest';

import {
  attachSessionSignature,
  buildAccountInitCode,
  buildSessionCall,
  buildSessionTokenTransferCall,
  createSessionUserOperationDraft,
  estimateSessionUserOperation,
  type SessionBundlerRpc
} from '../../src/aa/session.js';
import { BOTCHAIN_TESTNET_PROFILE } from '../../src/chain/profile.js';
import { createAssetAmount, parseAssetAmount } from '../../src/money/amount.js';
import { createDenyAllWriteGate } from '../../src/security/writeGate.js';

const SESSION_ID = `0x${'11'.repeat(32)}` as const;
const ACTION_ID = `0x${'22'.repeat(32)}` as const;
const ACCOUNT = '0x1000000000000000000000000000000000000001';
const FACTORY = '0x2000000000000000000000000000000000000002';
const OWNER = '0x3000000000000000000000000000000000000003';
const RECIPIENT = '0x4000000000000000000000000000000000000004';
const SETTLEMENT_ASSET = {
  assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId,
  decimals: BOTCHAIN_TESTNET_PROFILE.settlementAsset.decimals
} as const;

function settlementAmount(value: string) {
  return parseAssetAmount(value, SETTLEMENT_ASSET);
}

describe('SessionAA public seam', () => {
  it('builds only the dedicated Botchain token-transfer account call', () => {
    const operation = buildSessionTokenTransferCall({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sessionId: SESSION_ID,
      recipient: RECIPIENT,
      amount: settlementAmount('1.25'),
      actionId: ACTION_ID
    });

    expect(operation.kind).toBe('session-token-transfer');
    expect(operation.callData.startsWith('0x625b938b')).toBe(true);
    expect(operation.callData.toLowerCase()).toContain(
      BOTCHAIN_TESTNET_PROFILE.settlementAsset.tokenAddress.slice(2).toLowerCase()
    );
    expect(operation.canWrite).toBe(false);
  });

  it('builds a selector-bounded generic call and rejects malformed authority inputs', () => {
    const operation = buildSessionCall({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sessionId: SESSION_ID,
      target: RECIPIENT,
      data: '0x12345678',
      actionId: ACTION_ID
    });

    expect(operation.callData.startsWith('0x18fbe038')).toBe(true);
    expect(() =>
      buildSessionTokenTransferCall({
        profile: BOTCHAIN_TESTNET_PROFILE,
        sessionId: '0x1234',
        recipient: RECIPIENT,
        amount: settlementAmount('0.000001'),
        actionId: ACTION_ID
      })
    ).toThrowError(expect.objectContaining({ code: 'aa_bytes32_invalid' }));
    expect(() =>
      buildSessionTokenTransferCall({
        profile: BOTCHAIN_TESTNET_PROFILE,
        sessionId: SESSION_ID,
        recipient: RECIPIENT,
        amount: createAssetAmount(
          {
            assetId: BOTCHAIN_TESTNET_PROFILE.nativeAsset.assetId,
            decimals: BOTCHAIN_TESTNET_PROFILE.nativeAsset.decimals
          },
          1n
        ),
        actionId: ACTION_ID
      })
    ).toThrowError(expect.objectContaining({ code: 'aa_settlement_asset_mismatch' }));
    expect(() =>
      buildSessionTokenTransferCall({
        profile: BOTCHAIN_TESTNET_PROFILE,
        sessionId: SESSION_ID,
        recipient: RECIPIENT,
        amount: createAssetAmount(
          { assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId, decimals: 18 },
          1_000_000_000_000_000_000n
        ),
        actionId: ACTION_ID
      })
    ).toThrowError(expect.objectContaining({ code: 'aa_settlement_asset_mismatch' }));
    expect(() =>
      buildSessionCall({
        profile: BOTCHAIN_TESTNET_PROFILE,
        sessionId: SESSION_ID,
        target: RECIPIENT,
        data: '0x12',
        actionId: ACTION_ID
      })
    ).toThrowError(expect.objectContaining({ code: 'aa_call_data_invalid' }));
  });

  it('builds direct CREATE2 factory initCode without an implementation address', () => {
    const initCode = buildAccountInitCode({ factoryAddress: FACTORY, owner: OWNER, salt: 7n });

    expect(initCode.startsWith(`${FACTORY.toLowerCase()}5fbfb9cf`)).toBe(true);
  });

  it('serializes a read-only bundler estimate and never exposes a send path', async () => {
    const operation = buildSessionTokenTransferCall({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sessionId: SESSION_ID,
      recipient: RECIPIENT,
      amount: settlementAmount('1.25'),
      actionId: ACTION_ID
    });
    const draft = createSessionUserOperationDraft({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sender: ACCOUNT,
      nonce: 0n,
      initCode: buildAccountInitCode({ factoryAddress: FACTORY, owner: OWNER, salt: 7n }),
      operation
    });
    const methods: string[] = [];
    const requestParams: (readonly unknown[])[] = [];
    const bundlerRpc: SessionBundlerRpc = {
      request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
        methods.push(method);
        requestParams.push(params);
        return Promise.resolve({
          callGasLimit: '0x186a0',
          verificationGasLimit: '0x30d40',
          preVerificationGas: '0xc350'
        } as T);
      }
    };

    const result = await estimateSessionUserOperation({
      draft,
      bundlerRpc
    });

    expect(methods).toEqual(['eth_estimateUserOperationGas']);
    expect(String(requestParams[0]?.[1]).toLowerCase()).toBe(
      BOTCHAIN_TESTNET_PROFILE.entryPoint.address
    );
    const rpcOperation = requestParams[0]?.[0] as Readonly<Record<string, unknown>>;
    expect(rpcOperation['factory']).toBe(FACTORY);
    expect(String(rpcOperation['factoryData'])).toMatch(/^0x5fbfb9cf/);
    expect(rpcOperation).not.toHaveProperty('initCode');
    expect(rpcOperation).not.toHaveProperty('paymasterAndData');
    expect(result).toEqual(
      expect.objectContaining({
        status: 'estimated',
        canWrite: false,
        verificationLevel: 'READONLY_BUNDLER_ESTIMATE',
        gas: {
          callGasLimit: 100_000n,
          verificationGasLimit: 200_000n,
          preVerificationGas: 50_000n
        }
      })
    );
  });

  it('requires a real-length session signature and denies every submission intent', () => {
    const operation = buildSessionCall({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sessionId: SESSION_ID,
      target: RECIPIENT,
      data: '0x12345678',
      actionId: ACTION_ID
    });
    const draft = createSessionUserOperationDraft({
      profile: BOTCHAIN_TESTNET_PROFILE,
      sender: ACCOUNT,
      nonce: 0n,
      operation
    });

    expect(() => attachSessionSignature(draft, '0x1234')).toThrowError(
      expect.objectContaining({ code: 'aa_signature_invalid' })
    );
    expect(() =>
      attachSessionSignature(draft, `0x${'11'.repeat(64)}`)
    ).toThrowError(expect.objectContaining({ code: 'aa_signature_invalid' }));
    expect(() => draft.assertSubmissionAllowed(createDenyAllWriteGate())).toThrowError(
      expect.objectContaining({ code: 'chain_write_not_authorized' })
    );
  });
});
