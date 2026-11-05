// Coerência do manifesto, tela inicial, contadores e conta.
import { describe, expect, it } from 'vitest';
import { contrato } from '@clinica/contrato-validador';
import { esperar } from '../src/cliente.ts';
import { ambiente } from '../src/contexto.ts';

const { api, gestor, pacienteA } = ambiente();
const S = contrato.components.schemas;
const TELAS_NUCLEO = new Set(['inicio', 'notificacoes', 'perfil', 'organizacao.configuracao']);

function conferirManifesto(m: any) {
  const modulos = new Set(m.modulos.map((x: any) => x.id));
  // Menu só aponta para telas de módulos ativos (7.1).
  for (const item of m.navegacao) {
    const tela = item.destino.tela as string;
    const modulo = tela.split('.')[0];
    if (!TELAS_NUCLEO.has(tela)) expect(modulos.has(modulo), `navegação "${item.id}" aponta para ${tela}, de módulo inativo`).toBe(true);
  }
  expect(m.navegacao.filter((n: any) => n.grupo === 'PRINCIPAL').length, 'no máximo 5 itens PRINCIPAL').toBeLessThanOrEqual(5);
  expect(new Set(m.navegacao.map((n: any) => n.id)).size).toBe(m.navegacao.length);
  // Termos completos e em minúsculas.
  for (const t of S.TermoChave.enum) {
    expect(m.termos[t], `termo ${t}`).toBeTruthy();
    expect(m.termos[t].singular).toBe(m.termos[t].singular.toLowerCase());
  }
  // Permissões só de módulos ativos (núcleo: organizacao).
  for (const p of m.permissoes) {
    const mod = p.split('.')[0];
    expect(mod === 'organizacao' || modulos.has(mod), `permissão ${p} de módulo inativo`).toBe(true);
  }
  // Contadores referenciados existem.
  for (const n of m.navegacao) if (n.contador) expect(m.contadores[n.contador], `contador ${n.contador}`).toBeTypeOf('number');
  expect(m.perfisDisponiveis.some((p: any) => p.id === m.perfilAtivo)).toBe(true);
}

describe('sessão e manifesto', () => {
  it('manifesto da equipe é coerente e revalida com If-None-Match', async () => {
    const r = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200);
    conferirManifesto(r.body);
    expect(r.body.perfilAtivo).not.toBe('PACIENTE');
    expect(r.body.pacientesVinculados).toBeUndefined();
    const etag = r.headers.get('etag');
    expect(etag).toBeTruthy();
    esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token, headers: { 'If-None-Match': etag! } }), 304);
  });

  it('manifesto do paciente traz pacientesVinculados e nenhuma tela de equipe', async () => {
    const m = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    conferirManifesto(m);
    expect(m.perfilAtivo).toBe('PACIENTE');
    expect(m.pacientesVinculados.map((p: any) => p.id)).toContain(pacienteA.pacienteId);
    const telasEquipe = ['pacientes.lista', 'pacientes.novo', 'acompanhamento.lista', 'acompanhamento.protocolos', 'equipe.lista', 'organizacao.configuracao'];
    for (const n of m.navegacao) expect(telasEquipe).not.toContain(n.destino.tela);
    for (const p of ['pacientes.paciente.criar', 'equipe.membro.gerenciar', 'acompanhamento.alerta.ler']) expect(m.permissoes).not.toContain(p);
  });

  it('troca de perfil devolve novo token e manifesto do novo perfil', async () => {
    const m = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    const outro = m.perfisDisponiveis.find((p: any) => p.id !== m.perfilAtivo);
    if (!outro) return;
    const t = esperar(await api.chamar('PUT', '/v1/sessao/perfil-ativo', { token: gestor.token, body: { perfil: outro.id } }), 200).body;
    const m2 = esperar(await api.chamar('GET', '/v1/sessao', { token: t.tokenAcesso }), 200).body;
    expect(m2.perfilAtivo).toBe(outro.id);
    // O token antigo continua no perfil antigo: o perfil vai no token.
    expect(esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body.perfilAtivo).toBe(m.perfilAtivo);
    esperar(await api.chamar('PUT', '/v1/sessao/perfil-ativo', { token: t.tokenAcesso, body: { perfil: m.perfilAtivo } }), 200);
    esperar(await api.chamar('PUT', '/v1/sessao/perfil-ativo', { token: pacienteA.token, body: { perfil: 'GESTOR' } }), [403, 422]);
  });

  it('contadores têm as mesmas chaves do manifesto', async () => {
    const m = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    const c = esperar(await api.chamar('GET', '/v1/contadores', { token: gestor.token }), 200).body;
    expect(Object.keys(c).sort()).toEqual(Object.keys(m.contadores).sort());
  });

  it('tela inicial: seções do catálogo, com ids únicos, para equipe e paciente', async () => {
    for (const s of [gestor, pacienteA]) {
      const r = esperar(await api.chamar('GET', '/v1/inicio', { token: s.token }), 200).body;
      expect(new Set(r.secoes.map((x: any) => x.id)).size).toBe(r.secoes.length);
    }
    const p = esperar(await api.chamar('GET', '/v1/inicio', { token: pacienteA.token }), 200).body;
    for (const tipo of ['ALERTAS_ABERTOS', 'CHECKINS_DO_DIA']) expect(p.secoes.map((x: any) => x.tipo)).not.toContain(tipo);
  });

  it('conta: GET /v1/me e PATCH com If-Match (desatualizado → 412 com estado atual)', async () => {
    const r = esperar(await api.chamar('GET', '/v1/me', { token: pacienteA.token }), 200);
    const etag = r.headers.get('etag')!;
    const ok = esperar(await api.chamar('PATCH', '/v1/me', { token: pacienteA.token, body: { preferencias: { tema: 'ESCURO' } }, headers: { 'If-Match': etag } }), 200);
    expect(ok.body.preferencias.tema).toBe('ESCURO');
    const conflito = esperar(await api.chamar('PATCH', '/v1/me', { token: pacienteA.token, body: { nomeExibicao: 'X' }, headers: { 'If-Match': etag } }), 412, 'CONFLITO_VERSAO');
    expect(conflito.body.estadoAtual).toBeTruthy();
    esperar(await api.chamar('PATCH', '/v1/me', { token: pacienteA.token, body: { nomeExibicao: 'X' } }), 422, 'VALIDACAO_FALHOU');
  });
});
