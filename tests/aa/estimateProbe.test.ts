import { describe, expect, it } from 'vitest';

import { isExpectedUndeployedAccountRejection } from '../../src/aa/estimateProbe.js';
import { ReadonlyRpcError } from '../../src/chain/rpc.js';

describe('AA estimate probe classification', () => {
  it('accepts only the exact undeployed-account validation rejection', () => {
    expect(
      isExpectedUndeployedAccountRejection(
        new ReadonlyRpcError('AA20 account not deployed', 'rpc_remote_error', {
          method: 'eth_estimateUserOperationGas',
          rpcCode: -32521
        })
      )
    ).toBe(true);

    for (const error of [
      new ReadonlyRpcError('Unauthorized', 'rpc_remote_error', {
        method: 'eth_estimateUserOperationGas',
        rpcCode: -32001
      }),
      new ReadonlyRpcError('Method not found', 'rpc_remote_error', {
        method: 'eth_estimateUserOperationGas',
        rpcCode: -32601
      }),
      new ReadonlyRpcError('AA20 account not deployed', 'rpc_remote_error', {
        method: 'eth_call',
        rpcCode: -32521
      })
    ]) {
      expect(isExpectedUndeployedAccountRejection(error)).toBe(false);
    }
  });
});
