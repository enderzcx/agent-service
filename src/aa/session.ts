import {
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  size,
  toHex,
  type Address,
  type Hex
} from 'viem';

import { buildProfileFingerprint, type ChainRuntimeProfile } from '../chain/profile.js';
import type { VerificationLevel } from '../kernel/verification.js';
import {
  createAssetAmount,
  deserializeAssetAmount,
  serializeAssetAmount,
  type AssetAmount,
  type SerializedAssetAmount
} from '../money/amount.js';
import type { WriteGate } from '../security/writeGate.js';

const SESSION_ACCOUNT_ABI = parseAbi([
  'function executeTokenTransfer(bytes32 sessionId,address token,address recipient,uint256 amount,bytes32 actionId)',
  'function executeCall(bytes32 sessionId,address target,bytes data,bytes32 actionId)'
] as const);

const SESSION_FACTORY_ABI = parseAbi([
  'function createAccount(address owner,uint256 salt) returns (address account)'
] as const);

const DUMMY_SESSION_SIGNATURE = `0x${'00'.repeat(64)}1b` as Hex;
const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const ZERO_ADDRESS_PATTERN = /^0x0{40}$/i;

export interface SessionBundlerRpc {
  request<T = unknown>(method: string, params?: readonly unknown[]): Promise<T>;
}

export class SessionAAError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'SessionAAError';
    this.code = code;
    this.details = details;
  }
}

interface SessionAuthorityInput {
  readonly profile: ChainRuntimeProfile;
  readonly sessionId: Hex;
  readonly actionId: Hex;
}

export interface SessionOperation {
  readonly kind: 'session-token-transfer' | 'session-call';
  readonly sessionId: Hex;
  readonly actionId: Hex;
  readonly callData: Hex;
  readonly settlement: SerializedAssetAmount | null;
  readonly profileFingerprint: string;
  readonly canWrite: false;
  readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
}

interface BuildTokenTransferInput extends SessionAuthorityInput {
  readonly recipient: Address;
  readonly amount: AssetAmount;
}

interface BuildSessionCallInput extends SessionAuthorityInput {
  readonly target: Address;
  readonly data: Hex;
}

interface BuildAccountInitCodeInput {
  readonly factoryAddress: Address;
  readonly owner: Address;
  readonly salt: bigint;
}

export interface PackedUserOperationV07 {
  readonly sender: Address;
  readonly nonce: bigint;
  readonly initCode: Hex;
  readonly callData: Hex;
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly paymasterAndData: Hex;
  readonly signature: Hex;
}

interface CreateDraftInput {
  readonly profile: ChainRuntimeProfile;
  readonly sender: Address;
  readonly nonce: bigint;
  readonly initCode?: Hex;
  readonly operation: SessionOperation;
  readonly callGasLimit?: bigint;
  readonly verificationGasLimit?: bigint;
  readonly preVerificationGas?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
}

export interface SessionUserOperationDraft {
  readonly userOperation: PackedUserOperationV07;
  readonly profileFingerprint: string;
  readonly entryPointAddress: Address;
  readonly canWrite: false;
  readonly verificationLevel: Extract<VerificationLevel, 'DRY_RUN_SIMULATED'>;
  assertSubmissionAllowed(writeGate: WriteGate): never;
}

interface EstimateInput {
  readonly draft: SessionUserOperationDraft;
  readonly bundlerRpc: SessionBundlerRpc;
}

interface BundlerEstimateResponse {
  readonly callGasLimit?: unknown;
  readonly verificationGasLimit?: unknown;
  readonly preVerificationGas?: unknown;
}

export interface SessionGasEstimate {
  readonly status: 'estimated';
  readonly canWrite: false;
  readonly verificationLevel: Extract<VerificationLevel, 'READONLY_BUNDLER_ESTIMATE'>;
  readonly gas: {
    readonly callGasLimit: bigint;
    readonly verificationGasLimit: bigint;
    readonly preVerificationGas: bigint;
  };
}

function assertSessionProfile(profile: ChainRuntimeProfile): void {
  if (
    profile.aa.deploymentStrategy !== 'direct-create2' ||
    profile.aa.ownerUserOperationAllowed ||
    profile.aa.eoaFallbackAllowed ||
    profile.aa.backendSigningAllowed ||
    profile.aa.nativeValueExecutionAllowed
  ) {
    throw new SessionAAError(
      'Runtime profile does not permit the session-only direct CREATE2 account.',
      'aa_profile_policy_mismatch'
    );
  }
}

function assertBytes32(value: Hex, label: string): void {
  if (!BYTES32_PATTERN.test(value)) {
    throw new SessionAAError(`${label} must be a 32-byte hex value.`, 'aa_bytes32_invalid', {
      label,
      value
    });
  }
}

function assertSessionAuthority(input: SessionAuthorityInput): void {
  assertSessionProfile(input.profile);
  assertBytes32(input.sessionId, 'sessionId');
  assertBytes32(input.actionId, 'actionId');
  if (/^0x0{64}$/i.test(input.actionId)) {
    throw new SessionAAError('actionId cannot be zero.', 'aa_action_id_invalid');
  }
}

function requireAddress(value: string, label: string): Address {
  if (!isAddress(value, { strict: true })) {
    throw new SessionAAError(`${label} must be an EVM address.`, 'aa_address_invalid', {
      label,
      value
    });
  }
  return getAddress(value);
}

function requireNonZeroAddress(value: string, label: string): Address {
  const address = requireAddress(value, label);
  if (ZERO_ADDRESS_PATTERN.test(address)) {
    throw new SessionAAError(`${label} cannot be the zero address.`, 'aa_address_invalid', {
      label,
      value
    });
  }
  return address;
}

function baseOperation(
  input: SessionAuthorityInput,
  kind: SessionOperation['kind'],
  callData: Hex,
  settlement: SerializedAssetAmount | null = null
): SessionOperation {
  assertSessionAuthority(input);
  return Object.freeze({
    kind,
    sessionId: input.sessionId,
    actionId: input.actionId,
    callData,
    settlement,
    profileFingerprint: buildProfileFingerprint(input.profile).fingerprint,
    canWrite: false,
    verificationLevel: 'DRY_RUN_SIMULATED'
  });
}

export function buildSessionTokenTransferCall(
  input: BuildTokenTransferInput
): SessionOperation {
  assertSessionAuthority(input);
  const recipient = requireNonZeroAddress(input.recipient, 'recipient');
  const amount = createAssetAmount(input.amount, input.amount.raw);
  if (
    amount.assetId !== input.profile.settlementAsset.assetId.toLowerCase() ||
    amount.decimals !== input.profile.settlementAsset.decimals
  ) {
    throw new SessionAAError(
      'Session token transfers require the locked settlement asset and decimals.',
      'aa_settlement_asset_mismatch',
      {
        expected: {
          assetId: input.profile.settlementAsset.assetId,
          decimals: input.profile.settlementAsset.decimals
        },
        actual: { assetId: amount.assetId, decimals: amount.decimals }
      }
    );
  }
  if (amount.raw <= 0n) {
    throw new SessionAAError('Settlement amount must be positive.', 'aa_amount_invalid', {
      raw: amount.raw.toString()
    });
  }
  const token = requireNonZeroAddress(
    input.profile.settlementAsset.tokenAddress,
    'settlement token'
  );
  const callData = encodeFunctionData({
    abi: SESSION_ACCOUNT_ABI,
    functionName: 'executeTokenTransfer',
    args: [input.sessionId, token, recipient, amount.raw, input.actionId]
  });
  return baseOperation(input, 'session-token-transfer', callData, serializeAssetAmount(amount));
}

export function buildSessionCall(input: BuildSessionCallInput): SessionOperation {
  assertSessionAuthority(input);
  const target = requireNonZeroAddress(input.target, 'target');
  if (!isHex(input.data) || size(input.data) < 4) {
    throw new SessionAAError(
      'Session call data must contain at least a four-byte selector.',
      'aa_call_data_invalid'
    );
  }
  const callData = encodeFunctionData({
    abi: SESSION_ACCOUNT_ABI,
    functionName: 'executeCall',
    args: [input.sessionId, target, input.data, input.actionId]
  });
  return baseOperation(input, 'session-call', callData);
}

export function buildAccountInitCode(input: BuildAccountInitCodeInput): Hex {
  const factory = requireNonZeroAddress(input.factoryAddress, 'factoryAddress');
  const owner = requireNonZeroAddress(input.owner, 'owner');
  if (input.salt < 0n) {
    throw new SessionAAError('Factory salt cannot be negative.', 'aa_salt_invalid');
  }
  const factoryCall = encodeFunctionData({
    abi: SESSION_FACTORY_ABI,
    functionName: 'createAccount',
    args: [owner, input.salt]
  });
  return concatHex([factory.toLowerCase() as Address, factoryCall]);
}

function invalidOperation(
  message: string,
  details: Readonly<Record<string, unknown>> = {}
): never {
  throw new SessionAAError(message, 'aa_operation_invalid', details);
}

function normalizeSerializedSettlement(value: unknown): SerializedAssetAmount {
  try {
    const normalized = serializeAssetAmount(deserializeAssetAmount(value));
    const candidate = value as Readonly<Record<string, unknown>>;
    if (
      candidate['schemaVersion'] !== normalized.schemaVersion ||
      candidate['assetId'] !== normalized.assetId ||
      candidate['decimals'] !== normalized.decimals ||
      candidate['raw'] !== normalized.raw
    ) {
      invalidOperation('Session operation settlement is not canonical.');
    }
    return normalized;
  } catch (error) {
    if (error instanceof SessionAAError) throw error;
    invalidOperation('Session operation settlement is invalid.', {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Revalidates the complete operation at every trust boundary. The exported interface is
 * intentionally structural, so callers must never treat TypeScript shape alone as authority.
 */
export function validateSessionOperation(
  profile: ChainRuntimeProfile,
  value: unknown
): SessionOperation {
  assertSessionProfile(profile);
  if (!value || typeof value !== 'object') {
    invalidOperation('Session operation must be an object.');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    (candidate['kind'] !== 'session-token-transfer' &&
      candidate['kind'] !== 'session-call') ||
    typeof candidate['sessionId'] !== 'string' ||
    typeof candidate['actionId'] !== 'string' ||
    typeof candidate['callData'] !== 'string' ||
    !isHex(candidate['callData']) ||
    typeof candidate['profileFingerprint'] !== 'string' ||
    candidate['canWrite'] !== false ||
    candidate['verificationLevel'] !== 'DRY_RUN_SIMULATED'
  ) {
    invalidOperation('Session operation fields are invalid.');
  }

  const kind = candidate['kind'];
  const sessionId = candidate['sessionId'] as Hex;
  const actionId = candidate['actionId'] as Hex;
  const callData = candidate['callData'];
  assertBytes32(sessionId, 'sessionId');
  assertBytes32(actionId, 'actionId');
  if (/^0x0{64}$/i.test(actionId)) {
    invalidOperation('Session operation actionId cannot be zero.');
  }
  const profileFingerprint = buildProfileFingerprint(profile).fingerprint;
  if (candidate['profileFingerprint'] !== profileFingerprint) {
    throw new SessionAAError(
      'Session operation belongs to another runtime profile.',
      'aa_profile_fingerprint_mismatch'
    );
  }

  const decoded = (() => {
    try {
      return decodeFunctionData({ abi: SESSION_ACCOUNT_ABI, data: callData });
    } catch (error) {
      invalidOperation('Session operation calldata cannot be decoded.', {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  if (kind === 'session-token-transfer') {
    if (decoded.functionName !== 'executeTokenTransfer') {
      invalidOperation('Token-transfer operation uses the wrong account method.');
    }
    const [decodedSessionId, token, recipient, raw, decodedActionId] = decoded.args;
    const settlement = normalizeSerializedSettlement(candidate['settlement']);
    if (
      decodedSessionId.toLowerCase() !== sessionId.toLowerCase() ||
      decodedActionId.toLowerCase() !== actionId.toLowerCase() ||
      ZERO_ADDRESS_PATTERN.test(token) ||
      ZERO_ADDRESS_PATTERN.test(recipient) ||
      token.toLowerCase() !== profile.settlementAsset.tokenAddress.toLowerCase() ||
      settlement.assetId !== profile.settlementAsset.assetId.toLowerCase() ||
      settlement.decimals !== profile.settlementAsset.decimals ||
      raw <= 0n ||
      raw.toString() !== settlement.raw
    ) {
      invalidOperation('Token-transfer calldata is not bound to the declared authority and amount.');
    }
    const canonical = encodeFunctionData({
      abi: SESSION_ACCOUNT_ABI,
      functionName: 'executeTokenTransfer',
      args: [decodedSessionId, token, recipient, raw, decodedActionId]
    });
    if (canonical.toLowerCase() !== callData.toLowerCase()) {
      invalidOperation('Token-transfer calldata is not canonically encoded.');
    }
    return Object.freeze({
      kind,
      sessionId,
      actionId,
      callData,
      settlement,
      profileFingerprint,
      canWrite: false,
      verificationLevel: 'DRY_RUN_SIMULATED'
    });
  }

  if (decoded.functionName !== 'executeCall' || candidate['settlement'] !== null) {
    invalidOperation('Generic session operation uses invalid calldata or settlement metadata.');
  }
  const [decodedSessionId, target, data, decodedActionId] = decoded.args;
  if (
    decodedSessionId.toLowerCase() !== sessionId.toLowerCase() ||
    decodedActionId.toLowerCase() !== actionId.toLowerCase() ||
    ZERO_ADDRESS_PATTERN.test(target) ||
    size(data) < 4
  ) {
    invalidOperation('Generic calldata is not bound to the declared authority.');
  }
  const canonical = encodeFunctionData({
    abi: SESSION_ACCOUNT_ABI,
    functionName: 'executeCall',
    args: [decodedSessionId, target, data, decodedActionId]
  });
  if (canonical.toLowerCase() !== callData.toLowerCase()) {
    invalidOperation('Generic session calldata is not canonically encoded.');
  }
  return Object.freeze({
    kind,
    sessionId,
    actionId,
    callData,
    settlement: null,
    profileFingerprint,
    canWrite: false,
    verificationLevel: 'DRY_RUN_SIMULATED'
  });
}

function validateAccountInitCode(profile: ChainRuntimeProfile, value: Hex | undefined): Hex {
  const initCode = value ?? '0x';
  if (initCode === '0x') return initCode;
  if (profile.aa.accountFactoryAddress === null) {
    throw new SessionAAError(
      'Account initCode is forbidden until the Factory is locked in the Runtime Profile.',
      'aa_factory_not_configured'
    );
  }
  if (!isHex(initCode) || size(initCode) < 24) {
    throw new SessionAAError(
      'Account initCode must contain a Factory address and method selector.',
      'aa_init_code_invalid'
    );
  }
  const factory = requireNonZeroAddress(`0x${initCode.slice(2, 42)}`, 'initCode.factory');
  if (factory.toLowerCase() !== profile.aa.accountFactoryAddress.toLowerCase()) {
    throw new SessionAAError(
      'Account initCode Factory does not match the Runtime Profile.',
      'aa_factory_mismatch',
      { expected: profile.aa.accountFactoryAddress, actual: factory }
    );
  }
  const factoryData: Hex = `0x${initCode.slice(42)}`;
  try {
    const decoded = decodeFunctionData({ abi: SESSION_FACTORY_ABI, data: factoryData });
    if (decoded.functionName !== 'createAccount') {
      throw new Error('wrong Factory method');
    }
    const [owner, salt] = decoded.args;
    requireNonZeroAddress(owner, 'initCode.owner');
    const canonical = encodeFunctionData({
      abi: SESSION_FACTORY_ABI,
      functionName: 'createAccount',
      args: [owner, salt]
    });
    if (canonical.toLowerCase() !== factoryData.toLowerCase()) {
      throw new Error('non-canonical Factory calldata');
    }
  } catch (error) {
    if (error instanceof SessionAAError) throw error;
    throw new SessionAAError('Account Factory calldata is invalid.', 'aa_init_code_invalid', {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
  return initCode;
}

function makeDraft(
  userOperation: PackedUserOperationV07,
  profileFingerprint: string,
  entryPointAddress: Address
): SessionUserOperationDraft {
  return Object.freeze({
    userOperation: Object.freeze(userOperation),
    profileFingerprint,
    entryPointAddress,
    canWrite: false,
    verificationLevel: 'DRY_RUN_SIMULATED',
    assertSubmissionAllowed(writeGate: WriteGate): never {
      return writeGate.assertAllowed({
        action: 'bundler.sendUserOperation',
        profileFingerprint
      });
    }
  });
}

export function createSessionUserOperationDraft(
  input: CreateDraftInput
): SessionUserOperationDraft {
  assertSessionProfile(input.profile);
  const sender = requireNonZeroAddress(input.sender, 'sender');
  const entryPointAddress = requireNonZeroAddress(
    input.profile.entryPoint.address,
    'profile.entryPoint.address'
  );
  if (input.nonce < 0n) {
    throw new SessionAAError('UserOperation nonce cannot be negative.', 'aa_nonce_invalid');
  }
  const operation = validateSessionOperation(input.profile, input.operation);
  const profileFingerprint = operation.profileFingerprint;
  const initCode = validateAccountInitCode(input.profile, input.initCode);
  return makeDraft(
    {
      sender,
      nonce: input.nonce,
      initCode,
      callData: operation.callData,
      callGasLimit: input.callGasLimit ?? 0n,
      verificationGasLimit: input.verificationGasLimit ?? 0n,
      preVerificationGas: input.preVerificationGas ?? 0n,
      maxFeePerGas: input.maxFeePerGas ?? 0n,
      maxPriorityFeePerGas: input.maxPriorityFeePerGas ?? 0n,
      paymasterAndData: '0x',
      signature: DUMMY_SESSION_SIGNATURE
    },
    profileFingerprint,
    entryPointAddress
  );
}

export function attachSessionSignature(
  draft: SessionUserOperationDraft,
  signature: Hex
): SessionUserOperationDraft {
  if (!isHex(signature) || size(signature) !== 65) {
    throw new SessionAAError(
      'Session signature must be a 65-byte ECDSA signature.',
      'aa_signature_invalid'
    );
  }
  return makeDraft(
    { ...draft.userOperation, signature },
    draft.profileFingerprint,
    draft.entryPointAddress
  );
}

function toRpcQuantity(value: bigint): Hex {
  if (value < 0n) {
    throw new SessionAAError('RPC quantities cannot be negative.', 'aa_rpc_quantity_invalid');
  }
  return toHex(value);
}

function toBundlerUserOperation(userOperation: PackedUserOperationV07): Readonly<Record<string, Hex>> {
  if (userOperation.paymasterAndData !== '0x') {
    throw new SessionAAError(
      'Paymaster-backed UserOperations are not supported by the Botchain session seam.',
      'aa_paymaster_unsupported'
    );
  }
  const rpcUserOperation: Record<string, Hex> = {
    sender: userOperation.sender,
    nonce: toRpcQuantity(userOperation.nonce),
    callData: userOperation.callData,
    callGasLimit: toRpcQuantity(userOperation.callGasLimit),
    verificationGasLimit: toRpcQuantity(userOperation.verificationGasLimit),
    preVerificationGas: toRpcQuantity(userOperation.preVerificationGas),
    maxFeePerGas: toRpcQuantity(userOperation.maxFeePerGas),
    maxPriorityFeePerGas: toRpcQuantity(userOperation.maxPriorityFeePerGas),
    signature: userOperation.signature
  };
  if (userOperation.initCode !== '0x') {
    if (!isHex(userOperation.initCode) || size(userOperation.initCode) < 20) {
      throw new SessionAAError(
        'Account initCode must contain a 20-byte factory address.',
        'aa_init_code_invalid'
      );
    }
    rpcUserOperation['factory'] = `0x${userOperation.initCode.slice(2, 42)}`;
    rpcUserOperation['factoryData'] = `0x${userOperation.initCode.slice(42)}`;
  }
  return Object.freeze(rpcUserOperation);
}

function parseEstimateQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new SessionAAError(
      `Bundler returned an invalid ${label}.`,
      'aa_bundler_estimate_invalid',
      { label, value }
    );
  }
  return BigInt(value);
}

export async function estimateSessionUserOperation(
  input: EstimateInput
): Promise<SessionGasEstimate> {
  const result = await input.bundlerRpc.request<BundlerEstimateResponse>(
    'eth_estimateUserOperationGas',
    [toBundlerUserOperation(input.draft.userOperation), input.draft.entryPointAddress]
  );
  return Object.freeze({
    status: 'estimated',
    canWrite: false,
    verificationLevel: 'READONLY_BUNDLER_ESTIMATE',
    gas: Object.freeze({
      callGasLimit: parseEstimateQuantity(result.callGasLimit, 'callGasLimit'),
      verificationGasLimit: parseEstimateQuantity(
        result.verificationGasLimit,
        'verificationGasLimit'
      ),
      preVerificationGas: parseEstimateQuantity(
        result.preVerificationGas,
        'preVerificationGas'
      )
    })
  });
}
