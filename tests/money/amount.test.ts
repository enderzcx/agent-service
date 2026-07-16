import { describe, expect, it } from 'vitest';

import {
  addAssetAmounts,
  createAssetAmount,
  deserializeAssetAmount,
  formatAssetAmount,
  parseAssetAmount,
  serializeAssetAmount,
  subtractAssetAmounts
} from '../../src/money/amount.js';

const USDT = {
  assetId: 'eip155:968/erc20:0x75edc9335175fc0552d51d48439f229c10420fe3',
  decimals: 6
} as const;
const NATIVE = {
  assetId: 'eip155:968/slip44:60',
  decimals: 18
} as const;

describe('AssetAmount public value seam', () => {
  it('parses and formats Botchain USDT with exactly six-decimal semantics', () => {
    const amount = parseAssetAmount('12.345678', USDT);

    expect(amount).toEqual({ ...USDT, raw: 12_345_678n });
    expect(formatAssetAmount(amount)).toBe('12.345678');
    expect(formatAssetAmount(parseAssetAmount('1.250000', USDT))).toBe('1.25');
    expect(formatAssetAmount(parseAssetAmount('0.000001', USDT))).toBe('0.000001');
    expect(Object.isFrozen(amount)).toBe(true);
  });

  it('keeps 18-decimal native amounts distinct from six-decimal settlement amounts', () => {
    const native = parseAssetAmount('1.000000000000000001', NATIVE);

    expect(native.raw).toBe(1_000_000_000_000_000_001n);
    expect(formatAssetAmount(native)).toBe('1.000000000000000001');
    expect(() => addAssetAmounts(native, parseAssetAmount('1', USDT))).toThrowError(
      expect.objectContaining({ code: 'amount_asset_mismatch' })
    );
  });

  it('rejects excess precision, ambiguous numeric syntax, and non-bigint raw values', () => {
    expect(() => parseAssetAmount('1.0000001', USDT)).toThrowError(
      expect.objectContaining({ code: 'amount_precision_exceeded' })
    );
    expect(() => parseAssetAmount('1e6', USDT)).toThrowError(
      expect.objectContaining({ code: 'amount_decimal_invalid' })
    );
    expect(() => createAssetAmount(USDT, 1 as never)).toThrowError(
      expect.objectContaining({ code: 'amount_raw_invalid' })
    );
    expect(() => createAssetAmount(null as never, 1n)).toThrowError(
      expect.objectContaining({ code: 'amount_asset_invalid' })
    );
  });

  it('performs checked same-asset arithmetic without uint256 overflow or underflow', () => {
    const first = parseAssetAmount('1.25', USDT);
    const second = parseAssetAmount('0.75', USDT);

    expect(addAssetAmounts(first, second).raw).toBe(2_000_000n);
    expect(subtractAssetAmounts(first, second).raw).toBe(500_000n);
    expect(() => subtractAssetAmounts(second, first)).toThrowError(
      expect.objectContaining({ code: 'amount_underflow' })
    );
    expect(() =>
      addAssetAmounts(
        createAssetAmount(USDT, (1n << 256n) - 1n),
        createAssetAmount(USDT, 1n)
      )
    ).toThrowError(expect.objectContaining({ code: 'amount_raw_out_of_range' }));
  });

  it('serializes bigint raw units as a lossless decimal string', () => {
    const amount = parseAssetAmount('42.000001', USDT);
    const serialized = serializeAssetAmount(amount);

    expect(serialized).toEqual({
      schemaVersion: 1,
      ...USDT,
      raw: '42000001'
    });
    expect(deserializeAssetAmount(serialized)).toEqual(amount);
    expect(() => deserializeAssetAmount({ ...serialized, raw: 42_000_001 })).toThrowError(
      expect.objectContaining({ code: 'amount_serialized_invalid' })
    );
    expect(() => deserializeAssetAmount({ ...serialized, legacyDecimals: 18 })).toThrowError(
      expect.objectContaining({ code: 'amount_serialized_invalid' })
    );
  });
});
