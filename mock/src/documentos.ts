// Módulo `documentos` no mock (ADR-0018): receita simples e atestado, assinatura por PSC em nuvem
// (simulado: autoriza sozinho) e entrega pelo chat. O PDF do mock é um PDF de verdade, mas a
// "assinatura" é simulada e o rodapé diz isso: nada aqui tem validade jurídica.
import { createHash, randomBytes } from 'node:crypto';
import { agendar, emitir, ErroApi, invalido, naoEncontrado, negado, novoId, type Org } from './estado.ts';
import * as r from './regras.ts';
import { type Ctx } from './regras.ts';
import { agoraIso, agoraMs, iso, MINUTO } from './tempo.ts';

export interface EstadoDocumentos { documentos: Map<string, any>; sessoes: Map<string, any>; porState: Map<string, string>; porCodigo: Map<string, string> }
export const documentosDe = (org: Org): EstadoDocumentos => {
  const o = org as any;
  o.__documentos ??= { documentos: new Map(), sessoes: new Map(), porState: new Map(), porCodigo: new Map() };
  return o.__documentos;
};
export const cfgDocumentos = (org: Org) => ({ tiposPermitidos: ['RECEITA', 'ATESTADO'], entregarPeloChat: true, ...(r.configModulo(org, 'documentos') as object) }) as { tiposPermitidos: string[]; entregarPeloChat: boolean };
/** Provedores (PSC) anunciados a quem emite. O mock só tem o simulado, que autoriza sozinho. */
export const provedores = (org: Org): Array<{ id: string; nome: string }> => (org.cenario as any).documentos?.provedores ?? [{ id: 'teste', nome: 'Certificado de teste (simulado)' }];
const VALIDADE_SESSAO = 10 * MINUTO;
const NOME_TIPO: Record<string, string> = { RECEITA: 'Receita', ATESTADO: 'Atestado' };

// ─────────── Visibilidade ───────────
const exigirDocumentos = (org: Org) => r.exigirModulo(org, 'documentos');
const visivelAoPaciente = (d: any) => d.status === 'ASSINADO' || d.status === 'ANULADO';
export function podeVerDocumento(ctx: Ctx, d: any): boolean {
  if (!ctx.perms.has('documentos.documento.ler')) return false;
  if (r.ehEquipe(ctx)) return true;
  return visivelAoPaciente(d) && r.podeVerPaciente(ctx, d.pacienteId);
}
function obter(ctx: Ctx, id: string) {
  const d = documentosDe(ctx.org).documentos.get(id);
  if (!d || !podeVerDocumento(ctx, d)) throw naoEncontrado('Documento');
  return d;
}
function equipeDosDocumentos(org: Org): string[] {
  return [...org.usuarios.values()].filter((u) => u.status === 'ATIVO' && r.usuarioEhEquipe(u)
    && u.perfis.some((pf) => pf !== 'PACIENTE' && r.permissoesDe(org, pf).includes('documentos.documento.ler'))).map((u) => u.id);
}
const interessados = (org: Org, d: any) => [...new Set([...equipeDosDocumentos(org), ...(visivelAoPaciente(d) ? r.contasIdsDoPaciente(org, d.pacienteId) : [])])];
const avisar = (org: Org, d: any) => {
  emitir(org, 'documentos.documento.atualizado', { documentoId: d.id }, interessados(org, d));
  r.avisarContadores(org)(d.emissorId);
};

// ─────────── Serialização ───────────
export function serDocumento(ctx: Ctx, d: any) {
  const org = ctx.org;
  const acoes: string[] = [];
  const souEmissor = d.emissorId === ctx.usuario.id;
  if (r.ehEquipe(ctx) && ctx.perms.has('documentos.documento.emitir')) {
    if (d.status === 'RASCUNHO' && souEmissor) acoes.push('EDITAR', 'DESCARTAR', 'ASSINAR');
    if (d.status === 'ASSINADO' && (souEmissor || ctx.perfil === 'GESTOR')) acoes.push('ANULAR');
  }
  const arq = d.arquivoId ? org.arquivos.get(d.arquivoId) : null;
  return {
    id: d.id, tipo: d.tipo, paciente: r.refPaciente(org, d.pacienteId), emissor: r.refUsuario(org, d.emissorId, 'PROFISSIONAL'),
    registro: d.registro, status: d.status, receita: d.receita ?? null, atestado: d.atestado ?? null,
    arquivo: arq ? r.serArquivo(org, arq) : null, codigoValidacao: d.codigo ?? null, entrega: d.entrega ?? null,
    motivoAnulacao: d.motivoAnulacao ?? null, erroAssinatura: d.erroAssinatura ?? null,
    criadoEm: d.criadoEm, assinadoEm: d.assinadoEm ?? null, anuladoEm: d.anuladoEm ?? null, acoesPermitidas: acoes,
  };
}
function serSessao(org: Org, s: any) {
  return {
    id: s.id, status: s.status, provedor: s.provedor, documentosIds: s.documentosIds,
    urlAutorizacao: s.status === 'AGUARDANDO_AUTORIZACAO' ? `${r.BASE_PUBLICA}/__mock/psc/${org.slug}/autorizar?state=${s.state}` : null,
    erro: s.erro ?? null, criadoEm: s.criadoEm, expiraEm: s.expiraEm,
  };
}

// ─────────── Validação do conteúdo (RN-DOC-003) ───────────
function validarConteudo(tipo: string, receita: any, atestado: any) {
  if (tipo === 'RECEITA') {
    if (!receita) throw invalido('receita', 'Informe os medicamentos.');
    if (atestado) throw invalido('atestado', 'Receita não leva atestado.');
  } else {
    if (!atestado) throw invalido('atestado', 'Informe o atestado.');
    if (receita) throw invalido('receita', 'Atestado não leva receita.');
    const a = atestado;
    if (a.modalidade === 'AFASTAMENTO' && !a.dias) throw invalido('atestado.dias', 'Informe os dias de afastamento.');
    if (a.modalidade === 'COMPARECIMENTO') {
      if (!a.horaInicio || !a.horaFim) throw invalido('atestado.horaInicio', 'Informe o horário do comparecimento.');
      if (a.horaFim <= a.horaInicio) throw invalido('atestado.horaFim', 'O fim precisa ser depois do início.');
    }
    if (a.cid && !a.cidAutorizado) throw invalido('atestado.cid', 'O CID só pode constar com a autorização expressa do paciente.');
  }
}
const normReceita = (x: any) => x && { itens: x.itens.map((i: any) => ({ medicamento: i.medicamento.trim(), posologia: i.posologia.trim(), quantidade: i.quantidade ?? null })), orientacoes: x.orientacoes ?? null };
const normAtestado = (x: any) => x && {
  modalidade: x.modalidade, data: x.data, dias: x.modalidade === 'AFASTAMENTO' ? x.dias : null,
  horaInicio: x.modalidade === 'COMPARECIMENTO' ? x.horaInicio : null, horaFim: x.modalidade === 'COMPARECIMENTO' ? x.horaFim : null,
  cid: x.cid ?? null, cidAutorizado: !!x.cidAutorizado, observacoes: x.observacoes ?? null,
};
function registroDe(org: Org, usuarioId: string) {
  const p = org.usuarios.get(usuarioId)?.profissional;
  if (!p?.conselho || !p?.numero || !p?.uf) throw new ErroApi('REGISTRO_PROFISSIONAL_AUSENTE', 'Cadastre seu registro no conselho (por exemplo, CRM e UF) para emitir documentos.');
  return { conselho: p.conselho, numero: p.numero, uf: p.uf };
}

// ─────────── Regras ───────────
export function criarDocumento(org: Org, d: { id?: string; pacienteId: string; emissorId: string; tipo: string; receita?: any; atestado?: any; criadoEm?: string }) {
  validarConteudo(d.tipo, d.receita, d.atestado);
  const doc = {
    id: d.id ?? novoId('doc'), tipo: d.tipo, pacienteId: d.pacienteId, emissorId: d.emissorId, registro: registroDe(org, d.emissorId),
    status: 'RASCUNHO', receita: normReceita(d.receita) ?? null, atestado: normAtestado(d.atestado) ?? null,
    arquivoId: null as string | null, codigo: null as string | null, sha256: null as string | null, entrega: null as any,
    motivoAnulacao: null as string | null, erroAssinatura: null as string | null, criadoEm: d.criadoEm ?? agoraIso(),
    assinadoEm: null as string | null, anuladoEm: null as string | null, _v: 1,
  };
  documentosDe(org).documentos.set(doc.id, doc);
  avisar(org, doc);
  return doc;
}

/** PDF simples, mas válido (com xref), em latin1 com as fontes padrão do PDF. */
export function gerarPdf(linhas: Array<{ t: string; tam?: number; negrito?: boolean }>): Buffer {
  let y = 800;
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\xff]/g, '?');
  const conteudo = linhas.map((l) => { const tam = l.tam ?? 11; y -= tam + 7; return `BT /${l.negrito ? 'F2' : 'F1'} ${tam} Tf 50 ${y} Td (${esc(l.t)}) Tj ET`; }).join('\n');
  const stream = Buffer.from(conteudo, 'latin1');
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R/F2 5 0 R>>>>/Contents 6 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
    `<</Length ${stream.length}>>\nstream\n${stream.toString('latin1')}\nendstream`,
  ];
  let s = '%PDF-1.4\n';
  const pos = objs.map((o, i) => { const p = Buffer.byteLength(s, 'latin1'); s += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
const dataBr = (d: string) => d.split('-').reverse().join('/');
function pdfDoDocumento(org: Org, d: any, codigo: string): Buffer {
  const pac = org.pacientes.get(d.pacienteId);
  const tutor = pac?.tipo === 'ANIMAL' ? r.contasDoPaciente(org, d.pacienteId)[0]?.nome : null;
  const emissor = org.usuarios.get(d.emissorId)!;
  const c = org.config.contato ?? {};
  const L: Array<{ t: string; tam?: number; negrito?: boolean }> = [
    { t: org.config.nome, tam: 14, negrito: true },
    { t: [c.endereco, c.telefone].filter(Boolean).join(' · ') },
    { t: '' }, { t: NOME_TIPO[d.tipo].toUpperCase(), tam: 16, negrito: true }, { t: '' },
    { t: `${pac?.tipo === 'ANIMAL' ? 'Animal' : 'Paciente'}: ${pac?.nome ?? ''}${tutor ? ` (tutor/a: ${tutor})` : ''}` },
  ];
  if (d.tipo === 'RECEITA') {
    L.push({ t: '' });
    d.receita.itens.forEach((i: any, n: number) => {
      L.push({ t: `${n + 1}. ${i.medicamento}${i.quantidade ? ` — ${i.quantidade}` : ''}`, negrito: true });
      L.push({ t: `   ${i.posologia}` });
    });
    if (d.receita.orientacoes) L.push({ t: '' }, { t: `Orientações: ${d.receita.orientacoes}` });
  } else {
    const a = d.atestado;
    L.push({ t: '' });
    L.push({ t: a.modalidade === 'AFASTAMENTO'
      ? `Atesto, para os devidos fins, que o(a) paciente necessita de ${a.dias} dia(s) de afastamento de suas atividades a partir de ${dataBr(a.data)}.`
      : `Atesto, para os devidos fins, que o(a) paciente compareceu a atendimento em ${dataBr(a.data)}, das ${a.horaInicio} às ${a.horaFim}.` });
    if (a.cid) L.push({ t: `CID: ${a.cid} (informado com autorização do paciente)` });
    if (a.observacoes) L.push({ t: a.observacoes });
  }
  L.push({ t: '' }, { t: `${emissor.nomeExibicao} — ${d.registro.conselho} ${d.registro.numero}/${d.registro.uf}`, negrito: true });
  L.push({ t: `Emitido em ${agoraIso().slice(0, 10).split('-').reverse().join('/')}` });
  L.push({ t: '' }, { t: `Código de validação: ${codigo}` }, { t: `${r.urlApi(org)}/v1/publico/documentos/${codigo}` });
  L.push({ t: '' }, { t: 'ASSINATURA SIMULADA (ambiente de teste) — este documento NÃO tem validade jurídica.', negrito: true });
  return gerarPdf(L);
}
const CARACTERES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const novoCodigo = () => [...randomBytes(16)].map((b) => CARACTERES[b % CARACTERES.length]).join('');

/** Assina (simulado), guarda o PDF e entrega: chat (se houver) e aviso ao paciente. */
export function assinar(org: Org, d: any, codigoFixo?: string) {
  const codigo = codigoFixo ?? novoCodigo();
  const bytes = pdfDoDocumento(org, d, codigo);
  const arqId = novoId('arq');
  const nome = `${NOME_TIPO[d.tipo].toLowerCase()}-${agoraIso().slice(0, 10)}.pdf`;
  org.arquivos.set(arqId, { id: arqId, nome, tipo: 'application/pdf', tamanhoBytes: bytes.length, finalidade: 'DOCUMENTO', status: 'DISPONIVEL', motivoRejeicao: null, criadoEm: agoraIso(), donoId: d.emissorId, bytes, documentoId: d.id });
  Object.assign(d, { status: 'ASSINADO', arquivoId: arqId, codigo, sha256: createHash('sha256').update(bytes).digest('hex'), assinadoEm: agoraIso(), erroAssinatura: null });
  d._v++;
  documentosDe(org).porCodigo.set(codigo, d.id);
  entregar(org, d);
  avisar(org, d);
}
function entregar(org: Org, d: any) {
  const contas = r.contasIdsDoPaciente(org, d.pacienteId);
  if (r.temModulo(org, 'chat') && cfgDocumentos(org).entregarPeloChat) {
    let c = r.conversaAtivaDoPaciente(org, d.pacienteId);
    if (!c) c = r.criarConversa(org, d.pacienteId, [d.emissorId, ...contas]);
    else r.adicionarParticipante(org, c, d.emissorId);
    // O aviso é o da própria mensagem (CHAT_MENSAGEM): sem notificação duplicada.
    const m = r.postarMensagem(org, c, { tipo: 'ANEXO', autorId: d.emissorId, texto: `${NOME_TIPO[d.tipo]} assinada digitalmente.`, anexosIds: [d.arquivoId], referencia: { tipo: 'DOCUMENTO', id: d.id, resumo: NOME_TIPO[d.tipo], temAlerta: false } });
    d.entrega = { conversaId: c.id, mensagemId: m.id, entregueEm: m.enviadoEm };
    return;
  }
  for (const uid of contas)
    r.notificarU(org, uid, { tipo: 'DOCUMENTO_DISPONIVEL', titulo: org.config.nome, texto: 'Você recebeu um documento.', destino: { tela: 'documentos.detalhe', parametros: { documentoId: d.id } } });
}
export function anular(org: Org, d: any, motivo: string, em = agoraIso()) {
  if (d.status === 'ANULADO') return d;
  if (d.status !== 'ASSINADO') throw invalido('status', 'Só documento assinado pode ser anulado.');
  Object.assign(d, { status: 'ANULADO', motivoAnulacao: motivo, anuladoEm: em }); d._v++;
  for (const uid of r.contasIdsDoPaciente(org, d.pacienteId))
    r.notificarU(org, uid, { tipo: 'DOCUMENTO_ANULADO', titulo: org.config.nome, texto: 'Um documento seu foi anulado pela equipe.', destino: { tela: 'documentos.detalhe', parametros: { documentoId: d.id } } });
  avisar(org, d);
  return d;
}
function encerrarSessao(org: Org, s: any, status: 'FALHOU' | 'EXPIRADA', erro: string) {
  if (s.status !== 'AGUARDANDO_AUTORIZACAO') return;
  s.status = status; s.erro = erro;
  documentosDe(org).porState.delete(s.state);
  for (const id of s.documentosIds) {
    const d = documentosDe(org).documentos.get(id);
    if (d?.status === 'ASSINANDO') { d.status = 'RASCUNHO'; d.erroAssinatura = erro; d._v++; avisar(org, d); }
  }
  emitir(org, 'documentos.assinatura.atualizada', { sessaoId: s.id }, [s.usuarioId]);
}

// ─────────── Tela inicial e contador ───────────
const rascunhosDe = (org: Org, usuarioId: string) => [...documentosDe(org).documentos.values()].filter((d) => d.emissorId === usuarioId && d.status === 'RASCUNHO');
export function contadorParaAssinar(org: Org, usuarioId: string, perms: Set<string>): number {
  if (!r.temModulo(org, 'documentos') || !perms.has('documentos.documento.emitir')) return 0;
  return rascunhosDe(org, usuarioId).length;
}
export function secoesInicio(ctx: Ctx): any[] {
  if (!r.temModulo(ctx.org, 'documentos') || !r.ehEquipe(ctx) || !ctx.perms.has('documentos.documento.emitir')) return [];
  const l = rascunhosDe(ctx.org, ctx.usuario.id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  return l.length ? [{ id: 'documentos-para-assinar', tipo: 'DOCUMENTOS_PARA_ASSINAR', dados: { total: l.length, itens: l.slice(0, 5).map((d) => serDocumento(ctx, d)) } }] : [];
}

// ─────────── Carga do cenário ───────────
export function carregarDocumentos(org: Org, cen: any) {
  for (const x of cen.documentos?.itens ?? []) {
    agendar(`seed:${x.id}:criar`, Date.parse(x.criadoEm), () => criarDocumento(org, { id: x.id, pacienteId: x.pacienteId, emissorId: x.emissorId, tipo: x.tipo, receita: x.receita, atestado: x.atestado, criadoEm: x.criadoEm }));
    if (x.assinar) agendar(`seed:${x.id}:assinar`, Date.parse(x.assinar.em), () => assinar(org, documentosDe(org).documentos.get(x.id), x.assinar.codigo));
    if (x.anular) agendar(`seed:${x.id}:anular`, Date.parse(x.anular.em), () => anular(org, documentosDe(org).documentos.get(x.id), x.anular.motivo));
  }
}

// ─────────── PSC simulado (rota /__mock, fora do contrato) ───────────
/** O "app do provedor": autoriza na hora e volta ao retorno público com um código de uso único. */
export function autorizarNoPsc(org: Org, state: string): string {
  const sid = documentosDe(org).porState.get(state);
  const s = sid ? documentosDe(org).sessoes.get(sid) : null;
  if (s) s.codigoPsc = randomBytes(12).toString('hex');
  return `${r.urlApi(org)}/v1/documentos/assinaturas/retorno?state=${encodeURIComponent(state)}${s ? `&code=${s.codigoPsc}` : '&error=invalid_request'}`;
}
const ORIGENS_LOCAIS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/;
function retornoPermitido(org: Org, url: string): boolean {
  try {
    const u = new URL(url);
    return ORIGENS_LOCAIS.test(u.origin) || (org.config.dominios ?? []).some((d: string) => u.origin === `https://${d}`);
  } catch { return false; }
}
const FRONTEND = process.env.MOCK_URL_FRONTEND ?? 'http://localhost:5173';
const comParametro = (url: string, valor: string) => `${url}${url.includes('?') ? '&' : '?'}assinatura=${encodeURIComponent(valor)}`;

// ─────────── Handlers ───────────
type Q = { org: Org; ctx: Ctx | null; params: Record<string, string>; query: Record<string, any>; body: any; headers: Record<string, any> };
type Res = { status: number; body?: any; headers?: Record<string, string> };
const C = (q: Q) => { exigirDocumentos(q.org); return q.ctx!; };
const ok = (body: any, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
const doMaisRecente = (a: any, b: any) => b.criadoEm.localeCompare(a.criadoEm) || b.id.localeCompare(a.id);
function exigirEmissor(ctx: Ctx, d?: any) {
  if (!r.ehEquipe(ctx)) throw negado();
  r.exigir(ctx, 'documentos.documento.emitir');
  if (d && d.emissorId !== ctx.usuario.id) throw negado('Só quem emitiu pode mudar este documento.');
}

export const handlersDocumentos: Record<string, (q: Q) => Res> = {
  documentosListar: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'documentos.documento.ler');
    let l = [...documentosDe(q.org).documentos.values()].filter((d) => podeVerDocumento(ctx, d));
    for (const [k, campo] of [['pacienteId', 'pacienteId'], ['tipo', 'tipo'], ['status', 'status'], ['emissorId', 'emissorId']] as const)
      if (q.query[k]) l = l.filter((d) => d[campo] === q.query[k]);
    const p = r.paginar(l.sort(doMaisRecente), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((d) => serDocumento(ctx, d)) });
  },
  documentosCriar: (q) => {
    const ctx = C(q);
    exigirEmissor(ctx);
    if (!cfgDocumentos(q.org).tiposPermitidos.includes(q.body.tipo)) throw invalido('tipo', 'Este tipo de documento não está habilitado nesta organização.');
    const pac = r.obterPaciente(ctx, q.body.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const d = criarDocumento(q.org, { pacienteId: pac.id, emissorId: ctx.usuario.id, tipo: q.body.tipo, receita: q.body.receita, atestado: q.body.atestado });
    return { status: 201, body: serDocumento(ctx, d), headers: { ETag: r.etag(d.id, d._v) } };
  },
  documentosObter: (q) => {
    const ctx = C(q);
    const d = obter(ctx, q.params.documentoId);
    return ok(serDocumento(ctx, d), { ETag: r.etag(d.id, d._v) });
  },
  documentosEditar: (q) => {
    const ctx = C(q);
    const d = obter(ctx, q.params.documentoId);
    exigirEmissor(ctx, d);
    r.conferirIfMatch(q.headers['if-match'], d.id, d._v, () => serDocumento(ctx, d));
    if (d.status !== 'RASCUNHO') throw invalido('status', d.status === 'ASSINANDO' ? 'O documento está sendo assinado.' : 'Só rascunho pode ser editado.');
    const receita = q.body.receita ?? (d.tipo === 'RECEITA' ? d.receita : undefined);
    const atestado = q.body.atestado ?? (d.tipo === 'ATESTADO' ? d.atestado : undefined);
    validarConteudo(d.tipo, receita, atestado);
    d.receita = normReceita(receita) ?? null; d.atestado = normAtestado(atestado) ?? null; d.erroAssinatura = null; d._v++;
    avisar(q.org, d);
    return ok(serDocumento(ctx, d), { ETag: r.etag(d.id, d._v) });
  },
  documentosDescartar: (q) => {
    const ctx = C(q);
    const d = obter(ctx, q.params.documentoId);
    exigirEmissor(ctx, d);
    if (d.status === 'DESCARTADO') return ok(serDocumento(ctx, d));
    if (d.status !== 'RASCUNHO') throw invalido('status', 'Só rascunho pode ser descartado.');
    d.status = 'DESCARTADO'; d._v++;
    avisar(q.org, d);
    return ok(serDocumento(ctx, d));
  },
  documentosAnular: (q) => {
    const ctx = C(q);
    const d = obter(ctx, q.params.documentoId);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'documentos.documento.emitir');
    if (d.emissorId !== ctx.usuario.id && ctx.perfil !== 'GESTOR') throw negado('Só quem emitiu ou a gestão pode anular.');
    return ok(serDocumento(ctx, anular(q.org, d, q.body.motivo.trim())));
  },
  documentosIniciarAssinatura: (q) => {
    const ctx = C(q);
    exigirEmissor(ctx);
    registroDe(q.org, ctx.usuario.id);
    if (!provedores(q.org).some((p) => p.id === q.body.provedor)) throw new ErroApi('ASSINATURA_INDISPONIVEL', 'Provedor de assinatura indisponível.');
    if (!retornoPermitido(q.org, q.body.retornoUrl)) throw invalido('retornoUrl', 'Endereço de retorno não permitido.');
    const docs = (q.body.documentosIds as string[]).map((id, i) => {
      const d = documentosDe(q.org).documentos.get(id);
      if (!d || d.emissorId !== ctx.usuario.id) throw invalido(`documentosIds.${i}`, 'Documento não encontrado entre os seus rascunhos.');
      if (d.status !== 'RASCUNHO') throw invalido(`documentosIds.${i}`, d.status === 'ASSINANDO' ? 'Este documento já está sendo assinado.' : 'Só rascunho pode ser assinado.');
      return d;
    });
    const s = { id: novoId('ass'), usuarioId: ctx.usuario.id, provedor: q.body.provedor, documentosIds: docs.map((d) => d.id), retornoUrl: q.body.retornoUrl,
      state: randomBytes(24).toString('base64url'), status: 'AGUARDANDO_AUTORIZACAO', erro: null as string | null, criadoEm: agoraIso(), expiraEm: iso(agoraMs() + VALIDADE_SESSAO), codigoPsc: null as string | null };
    const st = documentosDe(q.org);
    st.sessoes.set(s.id, s); st.porState.set(s.state, s.id);
    for (const d of docs) { d.status = 'ASSINANDO'; d.erroAssinatura = null; d._v++; avisar(q.org, d); }
    agendar(`assinatura:${s.id}:expirar`, agoraMs() + VALIDADE_SESSAO, () => encerrarSessao(q.org, s, 'EXPIRADA', 'A autorização no provedor não foi concluída a tempo.'));
    return { status: 201, body: serSessao(q.org, s) };
  },
  documentosObterAssinatura: (q) => {
    const ctx = C(q);
    const s = documentosDe(q.org).sessoes.get(q.params.sessaoId);
    if (!s || s.usuarioId !== ctx.usuario.id) throw naoEncontrado('Sessão de assinatura');
    return ok(serSessao(q.org, s));
  },
  documentosRetornoAssinatura: (q) => {
    exigirDocumentos(q.org);
    const st = documentosDe(q.org);
    const sid = st.porState.get(q.query.state);
    const s = sid ? st.sessoes.get(sid) : null;
    if (!s || s.status !== 'AGUARDANDO_AUTORIZACAO' || Date.parse(s.expiraEm) < agoraMs()) return { status: 302, headers: { Location: comParametro(`${FRONTEND}/documentos`, 'invalida') } };
    st.porState.delete(s.state); // uso único
    if (q.query.error || !q.query.code || q.query.code !== s.codigoPsc) {
      encerrarSessao(q.org, s, 'FALHOU', q.query.error === 'access_denied' ? 'A assinatura foi recusada no provedor.' : 'O provedor não autorizou a assinatura.');
    } else {
      s.status = 'ASSINANDO';
      for (const id of s.documentosIds) assinar(q.org, st.documentos.get(id));
      s.status = 'CONCLUIDA';
      emitir(q.org, 'documentos.assinatura.atualizada', { sessaoId: s.id }, [s.usuarioId]);
    }
    return { status: 302, headers: { Location: comParametro(s.retornoUrl, s.id) } };
  },
  publicoValidarDocumento: (q) => {
    exigirDocumentos(q.org);
    const st = documentosDe(q.org);
    const d = st.documentos.get(st.porCodigo.get(q.params.codigo) ?? '');
    if (!d) throw naoEncontrado('Documento');
    const nome = q.org.pacientes.get(d.pacienteId)?.nome ?? '';
    const iniciais = nome.split(/\s+/).filter(Boolean).map((p: string) => `${p[0].toUpperCase()}.`).join(' ');
    return ok({
      codigo: d.codigo, tipo: d.tipo, situacao: d.status === 'ANULADO' ? 'ANULADO' : 'VALIDO',
      emissor: { nome: q.org.usuarios.get(d.emissorId)!.nomeExibicao, registro: d.registro }, pacienteIniciais: iniciais,
      organizacao: q.org.config.nome, assinadoEm: d.assinadoEm, anuladoEm: d.anuladoEm ?? null, sha256: d.sha256,
    });
  },
};
