#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { buildProfileFingerprint, resolveRuntimeProfile } from './chain/profile.js';
import { preflightChainRuntime, type ReadonlyRpcPort } from './chain/preflight.js';
import { HttpJsonRpcClient } from './chain/rpc.js';

type Environment = Readonly<Record<string, string | undefined>>;

interface CliDependencies {
  readonly environment?: Environment;
  readonly chainRpc?: ReadonlyRpcPort;
  readonly bundlerRpc?: ReadonlyRpcPort;
  readonly now?: () => Date;
}

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly payload: Readonly<Record<string, unknown>>;
}

function errorPayload(error: unknown): Readonly<Record<string, unknown>> {
  if (error && typeof error === 'object') {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly details?: unknown;
    };
    const code = typeof candidate.code === 'string' ? candidate.code : 'unexpected_error';
    const message =
      typeof candidate.message === 'string' ? candidate.message : 'Unexpected error';
    return {
      ok: false,
      error: {
        code,
        message,
        details:
          candidate.details && typeof candidate.details === 'object' ? candidate.details : {}
      }
    };
  }
  return {
    ok: false,
    error: {
      code: 'unexpected_error',
      message: String(error),
      details: {}
    }
  };
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {}
): Promise<CliResult> {
  const environment = dependencies.environment ?? process.env;
  const command = argv.join(' ').trim();

  if (command !== 'profile show' && command !== 'preflight') {
    return {
      exitCode: 2,
      payload: {
        ok: false,
        error: {
          code: 'cli_command_unsupported',
          message: `Unsupported command: ${command || '(empty)'}`,
          details: { supportedCommands: ['profile show', 'preflight'] }
        }
      }
    };
  }

  try {
    const profile = resolveRuntimeProfile(environment);
    const profileIdentity = buildProfileFingerprint(profile);

    if (command === 'profile show') {
      return {
        exitCode: 0,
        payload: {
          ok: true,
          command: 'profile.show',
          canWrite: false,
          verificationLevel: 'LOCAL_UNIT',
          profile,
          ...profileIdentity
        }
      };
    }

    const chainRpc = dependencies.chainRpc ?? new HttpJsonRpcClient(profile.rpcUrl);
    const bundlerRpc = dependencies.bundlerRpc ?? new HttpJsonRpcClient(profile.bundlerUrl);
    const preflightInput = {
      profile,
      chainRpc,
      bundlerRpc,
      ...(dependencies.now ? { now: dependencies.now } : {})
    };
    const result = await preflightChainRuntime(preflightInput);
    return {
      exitCode: 0,
      payload: { ok: true, command: 'preflight', result }
    };
  } catch (error) {
    return { exitCode: 1, payload: errorPayload(error) };
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
