const MAX_UINT256 = (1n << 256n) - 1n;
const DECIMAL_INPUT = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const RAW_INPUT = /^(0|[1-9][0-9]*)$/;

export interface AssetDefinition {
  readonly assetId: string;
  readonly decimals: number;
}

export interface AssetAmount extends AssetDefinition {
  readonly raw: bigint;
}

export interface SerializedAssetAmount extends AssetDefinition {
  readonly schemaVersion: 1;
  readonly raw: string;
}

export class AssetAmountError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'AssetAmountError';
    this.code = code;
    this.details = details;
  }
}

function normalizeAsset(asset: AssetDefinition): AssetDefinition {
  if (!asset || typeof asset !== 'object') {
    throw new AssetAmountError('Asset definition must be an object.', 'amount_asset_invalid', {
      receivedType: typeof asset
    });
  }
  if (
    typeof asset.assetId !== 'string' ||
    asset.assetId.length === 0 ||
    asset.assetId.trim() !== asset.assetId ||
    !asset.assetId.includes('/')
  ) {
    throw new AssetAmountError('assetId must be a canonical scoped asset identifier.', 'amount_asset_invalid', {
      assetId: asset.assetId
    });
  }
  if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255) {
    throw new AssetAmountError('Asset decimals must be an integer from 0 to 255.', 'amount_asset_invalid', {
      decimals: asset.decimals
    });
  }
  return Object.freeze({
    assetId: asset.assetId.toLowerCase(),
    decimals: asset.decimals
  });
}

export function createAssetAmount(asset: AssetDefinition, raw: bigint): AssetAmount {
  const normalizedAsset = normalizeAsset(asset);
  if (typeof raw !== 'bigint') {
    throw new AssetAmountError('Raw asset units must be a bigint.', 'amount_raw_invalid', {
      receivedType: typeof raw
    });
  }
  if (raw < 0n || raw > MAX_UINT256) {
    throw new AssetAmountError(
      'Raw asset units must fit an unsigned 256-bit integer.',
      'amount_raw_out_of_range',
      { raw: raw.toString() }
    );
  }
  return Object.freeze({ ...normalizedAsset, raw });
}

export function parseAssetAmount(value: string, asset: AssetDefinition): AssetAmount {
  const normalizedAsset = normalizeAsset(asset);
  if (typeof value !== 'string') {
    throw new AssetAmountError('Asset amount must be a decimal string.', 'amount_decimal_invalid', {
      receivedType: typeof value
    });
  }
  const match = DECIMAL_INPUT.exec(value);
  if (!match) {
    throw new AssetAmountError(
      'Asset amount must use canonical non-negative decimal notation.',
      'amount_decimal_invalid',
      { value }
    );
  }
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > normalizedAsset.decimals) {
    throw new AssetAmountError(
      `Asset amount exceeds ${normalizedAsset.decimals} decimal places.`,
      'amount_precision_exceeded',
      { value, decimals: normalizedAsset.decimals }
    );
  }
  if (whole.length > 78) {
    throw new AssetAmountError(
      'Asset amount exceeds the unsigned 256-bit range.',
      'amount_raw_out_of_range',
      { value }
    );
  }
  const scale = 10n ** BigInt(normalizedAsset.decimals);
  const fractionalRaw = fraction.length > 0 ? BigInt(fraction.padEnd(normalizedAsset.decimals, '0')) : 0n;
  return createAssetAmount(normalizedAsset, BigInt(whole) * scale + fractionalRaw);
}

export function formatAssetAmount(amount: AssetAmount): string {
  const normalized = createAssetAmount(amount, amount.raw);
  if (normalized.decimals === 0) return normalized.raw.toString();

  const padded = normalized.raw.toString().padStart(normalized.decimals + 1, '0');
  const split = padded.length - normalized.decimals;
  const whole = padded.slice(0, split);
  const fraction = padded.slice(split).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function assertSameAsset(left: AssetAmount, right: AssetAmount): void {
  if (
    left.assetId.toLowerCase() !== right.assetId.toLowerCase() ||
    left.decimals !== right.decimals
  ) {
    throw new AssetAmountError(
      'Asset arithmetic requires identical asset identity and decimals.',
      'amount_asset_mismatch',
      {
        left: { assetId: left.assetId, decimals: left.decimals },
        right: { assetId: right.assetId, decimals: right.decimals }
      }
    );
  }
}

export function addAssetAmounts(left: AssetAmount, right: AssetAmount): AssetAmount {
  const normalizedLeft = createAssetAmount(left, left.raw);
  const normalizedRight = createAssetAmount(right, right.raw);
  assertSameAsset(normalizedLeft, normalizedRight);
  return createAssetAmount(normalizedLeft, normalizedLeft.raw + normalizedRight.raw);
}

export function subtractAssetAmounts(left: AssetAmount, right: AssetAmount): AssetAmount {
  const normalizedLeft = createAssetAmount(left, left.raw);
  const normalizedRight = createAssetAmount(right, right.raw);
  assertSameAsset(normalizedLeft, normalizedRight);
  if (normalizedRight.raw > normalizedLeft.raw) {
    throw new AssetAmountError('Asset subtraction cannot produce a negative amount.', 'amount_underflow', {
      leftRaw: normalizedLeft.raw.toString(),
      rightRaw: normalizedRight.raw.toString()
    });
  }
  return createAssetAmount(normalizedLeft, normalizedLeft.raw - normalizedRight.raw);
}

export function serializeAssetAmount(amount: AssetAmount): SerializedAssetAmount {
  const normalized = createAssetAmount(amount, amount.raw);
  return Object.freeze({
    schemaVersion: 1,
    assetId: normalized.assetId,
    decimals: normalized.decimals,
    raw: normalized.raw.toString()
  });
}

export function deserializeAssetAmount(value: unknown): AssetAmount {
  if (!value || typeof value !== 'object') {
    throw new AssetAmountError(
      'Serialized AssetAmount must be an object.',
      'amount_serialized_invalid'
    );
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(candidate).sort();
  const expectedKeys = ['assetId', 'decimals', 'raw', 'schemaVersion'];
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => keys[index] !== key) ||
    candidate['schemaVersion'] !== 1 ||
    typeof candidate['assetId'] !== 'string' ||
    typeof candidate['decimals'] !== 'number' ||
    typeof candidate['raw'] !== 'string' ||
    !RAW_INPUT.test(candidate['raw'])
  ) {
    throw new AssetAmountError(
      'Serialized AssetAmount fields are invalid.',
      'amount_serialized_invalid'
    );
  }
  return createAssetAmount(
    { assetId: candidate['assetId'], decimals: candidate['decimals'] },
    BigInt(candidate['raw'])
  );
}
