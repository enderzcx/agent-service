import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { network } from 'hardhat';
import {
  concatHex,
  encodeFunctionData,
  getContract,
  keccak256,
  parseAbi,
  parseEther,
  stringToHex,
  toFunctionSelector,
  toHex,
  type Hex
} from 'viem';

const SESSION_ID = keccak256(stringToHex('entrypoint-v07-session'));
const ACTION_ID = keccak256(stringToHex('entrypoint-v07-action'));
const FACTORY_ABI = parseAbi([
  'function getAddress(address owner,uint256 salt) view returns (address)',
  'function createAccount(address owner,uint256 salt) returns (address)'
] as const);
const ACCOUNT_ABI = parseAbi([
  'function authorizeSession(bytes32 sessionId,address key,uint48 validAfter,uint48 validUntil)',
  'function setCallPermission(bytes32 sessionId,address target,bytes4 selector,uint64 maxCalls)',
  'function executeCall(bytes32 sessionId,address target,bytes data,bytes32 actionId)',
  'function executedActions(bytes32 actionId) view returns (bool)',
  'function callPermissions(bytes32 sessionId,address target,bytes4 selector) view returns (uint64 maxCalls,uint64 callsUsed,bool enabled)'
] as const);
const ENTRY_POINT_ABI = parseAbi([
  'function depositTo(address account) payable',
  'function getNonce(address sender,uint192 key) view returns (uint256)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address payable beneficiary)'
] as const);
const packageMetadata = JSON.parse(
  await readFile(
    new URL('../node_modules/@account-abstraction/contracts/package.json', import.meta.url),
    'utf8'
  )
) as { readonly version?: unknown };
assert.equal(
  packageMetadata.version,
  '0.7.0',
  'reference EntryPoint dependency must remain pinned to 0.7.0'
);

const connection = await network.create();
try {
  const { viem } = connection;
  const publicClient = await viem.getPublicClient();
  const [ownerWallet, sessionWallet] = await viem.getWalletClients();
  assert(ownerWallet?.account && sessionWallet?.account, 'local wallets are required');

  const entryPointDeployment = await viem.deployContract('ReferenceEntryPointV07');
  const entryPoint = getContract({
    address: entryPointDeployment.address,
    abi: ENTRY_POINT_ABI,
    client: { public: publicClient, wallet: ownerWallet }
  });
  const factoryDeployment = await viem.deployContract('BotchainSessionAccountFactory', [
    entryPointDeployment.address
  ]);
  const factory = getContract({
    address: factoryDeployment.address,
    abi: FACTORY_ABI,
    client: { public: publicClient, wallet: ownerWallet }
  });
  const owner = ownerWallet.account.address;
  const sessionKey = sessionWallet.account.address;
  const accountAddress = await factory.read.getAddress([owner, 0n]);
  const createHash = await factory.write.createAccount([owner, 0n]);
  await publicClient.waitForTransactionReceipt({ hash: createHash });

  const account = getContract({
    address: accountAddress,
    abi: ACCOUNT_ABI,
    client: { public: publicClient, wallet: ownerWallet }
  });
  const authorizeHash = await account.write.authorizeSession([
    SESSION_ID,
    sessionKey,
    0,
    0
  ]);
  await publicClient.waitForTransactionReceipt({ hash: authorizeHash });

  const factorySelector = toFunctionSelector('getAddress(address,uint256)');
  const permissionHash = await account.write.setCallPermission([
    SESSION_ID,
    factory.address,
    factorySelector,
    1n
  ]);
  await publicClient.waitForTransactionReceipt({ hash: permissionHash });

  const depositHash = await entryPoint.write.depositTo([accountAddress], {
    value: parseEther('1')
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });

  const innerCall = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: 'getAddress',
    args: [owner, 123n]
  });
  const callData = encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'executeCall',
    args: [SESSION_ID, factory.address, innerCall, ACTION_ID]
  });
  const nonce = await entryPoint.read.getNonce([accountAddress, 0n]);
  const gasPrice = 1_000_000_000n;
  const unsignedUserOperation = {
    sender: accountAddress,
    nonce,
    initCode: '0x' as Hex,
    callData,
    accountGasLimits: concatHex([
      toHex(500_000n, { size: 16 }),
      toHex(300_000n, { size: 16 })
    ]),
    preVerificationGas: 100_000n,
    gasFees: concatHex([
      toHex(gasPrice, { size: 16 }),
      toHex(gasPrice, { size: 16 })
    ]),
    paymasterAndData: '0x' as Hex,
    signature: '0x' as Hex
  } as const;
  const userOperationHash = await entryPoint.read.getUserOpHash([
    unsignedUserOperation
  ]);
  const signature = await sessionWallet.signMessage({
    account: sessionWallet.account,
    message: { raw: userOperationHash }
  });
  const handleOpsHash = await entryPoint.write.handleOps([
    [{ ...unsignedUserOperation, signature }],
    owner
  ]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: handleOpsHash });

  assert.equal(receipt.status, 'success', 'reference EntryPoint handleOps must succeed');
  assert.equal(
    await account.read.executedActions([ACTION_ID]),
    true,
    'session action must execute through handleOps'
  );
  const permission = await account.read.callPermissions([
    SESSION_ID,
    factory.address,
    factorySelector
  ]);
  assert.equal(permission[1], 1n, 'session call allowance must be consumed once');

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      command: 'verify.entrypoint-v07',
      dependencyVersion: packageMetadata.version,
      execution: 'reference_entrypoint_handleOps',
      transactionStatus: receipt.status,
      actionExecuted: true,
      callsUsed: '1',
      network: 'hardhat_ephemeral_local'
    })}\n`
  );
} finally {
  await connection.close();
}
