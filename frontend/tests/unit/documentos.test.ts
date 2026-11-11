// Documentos: validação do formulário (espelha RN-DOC-003), corpo enviado, rotas e invalidações.
import { describe, expect, it } from 'vitest';
import { CircleHelp } from 'lucide-vue-next';
import { atestadoVazio, corpoAtestado, corpoReceita, problemaAtestado, problemaReceita, receitaVazia, resumo } from '@/telas/documentos/util';
import { invalidacoesPara } from '@/tempo-real/invalidacoes';
import { caminhoDe } from '@/catalogo/telas';
import { iconePorNome } from '@/catalogo/icones';

describe('documentos: formulário', () => {
  it('receita: precisa de ao menos um medicamento com posologia; linhas vazias são ignoradas', () => {
    const r = receitaVazia();
    expect(problemaReceita(r)).toMatch(/ao menos um/);
    r.itens[0] = { medicamento: 'Dipirona 500 mg', posologia: '', quantidade: '' };
    expect(problemaReceita(r)).toMatch(/posologia/);
    r.itens[0].posologia = '1 comprimido se dor.';
    r.itens.push({ medicamento: '', posologia: '', quantidade: '' });
    expect(problemaReceita(r)).toBeNull();
    expect(corpoReceita(r)).toEqual({ itens: [{ medicamento: 'Dipirona 500 mg', posologia: '1 comprimido se dor.', quantidade: null }], orientacoes: null });
  });
  it('atestado: CID só com autorização expressa, no formato A00 ou A00.0; comparecimento com horário coerente', () => {
    const a = atestadoVazio('2026-11-11');
    expect(problemaAtestado(a)).toBeNull();
    a.cid = 'j01';
    expect(problemaAtestado(a)).toMatch(/autorização/);
    a.cidAutorizado = true;
    expect(problemaAtestado(a)).toBeNull();
    expect(corpoAtestado(a)).toMatchObject({ modalidade: 'AFASTAMENTO', dias: 1, cid: 'J01', cidAutorizado: true, horaInicio: null });
    a.cid = 'J0'; expect(problemaAtestado(a)).toMatch(/formato/);
    const c = { ...atestadoVazio('2026-11-11'), modalidade: 'COMPARECIMENTO' as const, horaInicio: '10:00', horaFim: '09:00' };
    expect(problemaAtestado(c)).toMatch(/depois/);
    c.horaFim = '11:30';
    expect(corpoAtestado(c)).toMatchObject({ modalidade: 'COMPARECIMENTO', dias: null, horaInicio: '10:00', horaFim: '11:30', cid: null, cidAutorizado: false });
  });
  it('CID apagado leva a autorização junto (não fica "autorizado" sem CID)', () => {
    const a = { ...atestadoVazio('2026-11-11'), cid: '', cidAutorizado: true };
    expect(corpoAtestado(a).cidAutorizado).toBe(false);
  });
  it('resumo em uma linha', () => {
    expect(resumo({ tipo: 'ATESTADO', receita: null, atestado: { modalidade: 'AFASTAMENTO', data: '2026-11-07', dias: 7, horaInicio: null, horaFim: null, cid: null, cidAutorizado: false, observacoes: null } })).toBe('Afastamento de 7 dias a partir de 07/11/2026');
    expect(resumo({ tipo: 'RECEITA', atestado: null, receita: { itens: [{ medicamento: 'A', posologia: 'x', quantidade: null }, { medicamento: 'B', posologia: 'y', quantidade: null }], orientacoes: null } })).toBe('A, B');
  });
});

describe('documentos: rotas, ícone e tempo real', () => {
  it('destinos e atalhos', () => {
    expect(caminhoDe('documentos.detalhe', { documentoId: 'doc_1' })).toBe('/documentos/doc_1');
    expect(caminhoDe('documentos.meus')).toBe('/documentos/meus');
    expect(caminhoDe('documentos.novo', { pacienteId: 'pac_1', tipo: 'ATESTADO' })).toBe('/documentos/novo?pacienteId=pac_1&tipo=ATESTADO');
    expect(iconePorNome('file-pen-line')).not.toBe(CircleHelp);
  });
  it('eventos invalidam detalhe, listas, sessão de assinatura e início', () => {
    expect(invalidacoesPara({ id: 'e', tipo: 'documentos.documento.atualizado', ocorridoEm: '', dados: { documentoId: 'doc_1' } })).toEqual([['documento', 'doc_1'], ['documentos'], ['inicio']]);
    expect(invalidacoesPara({ id: 'e', tipo: 'documentos.assinatura.atualizada', ocorridoEm: '', dados: { sessaoId: 'ass_1' } })).toEqual([['assinatura', 'ass_1'], ['documentos']]);
  });
});
