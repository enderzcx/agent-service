import { describe, expect, it } from 'vitest';

import {
  BOTCHAIN_TESTNET_PROFILE,
  buildProfileFingerprint,
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
    expect(first.namespace).toMatch(/^botchain-testnet-968-[a-f0-9]{16}$/);
  });
});
