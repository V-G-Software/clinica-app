import { describe, expect, it } from 'vitest';
import { capitalizar, contar, meu, nenhum, novo, type Termo } from '@/i18n/termos';
import { formatarData, formatarDataHora } from '@/i18n/datas';

const paciente: Termo = { singular: 'paciente', plural: 'pacientes', genero: 'M' };
const recuperacao: Termo = { singular: 'recuperação', plural: 'recuperações', genero: 'F' };
const pet: Termo = { singular: 'pet', plural: 'pets', genero: 'M' };

describe('termos do domínio', () => {
  it('concordância de gênero', () => {
    expect(capitalizar(novo(paciente))).toBe('Novo paciente');
    expect(capitalizar(novo(recuperacao))).toBe('Nova recuperação');
    expect(capitalizar(nenhum(recuperacao))).toBe('Nenhuma recuperação');
    expect(capitalizar(meu(recuperacao))).toBe('Minha recuperação');
  });
  it('plural', () => { expect(contar(1, pet)).toBe('1 pet'); expect(contar(2, pet)).toBe('2 pets'); });
});

describe('datas no fuso da organização', () => {
  it('data sem hora não "volta um dia" no fuso do Brasil', () => expect(formatarData('2026-11-05')).toBe('05/11/2026'));
  it('instante UTC exibido no fuso da organização, não no do aparelho', () => {
    expect(formatarDataHora('2026-11-09T02:00:00Z', 'America/Sao_Paulo')).toBe('08/11/2026, 23:00');
    expect(formatarDataHora('2026-11-09T02:00:00Z', 'America/Manaus')).toBe('08/11/2026, 22:00');
  });
});

describe('plural dos contadores (vue-i18n)', async () => {
  const { i18n } = await import('@/i18n');
  const t = i18n.global.t as unknown as (k: string, n: number) => string;
  it.each([[0, 'nenhum pendente'], [1, '1 pendente'], [3, '3 pendentes']])('%i', (n, esperado) => expect(t('inicio.pendentes', n)).toBe(esperado));
});
