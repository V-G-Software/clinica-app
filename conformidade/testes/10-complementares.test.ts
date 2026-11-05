// Operações restantes do contrato: domínio próprio, senha, exclusão de conta, versões de formulário,
// arquivamento de protocolo, edição de acompanhamento, busca e participantes do chat.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { config } from '../src/config.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { criarPacienteComConta } from '../src/sessoes.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB, termosVersao, execucao, slug } = amb;
void pacienteB;

describe('diretório por domínio', () => {
  it('resolve domínio próprio e devolve 404 para domínio desconhecido', async () => {
    if (config.urlApi && !process.env.CONF_DIRETORIO_URL) return;
    const dir = config.diretorioUrl.replace(/\/$/, '');
    esperar(await api.chamar('GET', '/v1/organizacoes', { base: dir, query: { dominio: `desconhecido-${execucao}.exemplo.com` } }), 404);
    if (config.dominio) expect(esperar(await api.chamar('GET', '/v1/organizacoes', { base: dir, query: { dominio: config.dominio } }), 200).body.slug).toBe(slug);
  });
});

describe('senha e conta', () => {
  it('esqueci a senha sempre devolve 202; token inválido de redefinição é recusado', async () => {
    esperar(await api.chamar('POST', '/v1/auth/senha/esqueci', { body: { email: `ninguem.${execucao}@exemplo.com` } }), 202);
    const r = await api.chamar('POST', '/v1/auth/senha/redefinir', { body: { token: `token-invalido-${execucao}`, novaSenha: 'NovaSenha12345' } });
    expect([400, 401, 404, 410, 422]).toContain(r.status);
    expect(['CODIGO_EXPIRADO', 'CODIGO_INVALIDO']).toContain(r.body.codigo);
  });

  it('paciente pede exclusão da conta: perde o acesso e recebe o que fica guardado', async () => {
    const s = await criarPacienteComConta(api, gestor, `conf.${execucao}.exclusao@exemplo.com`, `Exclusao ${execucao}`, termosVersao);
    const r = esperar(await api.chamar('POST', '/v1/me/exclusao', { token: s.token }), 202).body;
    expect(r.dadosRetidos.length).toBeGreaterThan(0);
    esperar(await api.chamar('GET', '/v1/me', { token: s.token }), 401);
    esperar(await api.chamar('POST', '/v1/me/exclusao', { token: gestor.token }), 403, 'PERMISSAO_NEGADA');
  });
});

describe.runIf(temModulo(amb, 'acompanhamento'))('formulários e protocolos', () => {
  it('nova versão de formulário não altera a anterior (RN-FRM-001)', async () => {
    const f = esperar(await api.chamar('POST', '/v1/formularios', { token: gestor.token, body: { titulo: `Versões ${execucao}`, campos: [{ id: 'nota', tipo: 'ESCALA', rotulo: 'Nota', min: 0, max: 5, obrigatorio: true }] } }), 201);
    const v2 = esperar(await api.chamar('PUT', `/v1/formularios/${f.body.id}`, { token: gestor.token, headers: { 'If-Match': f.headers.get('etag')! }, body: { titulo: `Versões ${execucao} v2`, campos: [{ id: 'nota', tipo: 'ESCALA', rotulo: 'Nota', min: 0, max: 10, obrigatorio: true }] } }), 200).body;
    expect(v2.versao).toBe(f.body.versao + 1);
    const v1 = esperar(await api.chamar('GET', `/v1/formularios/${f.body.id}`, { token: gestor.token, query: { versao: f.body.versao } }), 200).body;
    expect(v1.campos[0].max).toBe(5);
    const lista = esperar(await api.chamar('GET', '/v1/formularios', { token: gestor.token, query: { limite: 100 } }), 200).body;
    expect(lista.itens.find((x: any) => x.id === f.body.id)?.versao).toBe(v2.versao);
    esperar(await api.chamar('GET', `/v1/formularios/${f.body.id}`, { token: pacienteA.token }), [403, 404]);
  });

  it('protocolo arquivado sai da lista ATIVO e não inicia acompanhamento', async () => {
    const [ativo] = esperar(await api.chamar('GET', '/v1/protocolos', { token: gestor.token, query: { status: 'ATIVO', limite: 1 } }), 200).body.itens;
    const ck = ativo.checkins.map((c: any) => ({ ...c }));
    const p = esperar(await api.chamar('POST', '/v1/protocolos', { token: gestor.token, body: { nome: `Arquivar ${execucao}`, duracaoDias: ativo.duracaoDias, checkins: ck } }), 201).body;
    const arq = esperar(await api.chamar('POST', `/v1/protocolos/${p.id}/arquivar`, { token: gestor.token }), 200).body;
    expect(arq.status).toBe('ARQUIVADO');
    expect(arq.acoesPermitidas).not.toContain('INICIAR_ACOMPANHAMENTO');
    const ativos = esperar(await api.chamar('GET', '/v1/protocolos', { token: gestor.token, query: { status: 'ATIVO', limite: 100 } }), 200).body.itens;
    expect(ativos.map((x: any) => x.id)).not.toContain(p.id);
    esperar(await api.chamar('POST', '/v1/acompanhamentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteB.pacienteId, protocoloId: p.id, dataInicio: '2030-01-01' } }), 422, 'VALIDACAO_FALHOU');
  });

  it('edição de acompanhamento com If-Match; paciente não edita', async () => {
    const [prot] = esperar(await api.chamar('GET', '/v1/protocolos', { token: gestor.token, query: { status: 'ATIVO', limite: 1 } }), 200).body.itens;
    const a = esperar(await api.chamar('POST', '/v1/acompanhamentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, protocoloId: prot.id, dataInicio: '2030-01-01', equipeIds: [gestor.usuarioId] } }), 201).body;
    const r = esperar(await api.chamar('GET', `/v1/acompanhamentos/${a.id}`, { token: gestor.token }), 200);
    const e = esperar(await api.chamar('PATCH', `/v1/acompanhamentos/${a.id}`, { token: gestor.token, headers: { 'If-Match': r.headers.get('etag')! }, body: { observacao: `Editado ${execucao}` } }), 200).body;
    expect(e.observacao).toBe(`Editado ${execucao}`);
    esperar(await api.chamar('PATCH', `/v1/acompanhamentos/${a.id}`, { token: gestor.token, headers: { 'If-Match': r.headers.get('etag')! }, body: { observacao: 'x' } }), 412, 'CONFLITO_VERSAO');
    const visto = esperar(await api.chamar('GET', `/v1/acompanhamentos/${a.id}`, { token: pacienteA.token }), 200);
    expect(visto.body.observacao).toBeNull(); // observação interna não vai para o paciente
    esperar(await api.chamar('PATCH', `/v1/acompanhamentos/${a.id}`, { token: pacienteA.token, headers: { 'If-Match': visto.headers.get('etag')! }, body: { observacao: 'x' } }), [403, 404]);
  });
});

describe.runIf(temModulo(amb, 'chat'))('chat: busca e participantes', () => {
  it('busca pelo nome do paciente vai no corpo', async () => {
    esperar(await api.chamar('POST', '/v1/conversas', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), [200, 201]);
    const r = esperar(await api.chamar('POST', '/v1/conversas/busca', { token: gestor.token, body: { texto: `Conformidade A ${execucao}` } }), 200).body;
    expect(r.itens.some((c: any) => c.paciente.id === pacienteA.pacienteId)).toBe(true);
  });

  it('adiciona e remove membro da equipe; paciente não pode ser removido', async () => {
    const conversa = esperar(await api.chamar('POST', '/v1/conversas', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), [200, 201]).body;
    esperar(await api.chamar('DELETE', `/v1/conversas/${conversa.id}/participantes/${pacienteA.usuarioId}`, { token: gestor.token }), 422);
    if (!temModulo(amb, 'equipe')) return;
    const membros = esperar(await api.chamar('GET', '/v1/equipe/membros', { token: gestor.token, query: { status: 'ATIVO', limite: 100 } }), 200).body.itens;
    const outro = membros.find((m: any) => m.id !== gestor.usuarioId);
    if (!outro) return;
    const comOutro = esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/participantes`, { token: gestor.token, body: { usuarioId: outro.id } }), 200).body;
    expect(comOutro.participantes.map((p: any) => p.usuarioId)).toContain(outro.id);
    esperar(await api.chamar('DELETE', `/v1/conversas/${conversa.id}/participantes/${outro.id}`, { token: gestor.token }), 204);
    const depois = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}`, { token: gestor.token }), 200).body;
    expect(depois.participantes.map((p: any) => p.usuarioId)).not.toContain(outro.id);
    const msgs = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: gestor.token, query: { limite: 100 } }), 200).body;
    expect(msgs.itens.length).toBeGreaterThan(0); // histórico preservado (RN-CHA-004)
    esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/participantes`, { token: pacienteA.token, body: { usuarioId: outro.id } }), 403);
  });
});
void randomUUID;
