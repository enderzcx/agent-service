import { describe, expect, it } from 'vitest';

import {
  BOTCHAIN_TESTNET_PROFILE,
  buildProfileFingerprint,
  chainProfileSchema,
  resolveRuntimeProfile
} from '../../src/chain/profile.js';
import type { ChainProfileError } from '../../src/chain/profile.js';

describe('ChainRuntime profile interface', () => {
  it('requires an explicit supported profile selector', () => {
    expect(() => resolveRuntimeProfile({})).toThrowError(
      expect.objectContaining<Partial<ChainProfileError>>({ code: 'chain_profile_required' })
    );
    expect(() => resolveRuntimeProfile({ KTRACE_CHAIN_PROFILE: 'unknown' })).toThrowError(
      expect.objectContaining<Partial<ChainProfileError>>({ code: 'chain_profile_unsupported' })
    );
  });

  it('resolves the locked Botchain testnet identity without legacy defaults', () => {
    const profile = resolveRuntimeProfile({ KTRACE_CHAIN_PROFILE: 'botchain_testnet' });

    expect(profile).toEqual(BOTCHAIN_TESTNET_PROFILE);
    expect(profile.chainId).toBe(968);
    expect(profile.caip2).toBe('eip155:968');
    expect(profile.entryPoint.version).toBe('0.7');
    expect(profile.settlementAsset.decimals).toBe(6);
    expect(profile.aa.accountFactoryAddress).toBeNull();
    expect(profile.aa.accountImplementationAddress).toBeNull();
  });

  it('rejects conflicting selectors, locked overrides, and legacy chain variables', () => {
    expect(() =>
      resolveRuntimeProfile({
        KTRACE_CHAIN_PROFILE: 'botchain_testnet',
        KTRACE_CHAIN_ID: '2368'
      })
    ).toThrowError(expect.objectContaining({ code: 'chain_profile_conflict' }));

    expect(() =>
      resolveRuntimeProfile({
        KTRACE_CHAIN_PROFILE: 'botchain_testnet',
        KTRACE_RPC_URL: 'https://rpc-testnet.gokite.ai'
      })
    ).toThrowError(expect.objectContaining({ code: 'chain_profile_locked_override' }));

    expect(() =>
      resolveRuntimeProfile({
        KTRACE_CHAIN_PROFILE: 'botchain_testnet',
        KITE_CHAIN_ID: '968'
      })
    ).toThrowError(expect.objectContaining({ code: 'legacy_chain_environment_forbidden' }));
  });

  it('builds a deterministic fingerprint and a fingerprint-scoped namespace', () => {
    const first = buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE);
    const second = buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE);

    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.namespace).toMatch(/^botchain-testnet-968-sha256-[a-f0-9]{64}$/);
    expect(first.namespace.endsWith(first.fingerprint.replace(':', '-'))).toBe(true);
  });

  it('rejects profile ids that could escape a physical namespace', () => {
    const result = chainProfileSchema.safeParse({
      ...BOTCHAIN_TESTNET_PROFILE,
      id: '../escape'
    });

    expect(result.success).toBe(false);
  });

  it('rejects chain metadata and AA deployment identities that are internally mixed', () => {
    expect(
      chainProfileSchema.safeParse({
        ...BOTCHAIN_TESTNET_PROFILE,
        caip2: 'eip155:1'
      }).success
    ).toBe(false);
    expect(
      chainProfileSchema.safeParse({
        ...BOTCHAIN_TESTNET_PROFILE,
        settlementAsset: {
          ...BOTCHAIN_TESTNET_PROFILE.settlementAsset,
          assetId: BOTCHAIN_TESTNET_PROFILE.settlementAsset.assetId.replace(
            'eip155:968',
            'eip155:1'
          )
        }
      }).success
    ).toBe(false);
    expect(
      chainProfileSchema.safeParse({
        ...BOTCHAIN_TESTNET_PROFILE,
        aa: {
          ...BOTCHAIN_TESTNET_PROFILE.aa,
          accountFactoryAddress: '0x0000000000000000000000000000000000000001'
        }
      }).success
    ).toBe(false);
  });

  it('binds finality and native-asset policy into the full profile fingerprint', () => {
    const changedFinality = chainProfileSchema.parse({
      ...BOTCHAIN_TESTNET_PROFILE,
      finality: { ...BOTCHAIN_TESTNET_PROFILE.finality, minimumConfirmations: 3 }
    });
    const changedNativeAsset = chainProfileSchema.parse({
      ...BOTCHAIN_TESTNET_PROFILE,
      nativeAsset: { ...BOTCHAIN_TESTNET_PROFILE.nativeAsset, symbol: 'BOT' }
    });
    const baseline = buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE).fingerprint;

    expect(buildProfileFingerprint(changedFinality).fingerprint).not.toBe(baseline);
    expect(buildProfileFingerprint(changedNativeAsset).fingerprint).not.toBe(baseline);
  });
});
