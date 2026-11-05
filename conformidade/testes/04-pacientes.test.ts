// Pacientes: isolamento (404), idempotência, paginação, busca no corpo, If-Match e convite.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente } from '../src/contexto.ts';
import { respostasMinimas } from '../src/sessoes.ts';

const { api, gestor, pacienteA, pacienteB, execucao } = ambiente();

async function corpoPaciente(nome: string) {
  const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
  const cfg = man.modulos.find((m: any) => m.id === 'pacientes').config;
  const animal = cfg.relacoesPermitidas.every((x: string) => x === 'ANIMAL');
  const f = cfg.formularioCadastroId ? esperar(await api.chamar('GET', `/v1/formularios/${cfg.formularioCadastroId}`, { token: gestor.token }), 200).body : null;
  const camposAdicionais = f ? respostasMinimas(f) : {};
  const email = `${nome.toLowerCase().replace(/\W+/g, '.')}@exemplo.com`;
  return animal
    ? { tipo: 'ANIMAL', nome, contato: { email: null, celular: null }, camposAdicionais, responsaveis: [{ nome: 'Tutor', contato: { email, celular: null } }] }
    : { tipo: 'PESSOA', nome, contato: { email, celular: '+5511999990000' }, camposAdicionais };
}

describe('pacientes', () => {
  it('POST com a mesma Idempotency-Key não duplica', async () => {
    const corpo = await corpoPaciente(`Idempotente ${execucao}`);
    const chave = randomUUID();
    const a = esperar(await api.chamar('POST', '/v1/pacientes', { token: gestor.token, body: corpo, idempotencia: chave }), 201).body;
    const b = esperar(await api.chamar('POST', '/v1/pacientes', { token: gestor.token, body: corpo, idempotencia: chave }), 201).body;
    expect(b.id).toBe(a.id);
    const busca = esperar(await api.chamar('POST', '/v1/pacientes/busca', { token: gestor.token, body: { texto: `Idempotente ${execucao}` } }), 200).body;
    expect(busca.itens.filter((p: any) => p.nome === corpo.nome)).toHaveLength(1);
  });

  it('POST sem Idempotency-Key é recusado', async () => {
    esperar(await api.chamar('POST', '/v1/pacientes', { token: gestor.token, body: await corpoPaciente(`Sem chave ${execucao}`) }), 422, 'VALIDACAO_FALHOU');
  });

  it('cadastro sem nenhum contato devolve 422 com o campo', async () => {
    const corpo: any = await corpoPaciente(`Sem contato ${execucao}`);
    corpo.contato = { email: null, celular: null };
    if (corpo.responsaveis) corpo.responsaveis[0].contato = { email: null, celular: null };
    const r = esperar(await api.chamar('POST', '/v1/pacientes', { token: gestor.token, body: corpo, idempotencia: true }), 422, 'VALIDACAO_FALHOU');
    expect(r.body.campos?.length).toBeGreaterThan(0);
  });

  it('paginação por cursor percorre tudo sem repetir', async () => {
    const vistos = new Set<string>();
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const r = esperar(await api.chamar('GET', '/v1/pacientes', { token: gestor.token, query: { limite: 2, cursor } }), 200).body;
      expect(r.itens.length).toBeLessThanOrEqual(2);
      for (const p of r.itens) { expect(vistos.has(p.id)).toBe(false); vistos.add(p.id); }
      cursor = r.proximoCursor ?? undefined;
      paginas++;
    } while (cursor && paginas < 200);
    expect(vistos.has(pacienteA.pacienteId!)).toBe(true);
    esperar(await api.chamar('GET', '/v1/pacientes', { token: gestor.token, query: { limite: 101 } }), 422);
  });

  it('PATCH com If-Match desatualizado devolve 412 CONFLITO_VERSAO', async () => {
    const r = esperar(await api.chamar('GET', `/v1/pacientes/${pacienteA.pacienteId}`, { token: gestor.token }), 200);
    const etag = r.headers.get('etag')!;
    esperar(await api.chamar('PATCH', `/v1/pacientes/${pacienteA.pacienteId}`, { token: gestor.token, body: { nomeSocial: 'Social' }, headers: { 'If-Match': etag } }), 200);
    const c = esperar(await api.chamar('PATCH', `/v1/pacientes/${pacienteA.pacienteId}`, { token: gestor.token, body: { nomeSocial: 'Outro' }, headers: { 'If-Match': etag } }), 412, 'CONFLITO_VERSAO');
    expect(c.body.estadoAtual?.nomeSocial).toBe('Social');
  });

  it('paciente só vê os pacientes vinculados; o de outra conta devolve 404', async () => {
    const lista = esperar(await api.chamar('GET', '/v1/pacientes', { token: pacienteA.token }), 200).body;
    expect(lista.itens.map((p: any) => p.id)).toEqual([pacienteA.pacienteId]);
    esperar(await api.chamar('GET', `/v1/pacientes/${pacienteB.pacienteId}`, { token: pacienteA.token }), 404);
    esperar(await api.chamar('GET', '/v1/pacientes/pac_inexistente_123', { token: gestor.token }), 404);
    esperar(await api.chamar('POST', '/v1/pacientes', { token: pacienteA.token, body: await corpoPaciente('Proibido'), idempotencia: true }), 403, 'PERMISSAO_NEGADA');
  });

  it('acessoApp e acoesPermitidas vêm calculados pelo backend', async () => {
    const p = esperar(await api.chamar('GET', `/v1/pacientes/${pacienteA.pacienteId}`, { token: gestor.token }), 200).body;
    expect(p.acessoApp.status).toBe('ATIVO');
    expect(p.acoesPermitidas).toContain('EDITAR');
    const visto = esperar(await api.chamar('GET', `/v1/pacientes/${pacienteA.pacienteId}`, { token: pacienteA.token }), 200).body;
    expect(visto.acoesPermitidas).not.toContain('EDITAR');
  });

  it('convite: dados públicos mascarados; uso único', async () => {
    const corpo = await corpoPaciente(`Convidado ${execucao}`);
    const pac = esperar(await api.chamar('POST', '/v1/pacientes', { token: gestor.token, body: corpo, idempotencia: true }), 201).body;
    const conv = esperar(await api.chamar('POST', `/v1/pacientes/${pac.id}/convites`, { token: gestor.token, body: {}, idempotencia: true }), 201).body;
    expect(conv.conteudoQr).toBeTruthy();
    const pub = esperar(await api.chamar('GET', `/v1/publico/convites/${conv.token}`), 200).body;
    expect(pub.tipo).toBe('PACIENTE');
    expect(pub.nomeParcial).not.toBe(corpo.nome);
    const email = (corpo as any).contato.email ?? (corpo as any).responsaveis[0].contato.email;
    if (pub.emailMascarado) expect(pub.emailMascarado).not.toBe(email);
    const termos = (await api.chamar('GET', '/v1/publico/configuracao')).body.autenticacao.termosVersao;
    esperar(await api.chamar('POST', `/v1/auth/convites/${conv.token}/aceitar`, { body: { email, termosVersao: termos } }), 200);
    const de2 = await api.chamar('POST', `/v1/auth/convites/${conv.token}/aceitar`, { body: { email, termosVersao: termos } });
    expect([404, 410]).toContain(de2.status);
    expect(['CONVITE_INVALIDO', 'CONVITE_EXPIRADO']).toContain(de2.body.codigo);
  });
});
