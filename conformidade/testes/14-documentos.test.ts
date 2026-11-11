// Módulo `documentos` (ADR-0018): rascunho → sessão de assinatura no PSC (OAuth) → retorno público →
// documento assinado, entregue pelo chat e verificável pela validação pública. O PSC de teste do ambiente
// (mock ou backend) autoriza sozinho: a URL de autorização redireciona direto para o retorno com `code`.
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB } = amb;
const ativo = temModulo(amb, 'documentos');
const RETORNO = 'http://localhost:5173/documentos';

const RECEITA = { itens: [{ medicamento: 'Amoxicilina 500 mg, cápsula', posologia: '1 cápsula de 8 em 8 horas por 7 dias.', quantidade: '21 cápsulas' }], orientacoes: 'Tomar após as refeições.' };
const ATESTADO = { modalidade: 'AFASTAMENTO', data: '2026-11-10', dias: 3, cid: null, cidAutorizado: false, observacoes: null };

/** Autoriza no PSC de teste e segue o retorno público: devolve o Location final (volta ao app). */
async function autorizar(urlAutorizacao: string) {
  const psc = await fetch(urlAutorizacao, { redirect: 'manual' });
  expect([302, 303]).toContain(psc.status);
  const retorno = new URL(psc.headers.get('location')!, urlAutorizacao);
  expect(retorno.pathname.endsWith('/v1/documentos/assinaturas/retorno')).toBe(true);
  expect(retorno.searchParams.get('code')).toBeTruthy();
  const r = esperar(await api.chamar('GET', '/v1/documentos/assinaturas/retorno', { query: Object.fromEntries(retorno.searchParams) }), 302);
  return { location: r.headers.get('location')!, query: Object.fromEntries(retorno.searchParams) };
}

describe.runIf(!ativo)('documentos — módulo não contratado', () => {
  it('rotas e validação pública respondem 404; manifesto sem permissões, menu nem capacidade de assinatura', async () => {
    esperar(await api.chamar('GET', '/v1/documentos', { token: gestor.token }), 404, 'MODULO_NAO_CONTRATADO');
    esperar(await api.chamar('GET', '/v1/publico/documentos/ABCDEFGHJKLMNPQR'), 404);
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes.filter((p: string) => p.startsWith('documentos.'))).toEqual([]);
    expect(man.navegacao.filter((n: any) => n.destino.tela.startsWith('documentos.'))).toEqual([]);
    expect(man.capacidades.assinatura).toBeUndefined();
  });
});

describe.runIf(ativo)('documentos', () => {
  let tipos: string[];
  let entregaPeloChat: boolean;
  let provedor: string;
  beforeAll(async () => {
    const org = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200).body;
    tipos = org.documentos.tiposPermitidos;
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    entregaPeloChat = org.documentos.entregarPeloChat && man.modulos.some((m: any) => m.id === 'chat');
    provedor = man.capacidades.assinatura.provedores[0]?.id;
  });

  it('manifesto: quem emite recebe os provedores de assinatura; o paciente só lê e não recebe provedores', async () => {
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes).toEqual(expect.arrayContaining(['documentos.documento.ler', 'documentos.documento.emitir']));
    expect(man.navegacao.some((n: any) => n.destino.tela === 'documentos.lista')).toBe(true);
    expect(man.capacidades.assinatura.provedores.length).toBeGreaterThan(0);
    const manP = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    expect(manP.permissoes).toContain('documentos.documento.ler');
    expect(manP.permissoes).not.toContain('documentos.documento.emitir');
    expect(manP.capacidades.assinatura).toBeUndefined();
    expect(manP.navegacao.some((n: any) => n.destino.tela === 'documentos.meus')).toBe(true);
  });

  it('conteúdo validado: bloco do tipo, CID só com autorização, afastamento com dias, tipo habilitado; paciente não emite (RN-DOC-002/003/005)', async () => {
    const criar = (token: string, body: any) => api.chamar('POST', '/v1/documentos', { token, idempotencia: true, body });
    esperar(await criar(pacienteA.token, { pacienteId: pacienteA.pacienteId, tipo: 'RECEITA', receita: RECEITA }), 403);
    esperar(await criar(gestor.token, { pacienteId: pacienteA.pacienteId, tipo: 'RECEITA' }), 422, 'VALIDACAO_FALHOU');
    esperar(await criar(gestor.token, { pacienteId: pacienteA.pacienteId, tipo: 'RECEITA', receita: RECEITA, atestado: ATESTADO }), 422, 'VALIDACAO_FALHOU');
    if (tipos.includes('ATESTADO')) {
      esperar(await criar(gestor.token, { pacienteId: pacienteA.pacienteId, tipo: 'ATESTADO', atestado: { ...ATESTADO, dias: null } }), 422, 'VALIDACAO_FALHOU');
      esperar(await criar(gestor.token, { pacienteId: pacienteA.pacienteId, tipo: 'ATESTADO', atestado: { ...ATESTADO, cid: 'J01', cidAutorizado: false } }), 422, 'VALIDACAO_FALHOU');
      esperar(await criar(gestor.token, { pacienteId: pacienteA.pacienteId, tipo: 'ATESTADO', atestado: { modalidade: 'COMPARECIMENTO', data: '2026-11-10', horaInicio: '10:00', horaFim: '09:00' } }), 422, 'VALIDACAO_FALHOU');
    } else {
      esperar(await criar(gestor.token, { pacienteId: pacienteA.pacienteId, tipo: 'ATESTADO', atestado: ATESTADO }), 422, 'VALIDACAO_FALHOU');
    }
    // Arquivo de documento só o servidor cria.
    esperar(await api.chamar('POST', '/v1/arquivos', { token: gestor.token, idempotencia: true, body: { nome: 'r.pdf', tipo: 'application/pdf', tamanhoBytes: 100, finalidade: 'DOCUMENTO' } }), 422);
  });

  let doc: any;
  let etag: string;
  it('rascunho: só a equipe vê; seção e contador "para assinar"; edição com If-Match', async () => {
    const r = esperar(await api.chamar('POST', '/v1/documentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, tipo: 'RECEITA', receita: RECEITA } }), 201);
    doc = r.body;
    expect(doc).toMatchObject({ tipo: 'RECEITA', status: 'RASCUNHO', arquivo: null, codigoValidacao: null, entrega: null, emissor: { usuarioId: gestor.usuarioId }, receita: RECEITA, atestado: null });
    expect(doc.registro).toMatchObject({ conselho: expect.any(String), numero: expect.any(String), uf: expect.stringMatching(/^[A-Z]{2}$/) });
    expect(doc.acoesPermitidas).toEqual(expect.arrayContaining(['EDITAR', 'DESCARTAR', 'ASSINAR']));
    esperar(await api.chamar('GET', `/v1/documentos/${doc.id}`, { token: pacienteA.token }), 404);
    const meus = esperar(await api.chamar('GET', '/v1/documentos', { token: pacienteA.token, query: { limite: 100 } }), 200).body.itens;
    expect(meus.map((d: any) => d.id)).not.toContain(doc.id);
    const secao = esperar(await api.chamar('GET', '/v1/inicio', { token: gestor.token }), 200).body.secoes.find((s: any) => s.tipo === 'DOCUMENTOS_PARA_ASSINAR');
    expect(secao.dados.itens.map((d: any) => d.id)).toContain(doc.id);
    const cont = esperar(await api.chamar('GET', '/v1/contadores', { token: gestor.token }), 200).body;
    expect(cont['documentos.paraAssinar']).toBe(secao.dados.total);

    esperar(await api.chamar('PATCH', `/v1/documentos/${doc.id}`, { token: gestor.token, headers: { 'If-Match': '"velho"' }, body: { receita: RECEITA } }), 412, 'CONFLITO_VERSAO');
    const novaReceita = { ...RECEITA, orientacoes: 'Tomar após as refeições, com água.' };
    const e = esperar(await api.chamar('PATCH', `/v1/documentos/${doc.id}`, { token: gestor.token, headers: { 'If-Match': r.headers.get('etag')! }, body: { receita: novaReceita } }), 200);
    expect(e.body.receita.orientacoes).toBe('Tomar após as refeições, com água.');
    etag = e.headers.get('etag')!;
  });

  it('sessão de assinatura: retorno fora das origens do app, provedor desconhecido e documento de outro paciente/estado são recusados', async () => {
    const iniciar = (body: any) => api.chamar('POST', '/v1/documentos/assinaturas', { token: gestor.token, idempotencia: true, body });
    esperar(await iniciar({ documentosIds: [doc.id], provedor, retornoUrl: 'https://atacante.exemplo/roubar' }), 422, 'VALIDACAO_FALHOU');
    esperar(await iniciar({ documentosIds: [doc.id], provedor: 'inexistente', retornoUrl: RETORNO }), 422, 'ASSINATURA_INDISPONIVEL');
    esperar(await iniciar({ documentosIds: ['doc_inexistente'], provedor, retornoUrl: RETORNO }), 422, 'VALIDACAO_FALHOU');
    esperar(await api.chamar('POST', '/v1/documentos/assinaturas', { token: pacienteA.token, idempotencia: true, body: { documentosIds: [doc.id], provedor, retornoUrl: RETORNO } }), 403);
  });

  let pdf: Buffer;
  it('assinatura: PSC autoriza → retorno público assina e volta ao app; state é de uso único (ADR-0018)', async () => {
    const s = esperar(await api.chamar('POST', '/v1/documentos/assinaturas', { token: gestor.token, idempotencia: true, body: { documentosIds: [doc.id], provedor, retornoUrl: RETORNO } }), 201).body;
    expect(s).toMatchObject({ status: 'AGUARDANDO_AUTORIZACAO', provedor, documentosIds: [doc.id], erro: null });
    expect(new URL(s.urlAutorizacao).searchParams.get('state')).toBeTruthy();
    const assinando = esperar(await api.chamar('GET', `/v1/documentos/${doc.id}`, { token: gestor.token }), 200).body;
    expect(assinando.status).toBe('ASSINANDO');
    expect(assinando.acoesPermitidas).not.toContain('EDITAR');
    esperar(await api.chamar('PATCH', `/v1/documentos/${doc.id}`, { token: gestor.token, headers: { 'If-Match': '*' }, body: { receita: RECEITA } }), 422);

    const { location, query } = await autorizar(s.urlAutorizacao);
    expect(location).toBe(`${RETORNO}?assinatura=${s.id}`);
    // O mesmo retorno de novo (replay): state já usado.
    const replay = esperar(await api.chamar('GET', '/v1/documentos/assinaturas/retorno', { query }), 302);
    expect(replay.headers.get('location')).toMatch(/assinatura=invalida/);

    esperar(await api.chamar('GET', `/v1/documentos/assinaturas/${s.id}`, { token: pacienteA.token }), [403, 404]);
    const fim = esperar(await api.chamar('GET', `/v1/documentos/assinaturas/${s.id}`, { token: gestor.token }), 200).body;
    expect(fim).toMatchObject({ status: 'CONCLUIDA', urlAutorizacao: null });

    const d = esperar(await api.chamar('GET', `/v1/documentos/${doc.id}`, { token: gestor.token }), 200).body;
    expect(d).toMatchObject({ status: 'ASSINADO', arquivo: { tipo: 'application/pdf', finalidade: 'DOCUMENTO', status: 'DISPONIVEL', urlMiniatura: null } });
    expect(d.codigoValidacao).toMatch(/^[A-Z0-9]{16}$/);
    expect(d.assinadoEm).toBeTruthy();
    expect(d.acoesPermitidas).toEqual(['ANULAR']);
    doc = d;
    const r = await fetch(d.arquivo.urlVisualizacao);
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-disposition') ?? '').toMatch(/^attachment/);
    pdf = Buffer.from(await r.arrayBuffer());
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const cont = esperar(await api.chamar('GET', '/v1/contadores', { token: gestor.token }), 200).body;
    expect(cont['documentos.paraAssinar']).toBe(0 + (esperar(await api.chamar('GET', '/v1/documentos', { token: gestor.token, query: { status: 'RASCUNHO', emissorId: gestor.usuarioId, limite: 100 } }), 200).body.itens.length));
  });

  it('entrega: o paciente vê o assinado e baixa o PDF; pelo chat, chega como mensagem com referência DOCUMENTO; outro paciente não vê', async () => {
    const meu = esperar(await api.chamar('GET', `/v1/documentos/${doc.id}`, { token: pacienteA.token }), 200).body;
    expect(meu).toMatchObject({ status: 'ASSINADO', acoesPermitidas: [] });
    expect(meu.arquivo.urlVisualizacao).toBeTruthy();
    esperar(await api.chamar('GET', `/v1/documentos/${doc.id}`, { token: pacienteB.token }), 404);
    const lista = esperar(await api.chamar('GET', '/v1/documentos', { token: pacienteA.token, query: { limite: 100 } }), 200).body.itens;
    expect(lista.map((d: any) => d.id)).toContain(doc.id);
    if (entregaPeloChat) {
      expect(doc.entrega).toMatchObject({ conversaId: expect.any(String), mensagemId: expect.any(String) });
      const msgs = esperar(await api.chamar('GET', `/v1/conversas/${doc.entrega.conversaId}/mensagens`, { token: pacienteA.token, query: { limite: 50 } }), 200).body.itens;
      const m = msgs.find((x: any) => x.id === doc.entrega.mensagemId);
      expect(m).toMatchObject({ tipo: 'ANEXO', referencia: { tipo: 'DOCUMENTO', id: doc.id }, autor: { usuarioId: gestor.usuarioId } });
      expect(m.anexos.map((a: any) => a.id)).toEqual([doc.arquivo.id]);
    } else {
      expect(doc.entrega).toBeNull();
      const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: pacienteA.token, query: { limite: 20 } }), 200).body.itens;
      expect(ntf.some((n: any) => n.tipo === 'DOCUMENTO_DISPONIVEL' && n.destino?.parametros?.documentoId === doc.id)).toBe(true);
    }
  });

  it('validação pública: sem login, sem conteúdo clínico, com o SHA-256 do PDF entregue', async () => {
    const v = esperar(await api.chamar('GET', `/v1/publico/documentos/${doc.codigoValidacao}`), 200).body;
    expect(v).toMatchObject({ codigo: doc.codigoValidacao, tipo: 'RECEITA', situacao: 'VALIDO', anuladoEm: null, emissor: { registro: doc.registro } });
    expect(v.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(v.pacienteIniciais).toMatch(/^([A-ZÀ-Ý]\. ?)+$/);
    expect(JSON.stringify(v)).not.toMatch(/Amoxicilina|Conformidade/);
    esperar(await api.chamar('GET', '/v1/publico/documentos/ZZZZZZZZZZZZZZZZ'), 404);
  });

  it('recusa no provedor: sessão FALHOU e o documento volta a RASCUNHO com o motivo; descartar é idempotente', async () => {
    const tipo = tipos.includes('ATESTADO') ? 'ATESTADO' : 'RECEITA';
    const d = esperar(await api.chamar('POST', '/v1/documentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, tipo, ...(tipo === 'ATESTADO' ? { atestado: ATESTADO } : { receita: RECEITA }) } }), 201).body;
    const s = esperar(await api.chamar('POST', '/v1/documentos/assinaturas', { token: gestor.token, idempotencia: true, body: { documentosIds: [d.id], provedor, retornoUrl: RETORNO } }), 201).body;
    const state = new URL(s.urlAutorizacao).searchParams.get('state')!;
    const r = esperar(await api.chamar('GET', '/v1/documentos/assinaturas/retorno', { query: { state, error: 'access_denied' } }), 302);
    expect(r.headers.get('location')).toBe(`${RETORNO}?assinatura=${s.id}`);
    expect(esperar(await api.chamar('GET', `/v1/documentos/assinaturas/${s.id}`, { token: gestor.token }), 200).body).toMatchObject({ status: 'FALHOU', erro: expect.any(String) });
    const volta = esperar(await api.chamar('GET', `/v1/documentos/${d.id}`, { token: gestor.token }), 200).body;
    expect(volta).toMatchObject({ status: 'RASCUNHO', erroAssinatura: expect.any(String), arquivo: null });
    const x1 = esperar(await api.chamar('POST', `/v1/documentos/${d.id}/descartar`, { token: gestor.token }), 200).body;
    expect(x1).toMatchObject({ status: 'DESCARTADO', acoesPermitidas: [] });
    esperar(await api.chamar('POST', `/v1/documentos/${d.id}/descartar`, { token: gestor.token }), 200);
    esperar(await api.chamar('POST', '/v1/documentos/assinaturas', { token: gestor.token, idempotencia: true, body: { documentosIds: [d.id], provedor, retornoUrl: RETORNO } }), 422, 'VALIDACAO_FALHOU');
  });

  it('anular: só equipe que emite; paciente avisado; validação pública passa a ANULADO e o PDF continua guardado (RN-DOC-004)', async () => {
    esperar(await api.chamar('POST', `/v1/documentos/${doc.id}/anular`, { token: pacienteA.token, body: { motivo: 'Quero anular.' } }), 403);
    const a = esperar(await api.chamar('POST', `/v1/documentos/${doc.id}/anular`, { token: gestor.token, body: { motivo: 'Dose ajustada; nova receita emitida.' } }), 200).body;
    expect(a).toMatchObject({ status: 'ANULADO', motivoAnulacao: 'Dose ajustada; nova receita emitida.', acoesPermitidas: [] });
    expect(a.arquivo).not.toBeNull();
    const v = esperar(await api.chamar('GET', `/v1/publico/documentos/${doc.codigoValidacao}`), 200).body;
    expect(v.situacao).toBe('ANULADO');
    expect(v.anuladoEm).toBeTruthy();
    const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: pacienteA.token, query: { limite: 20 } }), 200).body.itens;
    expect(ntf.some((n: any) => n.tipo === 'DOCUMENTO_ANULADO' && n.destino?.parametros?.documentoId === doc.id)).toBe(true);
    expect(JSON.stringify(ntf.filter((n: any) => n.tipo.startsWith('DOCUMENTO_')))).not.toMatch(/Amoxicilina/);
  });

  it('configuração do módulo pelo gestor (PATCH /v1/organizacao)', async () => {
    const g = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200);
    const atual = g.body.documentos;
    const r = esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, headers: { 'If-Match': g.headers.get('etag')! }, body: { documentos: { entregarPeloChat: !atual.entregarPeloChat } } }), 200);
    expect(r.body.documentos).toEqual({ ...atual, entregarPeloChat: !atual.entregarPeloChat });
    esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, headers: { 'If-Match': r.headers.get('etag')! }, body: { documentos: atual } }), 200);
  });
});
