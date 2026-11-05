import { describe, expect, it, vi } from 'vitest';
import { criarRenovador } from '@/api/renovacao';

describe('renovação single-flight', () => {
  it('chamadas simultâneas compartilham uma única renovação', async () => {
    let resolver!: (v: any) => void;
    const renovar = vi.fn(() => new Promise<any>((r) => (resolver = r)));
    const r = criarRenovador({ renovar, chaveLock: 'x', locks: null });
    const ps = [r(), r(), r()];
    resolver({ tokenAcesso: 't1', expiraEm: 'x' });
    expect(await Promise.all(ps)).toEqual(Array(3).fill({ tokenAcesso: 't1', expiraEm: 'x' }));
    expect(renovar).toHaveBeenCalledTimes(1);
    const segunda = r();
    resolver({ tokenAcesso: 't2', expiraEm: 'x' });
    expect((await segunda)?.tokenAcesso).toBe('t2');
    expect(renovar).toHaveBeenCalledTimes(2); // depois de terminar, uma nova chamada renova de novo
  });
  it('usa o lock entre abas quando disponível', async () => {
    const locks = { request: vi.fn((_n: string, fn: () => Promise<unknown>) => fn()) };
    const r = criarRenovador({ renovar: async () => null, chaveLock: 'renovacao-org', locks: locks as any });
    expect(await r()).toBeNull();
    expect(locks.request).toHaveBeenCalledWith('renovacao-org', expect.any(Function));
  });
});
