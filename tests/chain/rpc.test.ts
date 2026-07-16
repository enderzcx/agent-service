import { describe, expect, it, vi } from 'vitest';

import { HttpJsonRpcClient } from '../../src/chain/rpc.js';
import type { ReadonlyRpcError } from '../../src/chain/rpc.js';

describe('read-only JSON-RPC adapter', () => {
  it('allows an explicit read method and returns its result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x3c8' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const client = new HttpJsonRpcClient('https://rpc.example', { fetchImpl });

    await expect(client.request('eth_chainId')).resolves.toBe('0x3c8');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(['eth_sendRawTransaction', 'eth_sendUserOperation', 'personal_sign']) (
    'rejects write-capable method %s before transport',
    async (method) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const client = new HttpJsonRpcClient('https://rpc.example', { fetchImpl });

      await expect(client.request(method)).rejects.toEqual(
        expect.objectContaining<Partial<ReadonlyRpcError>>({ code: 'rpc_method_not_readonly' })
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );
});
