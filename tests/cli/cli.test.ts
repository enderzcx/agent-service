import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli.js';

describe('agent-service CLI interface', () => {
  it('shows only the explicit Botchain profile and its dry-run-only status', async () => {
    const result = await runCli(['profile', 'show'], {
      environment: { KTRACE_CHAIN_PROFILE: 'botchain_testnet' }
    });

    expect(result.exitCode).toBe(0);
    expect(result.payload).toEqual(
      expect.objectContaining({
        ok: true,
        command: 'profile.show',
        canWrite: false
      })
    );
    const serialized = JSON.stringify(result.payload);
    expect(serialized).toContain('eip155:968');
    expect(serialized).not.toMatch(/kite|hashkey|2368/i);
  });

  it('returns a structured error for missing profile selection', async () => {
    const result = await runCli(['profile', 'show'], { environment: {} });

    expect(result.exitCode).toBe(1);
    expect(result.payload['ok']).toBe(false);
    const error = result.payload['error'] as Readonly<Record<string, unknown>>;
    expect(error['code']).toBe('chain_profile_required');
  });

  it('does not expose any chain-write command', async () => {
    const result = await runCli(['send-user-operation'], {
      environment: { KTRACE_CHAIN_PROFILE: 'botchain_testnet' }
    });

    expect(result.exitCode).toBe(2);
    expect(result.payload['ok']).toBe(false);
    const error = result.payload['error'] as Readonly<Record<string, unknown>>;
    expect(error['code']).toBe('cli_command_unsupported');
  });
});
