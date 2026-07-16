import { createHash } from 'node:crypto';

import { z } from 'zod';

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const codeHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS is required');

export const chainProfileSchema = z
  .object({
    runtimeSchemaVersion: z.literal(1),
    id: z.string().min(1),
    displayName: z.string().min(1),
    chainId: z.number().int().positive(),
    caip2: z.string().regex(/^eip155:[1-9][0-9]*$/),
    rpcUrl: httpsUrlSchema,
    bundlerUrl: httpsUrlSchema,
    explorerUrl: httpsUrlSchema,
    finality: z.object({
      blockTag: z.literal('finalized'),
      minimumConfirmations: z.number().int().min(1)
    }),
    entryPoint: z.object({
      version: z.literal('0.7'),
      address: addressSchema,
      expectedCodeHash: codeHashSchema
    }),
    nativeAsset: z.object({
      assetId: z.string().min(1),
      symbol: z.string().min(1),
      decimals: z.number().int().min(0).max(255)
    }),
    settlementAsset: z.object({
      assetId: z.string().min(1),
      symbol: z.string().min(1),
      tokenAddress: addressSchema,
      decimals: z.number().int().min(0).max(255),
      expectedCodeHash: codeHashSchema
    }),
    aa: z.object({
      accountFactoryAddress: addressSchema.nullable(),
      accountImplementationAddress: addressSchema.nullable(),
      ownerUserOperationAllowed: z.literal(false),
      eoaFallbackAllowed: z.literal(false),
      backendSigningAllowed: z.literal(false)
    })
  })
  .strict();

export type ChainRuntimeProfile = Readonly<z.infer<typeof chainProfileSchema>>;

const rawBotchainTestnetProfile = {
  runtimeSchemaVersion: 1,
  id: 'botchain-testnet',
  displayName: 'BOT Chain Testnet',
  chainId: 968,
  caip2: 'eip155:968',
  rpcUrl: 'https://rpc.bohr.life',
  bundlerUrl: 'https://bundler.bohr.life/rpc',
  explorerUrl: 'https://scan.bohr.life',
  finality: {
    blockTag: 'finalized',
    minimumConfirmations: 2
  },
  entryPoint: {
    version: '0.7',
    address: '0x0000000071727de22e5e9d8baf0edac6f37da032',
    expectedCodeHash: '0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58'
  },
  nativeAsset: {
    assetId: 'eip155:968/slip44:60',
    symbol: 'tBOT',
    decimals: 18
  },
  settlementAsset: {
    assetId: 'eip155:968/erc20:0x75edc9335175fc0552d51d48439f229c10420fe3',
    symbol: 'USDT',
    tokenAddress: '0x75edc9335175fc0552d51d48439f229c10420fe3',
    decimals: 6,
    expectedCodeHash: '0x0b70fe4156600e95ec26f02f62ac74c98a9d57758300ebdbdd8ce4477c5d8048'
  },
  aa: {
    accountFactoryAddress: null,
    accountImplementationAddress: null,
    ownerUserOperationAllowed: false,
    eoaFallbackAllowed: false,
    backendSigningAllowed: false
  }
} as const;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
  }
  return value;
}

export const BOTCHAIN_TESTNET_PROFILE: ChainRuntimeProfile = deepFreeze(
  chainProfileSchema.parse(rawBotchainTestnetProfile)
);

const PROFILE_ALIASES = new Set([
  'botchain_testnet',
  'botchain-testnet',
  'botchain',
  '968',
  'eip155:968'
]);

const LEGACY_CHAIN_VARIABLE = /^(?:KITE|HASHKEY)_/;

type Environment = Readonly<Record<string, string | undefined>>;

export class ChainProfileError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'ChainProfileError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value: string | undefined): string {
  return String(value ?? '').trim();
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function assertNoLegacyVariables(environment: Environment): void {
  const legacyVariables = Object.entries(environment)
    .filter(([name, value]) => LEGACY_CHAIN_VARIABLE.test(name) && normalizeText(value).length > 0)
    .map(([name]) => name)
    .sort();

  if (legacyVariables.length > 0) {
    throw new ChainProfileError(
      `Legacy chain variables are forbidden: ${legacyVariables.join(', ')}`,
      'legacy_chain_environment_forbidden',
      { variables: legacyVariables }
    );
  }
}

function assertLockedOverrides(environment: Environment): void {
  const lockedValues: ReadonlyArray<{
    name: string;
    expected: string | null;
    normalize: (value: string) => string;
  }> = [
    { name: 'KTRACE_RPC_URL', expected: BOTCHAIN_TESTNET_PROFILE.rpcUrl, normalize: normalizeUrl },
    {
      name: 'KTRACE_BUNDLER_URL',
      expected: BOTCHAIN_TESTNET_PROFILE.bundlerUrl,
      normalize: normalizeUrl
    },
    {
      name: 'KTRACE_EXPLORER_URL',
      expected: BOTCHAIN_TESTNET_PROFILE.explorerUrl,
      normalize: normalizeUrl
    },
    {
      name: 'KTRACE_ENTRYPOINT_ADDRESS',
      expected: BOTCHAIN_TESTNET_PROFILE.entryPoint.address,
      normalize: normalizeAddress
    },
    {
      name: 'KTRACE_SETTLEMENT_TOKEN_ADDRESS',
      expected: BOTCHAIN_TESTNET_PROFILE.settlementAsset.tokenAddress,
      normalize: normalizeAddress
    },
    {
      name: 'KTRACE_SETTLEMENT_TOKEN_DECIMALS',
      expected: String(BOTCHAIN_TESTNET_PROFILE.settlementAsset.decimals),
      normalize: normalizeText
    },
    {
      name: 'KTRACE_AA_FACTORY_ADDRESS',
      expected: BOTCHAIN_TESTNET_PROFILE.aa.accountFactoryAddress,
      normalize: normalizeAddress
    },
    {
      name: 'KTRACE_AA_ACCOUNT_IMPLEMENTATION',
      expected: BOTCHAIN_TESTNET_PROFILE.aa.accountImplementationAddress,
      normalize: normalizeAddress
    }
  ];

  for (const field of lockedValues) {
    const configured = normalizeText(environment[field.name]);
    if (!configured) continue;
    if (field.expected !== null && field.normalize(configured) === field.normalize(field.expected)) {
      continue;
    }
    throw new ChainProfileError(
      `${field.name} does not match the locked Botchain testnet profile.`,
      'chain_profile_locked_override',
      { source: field.name, value: configured, expected: field.expected }
    );
  }
}

export function resolveRuntimeProfile(environment: Environment): ChainRuntimeProfile {
  assertNoLegacyVariables(environment);

  const selector = normalizeText(environment['KTRACE_CHAIN_PROFILE']).toLowerCase();
  if (!selector) {
    throw new ChainProfileError(
      'KTRACE_CHAIN_PROFILE is required; no implicit chain default exists.',
      'chain_profile_required'
    );
  }
  if (!PROFILE_ALIASES.has(selector)) {
    throw new ChainProfileError(
      `Unsupported chain runtime profile: ${selector}`,
      'chain_profile_unsupported',
      { selector, supportedProfiles: [BOTCHAIN_TESTNET_PROFILE.id] }
    );
  }

  const configuredChainId = normalizeText(environment['KTRACE_CHAIN_ID']);
  if (configuredChainId && configuredChainId !== String(BOTCHAIN_TESTNET_PROFILE.chainId)) {
    throw new ChainProfileError(
      `KTRACE_CHAIN_ID=${configuredChainId} conflicts with ${selector}.`,
      'chain_profile_conflict',
      { selector, configuredChainId, expectedChainId: BOTCHAIN_TESTNET_PROFILE.chainId }
    );
  }

  assertLockedOverrides(environment);
  return BOTCHAIN_TESTNET_PROFILE;
}

function fingerprintPayload(profile: ChainRuntimeProfile): Readonly<Record<string, unknown>> {
  return {
    runtimeSchemaVersion: profile.runtimeSchemaVersion,
    id: profile.id,
    chainId: profile.chainId,
    caip2: profile.caip2,
    rpcUrl: normalizeUrl(profile.rpcUrl),
    bundlerUrl: normalizeUrl(profile.bundlerUrl),
    explorerUrl: normalizeUrl(profile.explorerUrl),
    entryPoint: {
      version: profile.entryPoint.version,
      address: normalizeAddress(profile.entryPoint.address),
      expectedCodeHash: profile.entryPoint.expectedCodeHash.toLowerCase()
    },
    settlementAsset: {
      assetId: profile.settlementAsset.assetId.toLowerCase(),
      tokenAddress: normalizeAddress(profile.settlementAsset.tokenAddress),
      decimals: profile.settlementAsset.decimals,
      expectedCodeHash: profile.settlementAsset.expectedCodeHash.toLowerCase()
    },
    aa: {
      accountFactoryAddress: profile.aa.accountFactoryAddress,
      accountImplementationAddress: profile.aa.accountImplementationAddress,
      ownerUserOperationAllowed: profile.aa.ownerUserOperationAllowed,
      eoaFallbackAllowed: profile.aa.eoaFallbackAllowed,
      backendSigningAllowed: profile.aa.backendSigningAllowed
    }
  };
}

export interface ProfileFingerprint {
  readonly fingerprint: `sha256:${string}`;
  readonly namespace: string;
}

export function buildProfileFingerprint(profile: ChainRuntimeProfile): ProfileFingerprint {
  const parsed = chainProfileSchema.parse(profile);
  const digest = createHash('sha256')
    .update(JSON.stringify(fingerprintPayload(parsed)))
    .digest('hex');

  return Object.freeze({
    fingerprint: `sha256:${digest}`,
    namespace: `${parsed.id}-${parsed.chainId}-${digest.slice(0, 16)}`
  });
}
