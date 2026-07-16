import { describe, expect, it } from 'vitest';

import { buildProfileFingerprint, BOTCHAIN_TESTNET_PROFILE } from '../../src/chain/profile.js';
import { createDenyAllWriteGate } from '../../src/security/writeGate.js';
import type { ChainWriteDeniedError } from '../../src/security/writeGate.js';

describe('global WriteGate interface', () => {
  it.each([
    'bundler.sendUserOperation',
    'rpc.sendRawTransaction',
    'contract.deploy',
    'contract.configure',
    'token.approve',
    'token.transfer',
    'bridge.deposit'
  ] as const)('denies %s without an Owner-issued capability', (action) => {
    const gate = createDenyAllWriteGate();

    expect(() =>
      gate.assertAllowed({
        action,
        profileFingerprint: buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE).fingerprint
      })
    ).toThrowError(
      expect.objectContaining<Partial<ChainWriteDeniedError>>({
        code: 'chain_write_not_authorized'
      })
    );
  });
});
