import { ReadonlyRpcError } from '../chain/rpc.js';

const EXPECTED_UNDEPLOYED_ACCOUNT_RPC_CODE = -32521;
const EXPECTED_UNDEPLOYED_ACCOUNT_MESSAGE = /\bAA20 account not deployed\b/i;

/**
 * The live estimate probe is green only for the exact rejection expected before deployment.
 * Authentication, method, transport, and unrelated validation errors must remain failures.
 */
export function isExpectedUndeployedAccountRejection(error: unknown): boolean {
  return (
    error instanceof ReadonlyRpcError &&
    error.code === 'rpc_remote_error' &&
    error.details['method'] === 'eth_estimateUserOperationGas' &&
    error.details['rpcCode'] === EXPECTED_UNDEPLOYED_ACCOUNT_RPC_CODE &&
    EXPECTED_UNDEPLOYED_ACCOUNT_MESSAGE.test(error.message)
  );
}
