import { describe, expect, it } from 'vitest';
import { contraste, corComContraste, gerarEscala, hexParaRgb, oklchParaHex, rgbParaOklch } from '@/app/cor';
import { FUNDO_CLARO, FUNDO_ESCURO, variaveisDaMarca } from '@/app/tema';

describe('cores da marca', () => {
  it('ida e volta OKLCH preserva a cor', () => {
    for (const hex of ['#3B5BFD', '#047857', '#C2410C', '#FACC15']) {
      const { L, C, H } = rgbParaOklch(hexParaRgb(hex));
      expect(oklchParaHex(L, C, H)).toBe(hex);
    }
  });
  it('contraste WCAG conhecido: preto × branco = 21', () => expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 1));
  it('escala vai do mais claro ao mais escuro', () => {
    const e = gerarEscala('#3B5BFD');
    expect(contraste(e[50], '#FFFFFF')).toBeLessThan(contraste(e[500], '#FFFFFF'));
    expect(contraste(e[500], '#FFFFFF')).toBeLessThan(contraste(e[950], '#FFFFFF'));
  });
  it('mantém a cor da marca quando ela já tem contraste', () => {
    expect(corComContraste('#047857', FUNDO_CLARO)).toEqual({ cor: '#047857', ajustada: false });
  });
  it('ajusta marca clara demais (amarelo) até passar AA, sem mudar o matiz', () => {
    const r = corComContraste('#FACC15', FUNDO_CLARO);
    expect(r.ajustada).toBe(true);
    expect(contraste(r.cor, FUNDO_CLARO)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(rgbParaOklch(hexParaRgb(r.cor)).H - rgbParaOklch(hexParaRgb('#FACC15')).H)).toBeLessThan(15);
  });
  it.each(['#3B5BFD', '#047857', '#C2410C', '#FACC15', '#111111', '#FFFFFF'])('ação de %s passa AA no claro e no escuro', (cor) => {
    const v = variaveisDaMarca(cor);
    expect(contraste(v['--acao'], FUNDO_CLARO)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(v['--acao'], v['--acao-texto'])).toBeGreaterThanOrEqual(4.5);
    expect(contraste(v['--acao-escuro'], FUNDO_ESCURO)).toBeGreaterThanOrEqual(4.5);
  });
});
