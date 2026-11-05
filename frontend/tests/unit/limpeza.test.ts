import { describe, expect, it, vi } from 'vitest';
import { limpar, limparTexto } from '@/observabilidade/limpeza';

vi.stubGlobal('__VERSAO_APP__', '0.1.0');
const { montarEvento } = await import('@/observabilidade/erros');
const { ErroApi } = await import('@/api/erros');

describe('limpeza de dados pessoais nos erros', () => {
  it('remove e-mail, telefone, token e query string de textos', () => {
    expect(limparTexto('falhou para marcos@exemplo.com (+55 11 98888-7777) Bearer ac.abcdefghijklmnop em https://api.x/v1/pacientes?busca=Marcos#a'))
      .toBe('falhou para [email] ([telefone]) [token] em https://api.x/v1/pacientes');
  });
  it('remove campos sensíveis em qualquer profundidade e mantém ids', () => {
    expect(limpar({ id: 'pac_1', nome: 'Marcos', contato: { email: 'a@b.com' }, respostas: { dor: 9 }, dados: { conversaId: 'cnv_1', texto: 'sangrando' } }))
      .toEqual({ id: 'pac_1', nome: '[removido]', contato: '[removido]', respostas: '[removido]', dados: { conversaId: 'cnv_1', texto: '[removido]' } });
  });
  it('evento leva código e requestId do erro da API, nunca o detail', () => {
    const e = new ErroApi(500, 'INDISPONIVEL_TEMPORARIAMENTE', 'req_1', [], undefined, 'paciente Marcos Souza');
    const ev = montarEvento(e, { corpo: { nome: 'Marcos' } });
    expect(ev).toMatchObject({ codigo: 'INDISPONIVEL_TEMPORARIAMENTE', status: 500, requestId: 'req_1', versaoApp: '0.1.0' });
    expect(JSON.stringify(ev)).not.toMatch(/Marcos/);
  });
});
