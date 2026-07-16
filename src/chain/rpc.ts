const READONLY_RPC_METHODS = new Set([
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_estimateUserOperationGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getProof',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getUserOperationByHash',
  'eth_getUserOperationReceipt',
  'eth_maxPriorityFeePerGas',
  'eth_supportedEntryPoints',
  'web3_clientVersion'
]);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ReadonlyRpcError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'ReadonlyRpcError';
    this.code = code;
    this.details = details;
  }
}

interface HttpJsonRpcClientOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

interface JsonRpcEnvelope {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly data?: unknown;
  };
}

export class HttpJsonRpcClient {
  readonly #url: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  #requestId = 0;

  constructor(url: string, options: HttpJsonRpcClientOptions = {}) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      throw new ReadonlyRpcError('JSON-RPC transport requires HTTPS.', 'rpc_https_required', {
        url
      });
    }
    this.#url = parsedUrl.toString();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async request<T = unknown>(method: string, params: readonly unknown[] = []): Promise<T> {
    if (!READONLY_RPC_METHODS.has(method)) {
      throw new ReadonlyRpcError(
        `JSON-RPC method is not on the read-only allowlist: ${method}`,
        'rpc_method_not_readonly',
        { method }
      );
    }

    const requestId = ++this.#requestId;
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new ReadonlyRpcError(
        `JSON-RPC transport failed for ${method}.`,
        'rpc_transport_failed',
        { method, reason: error instanceof Error ? error.message : String(error) }
      );
    }

    if (!response.ok) {
      throw new ReadonlyRpcError(
        `JSON-RPC HTTP ${response.status} for ${method}.`,
        'rpc_http_error',
        { method, status: response.status }
      );
    }

    let envelope: JsonRpcEnvelope;
    try {
      envelope = (await response.json()) as JsonRpcEnvelope;
    } catch (error) {
      throw new ReadonlyRpcError(
        `JSON-RPC returned invalid JSON for ${method}.`,
        'rpc_invalid_json',
        { method, reason: error instanceof Error ? error.message : String(error) }
      );
    }

    if (envelope.error) {
      const message =
        typeof envelope.error.message === 'string'
          ? envelope.error.message
          : `JSON-RPC error for ${method}`;
      throw new ReadonlyRpcError(
        message,
        'rpc_remote_error',
        {
          method,
          rpcCode: envelope.error.code,
          rpcData: envelope.error.data
        }
      );
    }
    if (!Object.hasOwn(envelope, 'result')) {
      throw new ReadonlyRpcError(
        `JSON-RPC response is missing result for ${method}.`,
        'rpc_result_missing',
        { method }
      );
    }
    return envelope.result as T;
  }
}
