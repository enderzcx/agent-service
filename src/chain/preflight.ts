import { buildProfileFingerprint, type ChainRuntimeProfile } from './profile.js';
import type { VerificationLevel } from '../kernel/verification.js';

export interface ReadonlyRpcPort {
  request<T = unknown>(method: string, params?: readonly unknown[]): Promise<T>;
}

export class ChainPreflightError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'ChainPreflightError';
    this.code = code;
    this.details = details;
  }
}

export interface PreflightCheck {
  readonly id: string;
  readonly status: 'pass';
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ChainPreflightResult {
  readonly status: 'ready_for_dry_run';
  readonly canWrite: false;
  readonly verificationLevel: Extract<VerificationLevel, 'READONLY_RPC'>;
  readonly profileFingerprint: string;
  readonly namespace: string;
  readonly observedAt: string;
  readonly checks: readonly PreflightCheck[];
}

interface ChainPreflightInput {
  readonly profile: ChainRuntimeProfile;
  readonly chainRpc: ReadonlyRpcPort;
  readonly bundlerRpc: ReadonlyRpcPort;
  readonly now?: () => Date;
}

interface AccountProof {
  readonly codeHash?: unknown;
}

interface FinalizedBlock {
  readonly number?: unknown;
  readonly timestamp?: unknown;
}

function parseHexQuantity(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new ChainPreflightError(
      `${label} returned an invalid hex quantity.`,
      'chain_preflight_invalid_response',
      { label, value }
    );
  }
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed)) {
    throw new ChainPreflightError(
      `${label} exceeded the safe integer range.`,
      'chain_preflight_invalid_response',
      { label, value }
    );
  }
  return parsed;
}

function requireCode(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value) || value === '0x') {
    throw new ChainPreflightError(
      `${label} has no runtime bytecode.`,
      'chain_preflight_code_missing',
      { label }
    );
  }
  return value;
}

function requireCodeHash(proof: AccountProof, expected: string, label: string): string {
  const actual = typeof proof.codeHash === 'string' ? proof.codeHash.toLowerCase() : '';
  if (actual !== expected.toLowerCase()) {
    throw new ChainPreflightError(
      `${label} code hash does not match the locked profile.`,
      'chain_preflight_code_hash_mismatch',
      { label, actual, expected }
    );
  }
  return actual;
}

function assertChainId(actualHex: unknown, expected: number, source: string): number {
  const actual = parseHexQuantity(actualHex, `${source} eth_chainId`);
  if (actual !== expected) {
    throw new ChainPreflightError(
      `${source} chain ID ${actual} does not match ${expected}.`,
      'chain_preflight_chain_id_mismatch',
      { source, actual, expected }
    );
  }
  return actual;
}

export async function preflightChainRuntime(
  input: ChainPreflightInput
): Promise<ChainPreflightResult> {
  const { profile, chainRpc, bundlerRpc } = input;
  const [
    rpcChainIdHex,
    bundlerChainIdHex,
    entryPointCodeResult,
    settlementCodeResult,
    entryPointProof,
    settlementProof,
    settlementDecimalsHex,
    finalizedBlock,
    supportedEntryPoints,
    bundlerClientVersion
  ] = await Promise.all([
    chainRpc.request('eth_chainId'),
    bundlerRpc.request('eth_chainId'),
    chainRpc.request('eth_getCode', [profile.entryPoint.address, 'latest']),
    chainRpc.request('eth_getCode', [profile.settlementAsset.tokenAddress, 'latest']),
    chainRpc.request<AccountProof>('eth_getProof', [profile.entryPoint.address, [], 'latest']),
    chainRpc.request<AccountProof>('eth_getProof', [
      profile.settlementAsset.tokenAddress,
      [],
      'latest'
    ]),
    chainRpc.request('eth_call', [
      { to: profile.settlementAsset.tokenAddress, data: '0x313ce567' },
      'latest'
    ]),
    chainRpc.request<FinalizedBlock>('eth_getBlockByNumber', [profile.finality.blockTag, false]),
    bundlerRpc.request<readonly string[]>('eth_supportedEntryPoints'),
    bundlerRpc.request<string>('web3_clientVersion')
  ]);

  const rpcChainId = assertChainId(rpcChainIdHex, profile.chainId, 'RPC');
  const bundlerChainId = assertChainId(bundlerChainIdHex, profile.chainId, 'Bundler');
  const entryPointCode = requireCode(entryPointCodeResult, 'EntryPoint');
  const settlementCode = requireCode(settlementCodeResult, 'Settlement asset');
  const entryPointCodeHash = requireCodeHash(
    entryPointProof,
    profile.entryPoint.expectedCodeHash,
    'EntryPoint'
  );
  const settlementCodeHash = requireCodeHash(
    settlementProof,
    profile.settlementAsset.expectedCodeHash,
    'Settlement asset'
  );
  const settlementDecimals = parseHexQuantity(
    settlementDecimalsHex,
    'Settlement asset decimals()'
  );
  if (settlementDecimals !== profile.settlementAsset.decimals) {
    throw new ChainPreflightError(
      `Settlement asset decimals ${settlementDecimals} do not match ${profile.settlementAsset.decimals}.`,
      'chain_preflight_decimals_mismatch',
      { actual: settlementDecimals, expected: profile.settlementAsset.decimals }
    );
  }

  const normalizedEntryPoint = profile.entryPoint.address.toLowerCase();
  const advertisedEntryPoints = Array.isArray(supportedEntryPoints)
    ? supportedEntryPoints.map((value) => String(value).toLowerCase())
    : [];
  if (!advertisedEntryPoints.includes(normalizedEntryPoint)) {
    throw new ChainPreflightError(
      'Bundler does not advertise the locked EntryPoint.',
      'chain_preflight_entrypoint_unsupported',
      { expected: normalizedEntryPoint, advertised: advertisedEntryPoints }
    );
  }
  if (!finalizedBlock || typeof finalizedBlock.number !== 'string') {
    throw new ChainPreflightError(
      'RPC did not return a finalized block.',
      'chain_preflight_finality_unavailable'
    );
  }

  const fingerprint = buildProfileFingerprint(profile);
  const checks: readonly PreflightCheck[] = Object.freeze([
    {
      id: 'rpc-chain-id',
      status: 'pass',
      evidence: { chainId: rpcChainId }
    },
    {
      id: 'bundler-chain-id',
      status: 'pass',
      evidence: { chainId: bundlerChainId, clientVersion: bundlerClientVersion }
    },
    {
      id: 'entrypoint-v0.7',
      status: 'pass',
      evidence: {
        address: profile.entryPoint.address,
        codeBytes: (entryPointCode.length - 2) / 2,
        codeHash: entryPointCodeHash
      }
    },
    {
      id: 'settlement-asset',
      status: 'pass',
      evidence: {
        assetId: profile.settlementAsset.assetId,
        codeBytes: (settlementCode.length - 2) / 2,
        codeHash: settlementCodeHash,
        decimals: settlementDecimals
      }
    },
    {
      id: 'finalized-block',
      status: 'pass',
      evidence: { number: finalizedBlock.number, timestamp: finalizedBlock.timestamp }
    }
  ]);

  return Object.freeze({
    status: 'ready_for_dry_run',
    canWrite: false,
    verificationLevel: 'READONLY_RPC',
    profileFingerprint: fingerprint.fingerprint,
    namespace: fingerprint.namespace,
    observedAt: (input.now ?? (() => new Date()))().toISOString(),
    checks
  });
}
