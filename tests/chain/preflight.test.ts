import { describe, expect, it } from 'vitest';

import { BOTCHAIN_TESTNET_PROFILE, buildProfileFingerprint } from '../../src/chain/profile.js';
import { preflightChainRuntime, type ReadonlyRpcPort } from '../../src/chain/preflight.js';
import type { ChainPreflightError } from '../../src/chain/preflight.js';

const ADDRESS_CODE = '0x6001600055';
const FINALIZED_BLOCK = { number: '0x10', timestamp: '0x20' };

class FixtureRpc implements ReadonlyRpcPort {
  readonly #responses: Readonly<Record<string, unknown>>;

  constructor(responses: Readonly<Record<string, unknown>>) {
    this.#responses = responses;
  }

  request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    const address = typeof params[0] === 'string' ? params[0].toLowerCase() : '';
    const key = address ? `${method}:${address}` : method;
    const result = this.#responses[key] ?? this.#responses[method];
    if (result === undefined) throw new Error(`Missing fixture response for ${key}`);
    return Promise.resolve(result as T);
  }
}

function createPorts(overrides: Readonly<Record<string, unknown>> = {}): {
  chainRpc: ReadonlyRpcPort;
  bundlerRpc: ReadonlyRpcPort;
} {
  const profile = BOTCHAIN_TESTNET_PROFILE;
  return {
    chainRpc: new FixtureRpc({
      eth_chainId: '0x3c8',
      eth_getCode: ADDRESS_CODE,
      [`eth_getProof:${profile.entryPoint.address.toLowerCase()}`]: {
        codeHash: profile.entryPoint.expectedCodeHash
      },
      [`eth_getProof:${profile.settlementAsset.tokenAddress.toLowerCase()}`]: {
        codeHash: profile.settlementAsset.expectedCodeHash
      },
      eth_call: '0x0000000000000000000000000000000000000000000000000000000000000006',
      eth_getBlockByNumber: FINALIZED_BLOCK,
      ...overrides
    }),
    bundlerRpc: new FixtureRpc({
      eth_chainId: '0x3c8',
      eth_supportedEntryPoints: [profile.entryPoint.address],
      web3_clientVersion: 'skandha/v2.4.4-'
    })
  };
}

describe('ChainRuntime read-only preflight interface', () => {
  it('proves dry-run readiness while keeping write capability false', async () => {
    const ports = createPorts();
    const result = await preflightChainRuntime({
      profile: BOTCHAIN_TESTNET_PROFILE,
      ...ports
    });

    expect(result.status).toBe('ready_for_dry_run');
    expect(result.canWrite).toBe(false);
    expect(result.verificationLevel).toBe('READONLY_RPC');
    expect(result.profileFingerprint).toBe(
      buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE).fingerprint
    );
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it.each([
    ['wrong RPC chain', { eth_chainId: '0x940' }, 'chain_preflight_chain_id_mismatch'],
    ['missing EntryPoint code', { eth_getCode: '0x' }, 'chain_preflight_code_missing'],
    [
      'wrong settlement decimals',
      { eth_call: '0x0000000000000000000000000000000000000000000000000000000000000012' },
      'chain_preflight_decimals_mismatch'
    ]
  ])('fails closed for %s', async (_name, overrides, code) => {
    const ports = createPorts(overrides);

    await expect(
      preflightChainRuntime({ profile: BOTCHAIN_TESTNET_PROFILE, ...ports })
    ).rejects.toEqual(expect.objectContaining<Partial<ChainPreflightError>>({ code }));
  });

  it('fails closed when the bundler does not advertise the locked EntryPoint', async () => {
    const ports = createPorts();
    const bundlerRpc = new FixtureRpc({
      eth_chainId: '0x3c8',
      eth_supportedEntryPoints: ['0x0000000000000000000000000000000000000001'],
      web3_clientVersion: 'skandha/v2.4.4-'
    });

    await expect(
      preflightChainRuntime({
        profile: BOTCHAIN_TESTNET_PROFILE,
        chainRpc: ports.chainRpc,
        bundlerRpc
      })
    ).rejects.toEqual(
      expect.objectContaining({ code: 'chain_preflight_entrypoint_unsupported' })
    );
  });
});
