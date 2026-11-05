import { describe, expect, it } from 'vitest';
import { compararVersoes } from '@/app/versao';

describe('versões', () => {
  it.each([['1.0.0', '1.0.0', 0], ['1.0.0', '1.0.1', -1], ['1.2.0', '1.10.0', -1], ['1.0.0-rc.1', '1.0.0', -1], ['1.0.0-rc.2', '1.0.0-rc.1', 1], ['2.0.0', '1.9.9', 1]])('%s vs %s', (a, b, r) => {
    expect(compararVersoes(a, b)).toBe(r);
  });
});
