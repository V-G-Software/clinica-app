// Módulo documentos (ADR-0018): receita e atestado, sessão de assinatura no PSC, PAdES, entrega pelo
// chat e validação pública. Toda função recebe a transação com o contexto da organização.
import { createHash, randomBytes } from 'node:crypto';
import { configModulo, permissoesDe, temModulo } from '@clinica/dominio';
import { config } from '../config.ts';
import { cifrar, decifrar, novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { ErroApi, invalido } from '../erros.ts';
import { emitir } from '../eventos.ts';
import type { Log } from '../http.ts';
import { iso, type Ctx, type Org } from '../nucleo.ts';
import { serArquivo } from '../modulos/arquivos.ts';
import { adicionarParticipante, conversaAtivaDoPaciente, criarConversa, postarMensagem } from './chat.ts';
import { gerarPdfDocumento } from './documento-pdf.ts';
import { agendar, registrarJob } from './jobs.ts';
import { avisarContadores, notificar } from './notificar.ts';
import { embutir, preparar, verificar, cmsDeTeste } from './pades.ts';
import { ErroPsc, pkce, provedor, provedores } from './psc.ts';
import { contasDoPaciente, nomesPacientes, refUsuario, usuariosPorId } from './refs.ts';
import { storage } from './storage.ts';

export const cfgDocumentos = (org: Org) => {
  const c = configModulo(org.modulos, 'documentos');
  return { tiposPermitidos: (c.tiposPermitidos ?? ['RECEITA', 'ATESTADO']) as string[], entregarPeloChat: c.entregarPeloChat !== false };
};
/** Provedores anunciados a quem emite (vazio = não há como assinar: falha fechada). */
export const provedoresAnunciados = () => provedores().map((p) => ({ id: p.id, nome: p.nome }));
const NOME_TIPO: Record<string, string> = { RECEITA: 'Receita', ATESTADO: 'Atestado' };
const VALIDADE_SESSAO_MS = 10 * 60_000;

// ─────────── Destinatários ───────────
async function equipeComPermissao(tx: Tx, org: Org, permissao: string): Promise<string[]> {
  const us = await todos(tx, `SELECT id, perfis FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO'`, [org.id]);
  return us.filter((u) => (u.perfis as string[]).some((p) => p !== 'PACIENTE' && permissoesDe(org.modulos, p as any).includes(permissao))).map((u) => u.id);
}
const visivelAoPaciente = (d: any) => d.status === 'ASSINADO' || d.status === 'ANULADO';
async function avisar(tx: Tx, org: Org, d: any) {
  const para = [...new Set([...await equipeComPermissao(tx, org, 'documentos.documento.ler'), ...(visivelAoPaciente(d) ? await contasDoPaciente(tx, org, d.paciente_id) : [])])];
  await emitir(tx, org.id, 'documentos.documento.atualizado', { documentoId: d.id }, para);
  await avisarContadores(tx, org, [d.emissor_id]);
}

// ─────────── Serialização ───────────
export async function serDocumentos(tx: Tx, ctx: Ctx, linhas: any[]) {
  if (!linhas.length) return [];
  const org = ctx.org;
  const nomes = await nomesPacientes(tx, org, linhas.map((d) => d.paciente_id));
  const usuarios = await usuariosPorId(tx, org, linhas.map((d) => d.emissor_id));
  const arqIds = linhas.map((d) => d.arquivo_id).filter(Boolean);
  const arqs = arqIds.length ? await todos(tx, 'SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, arqIds]) : [];
  const emite = ctx.perfil !== 'PACIENTE' && ctx.perms.has('documentos.documento.emitir');
  return Promise.all(linhas.map(async (d) => {
    const acoes: string[] = [];
    if (emite && d.status === 'RASCUNHO' && d.emissor_id === ctx.usuario.id) acoes.push('EDITAR', 'DESCARTAR', 'ASSINAR');
    if (emite && d.status === 'ASSINADO' && (d.emissor_id === ctx.usuario.id || ctx.perfil === 'GESTOR')) acoes.push('ANULAR');
    const a = arqs.find((x) => x.id === d.arquivo_id);
    return {
      id: d.id, tipo: d.tipo, paciente: { id: d.paciente_id, nome: nomes.get(d.paciente_id) ?? '—' },
      emissor: refUsuario(usuarios.get(d.emissor_id), d.emissor_id, 'PROFISSIONAL'), registro: d.registro, status: d.status,
      receita: d.receita ?? null, atestado: d.atestado ?? null, arquivo: a ? await serArquivo(a) : null,
      codigoValidacao: d.codigo ?? null,
      entrega: d.mensagem_id ? { conversaId: d.conversa_id, mensagemId: d.mensagem_id, entregueEm: iso(d.entregue_em) } : null,
      motivoAnulacao: d.motivo_anulacao ?? null, erroAssinatura: d.erro_assinatura ?? null,
      criadoEm: iso(d.criado_em), assinadoEm: iso(d.assinado_em), anuladoEm: iso(d.anulado_em), acoesPermitidas: acoes,
    };
  }));
}
export function serSessao(s: any) {
  return {
    id: s.id, status: s.status, provedor: s.provedor, documentosIds: s.documentos_ids,
    urlAutorizacao: s.status === 'AGUARDANDO_AUTORIZACAO' ? s.url_autorizacao : null,
    erro: s.erro ?? null, criadoEm: iso(s.criado_em), expiraEm: iso(s.expira_em),
  };
}

// ─────────── Conteúdo (RN-DOC-003) ───────────
export function validarConteudo(tipo: string, receita: any, atestado: any) {
  if (tipo === 'RECEITA') {
    if (!receita) throw invalido('receita', 'Informe os medicamentos.');
    if (atestado) throw invalido('atestado', 'Receita não leva atestado.');
    return;
  }
  if (!atestado) throw invalido('atestado', 'Informe o atestado.');
  if (receita) throw invalido('receita', 'Atestado não leva receita.');
  if (atestado.modalidade === 'AFASTAMENTO' && !atestado.dias) throw invalido('atestado.dias', 'Informe os dias de afastamento.');
  if (atestado.modalidade === 'COMPARECIMENTO') {
    if (!atestado.horaInicio || !atestado.horaFim) throw invalido('atestado.horaInicio', 'Informe o horário do comparecimento.');
    if (atestado.horaFim <= atestado.horaInicio) throw invalido('atestado.horaFim', 'O fim precisa ser depois do início.');
  }
  // CFM 1.658/2002: diagnóstico (CID) só com autorização expressa do paciente.
  if (atestado.cid && !atestado.cidAutorizado) throw invalido('atestado.cid', 'O CID só pode constar com a autorização expressa do paciente.');
}
export const normReceita = (x: any) => x && { itens: x.itens.map((i: any) => ({ medicamento: i.medicamento.trim(), posologia: i.posologia.trim(), quantidade: i.quantidade?.trim() || null })), orientacoes: x.orientacoes?.trim() || null };
export const normAtestado = (x: any) => x && {
  modalidade: x.modalidade, data: x.data, dias: x.modalidade === 'AFASTAMENTO' ? x.dias : null,
  horaInicio: x.modalidade === 'COMPARECIMENTO' ? x.horaInicio : null, horaFim: x.modalidade === 'COMPARECIMENTO' ? x.horaFim : null,
  cid: x.cid ?? null, cidAutorizado: !!x.cidAutorizado, observacoes: x.observacoes?.trim() || null,
};
export async function registroDe(tx: Tx, org: Org, usuarioId: string) {
  const p = (await um(tx, 'SELECT profissional FROM usuarios WHERE organizacao_id = $1 AND id = $2', [org.id, usuarioId]))?.profissional;
  if (!p?.conselho || !p?.numero || !p?.uf) throw new ErroApi('REGISTRO_PROFISSIONAL_AUSENTE', 'Cadastre seu registro no conselho (por exemplo, CRM e UF) para emitir documentos.');
  return { conselho: p.conselho, numero: p.numero, uf: p.uf };
}

// ─────────── Regras ───────────
export async function criarDocumento(tx: Tx, org: Org, d: { id?: string; pacienteId: string; emissorId: string; tipo: string; receita?: any; atestado?: any; criadoEm?: Date }) {
  validarConteudo(d.tipo, d.receita, d.atestado);
  const registro = await registroDe(tx, org, d.emissorId);
  const doc = (await um(tx, `INSERT INTO documentos (organizacao_id, id, tipo, paciente_id, emissor_id, registro, receita, atestado, criado_em)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now())) RETURNING *`,
    [org.id, d.id ?? novoId('doc'), d.tipo, d.pacienteId, d.emissorId, registro, normReceita(d.receita) ?? null, normAtestado(d.atestado) ?? null, d.criadoEm ?? null]))!;
  await avisar(tx, org, doc);
  return doc;
}
export async function anular(tx: Tx, org: Org, d: any, motivo: string, log: Log, em?: Date) {
  if (d.status === 'ANULADO') return d;
  if (d.status !== 'ASSINADO') throw invalido('status', 'Só documento assinado pode ser anulado.');
  const r = (await um(tx, `UPDATE documentos SET status = 'ANULADO', motivo_anulacao = $3, anulado_em = COALESCE($4, now()), versao = versao + 1
                           WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, d.id, motivo, em ?? null]))!;
  for (const uid of await contasDoPaciente(tx, org, r.paciente_id))
    await notificar(tx, org, uid, { tipo: 'DOCUMENTO_ANULADO', titulo: org.nome, texto: 'Um documento seu foi anulado pela equipe.', destino: { tela: 'documentos.detalhe', parametros: { documentoId: r.id } } }, log);
  await avisar(tx, org, r);
  return r;
}

// ─────────── Sessão de assinatura ───────────
const ORIGENS_DEV = /^https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/;
export function retornoPermitido(org: Org, url: string) {
  try {
    const o = new URL(url).origin;
    return (!config.producao && ORIGENS_DEV.test(o)) || org.dominios.some((d) => o === `https://${d}`);
  } catch { return false; }
}
const hashState = (state: string) => createHash('sha256').update(state).digest('hex');
export const urlRetorno = (org: Org) => `${org.urlApi}/v1/documentos/assinaturas/retorno`;
export const frontendPadrao = (org: Org) => (org.dominios[0] ? `https://${org.dominios[0]}` : 'http://localhost:5173');
const comParametro = (url: string, v: string) => `${url}${url.includes('?') ? '&' : '?'}assinatura=${encodeURIComponent(v)}`;

export async function iniciarSessao(tx: Tx, ctx: Ctx, b: { documentosIds: string[]; provedor: string; retornoUrl: string }) {
  const org = ctx.org;
  await registroDe(tx, org, ctx.usuario.id);
  const p = provedor(b.provedor);
  if (!p) throw new ErroApi('ASSINATURA_INDISPONIVEL', 'Provedor de assinatura indisponível.');
  if (!retornoPermitido(org, b.retornoUrl)) throw invalido('retornoUrl', 'Endereço de retorno não permitido.');
  const docs = await todos(tx, `SELECT * FROM documentos WHERE organizacao_id = $1 AND id = ANY($2) FOR UPDATE`, [org.id, b.documentosIds]);
  b.documentosIds.forEach((id, i) => {
    const d = docs.find((x) => x.id === id);
    if (!d || d.emissor_id !== ctx.usuario.id) throw invalido(`documentosIds.${i}`, 'Documento não encontrado entre os seus rascunhos.');
    if (d.status !== 'RASCUNHO') throw invalido(`documentosIds.${i}`, d.status === 'ASSINANDO' ? 'Este documento já está sendo assinado.' : 'Só rascunho pode ser assinado.');
  });
  const state = randomBytes(24).toString('base64url');
  const { verificador, desafio } = pkce();
  const id = novoId('ass');
  const url = p.urlAutorizacao({ state, desafio, redirectUri: urlRetorno(org), quantidade: docs.length });
  const s = (await um(tx, `INSERT INTO sessoes_assinatura (organizacao_id, id, usuario_id, provedor, documentos_ids, retorno_url, state_hash, verificador_cifrado, url_autorizacao, expira_em)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [org.id, id, ctx.usuario.id, p.id, b.documentosIds, b.retornoUrl, hashState(state), cifrar(verificador), url, new Date(Date.now() + VALIDADE_SESSAO_MS)]))!;
  for (const d of docs) {
    const r = (await um(tx, `UPDATE documentos SET status = 'ASSINANDO', erro_assinatura = NULL, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, d.id]))!;
    await avisar(tx, org, r);
  }
  await agendar(tx, org.id, `assinatura:${id}:expirar`, 'documentos.assinatura.expirar', s.expira_em, { sessaoId: id });
  return s;
}
async function encerrarSessao(tx: Tx, org: Org, s: any, status: 'FALHOU' | 'EXPIRADA', erro: string) {
  await tx.query(`UPDATE sessoes_assinatura SET status = $3, erro = $4 WHERE organizacao_id = $1 AND id = $2`, [org.id, s.id, status, erro]);
  const voltaram = await todos(tx, `UPDATE documentos SET status = 'RASCUNHO', erro_assinatura = $3, versao = versao + 1
                                    WHERE organizacao_id = $1 AND id = ANY($2) AND status = 'ASSINANDO' RETURNING *`, [org.id, s.documentos_ids, erro]);
  for (const d of voltaram) await avisar(tx, org, d);
  await emitir(tx, org.id, 'documentos.assinatura.atualizada', { sessaoId: s.id }, [s.usuario_id]);
}
registrarJob('documentos.assinatura.expirar', async (tx, orgId, dados) => {
  const s = await um(tx, `SELECT * FROM sessoes_assinatura WHERE organizacao_id = $1 AND id = $2 FOR UPDATE`, [orgId, dados.sessaoId]);
  if (s?.status !== 'AGUARDANDO_AUTORIZACAO') return;
  const { orgPorId } = await import('./refs.ts');
  await encerrarSessao(tx, await orgPorId(orgId), s, 'EXPIRADA', 'A autorização no provedor não foi concluída a tempo.');
});

/**
 * Retorno público do PSC (302). `state` de uso único: a sessão sai de AGUARDANDO_AUTORIZACAO na hora,
 * antes de qualquer chamada ao PSC — um replay do mesmo retorno cai em "inválida".
 */
export async function retorno(tx: Tx, org: Org, q: { state: string; code?: string; error?: string }, log: Log): Promise<string> {
  const s = await um(tx, `SELECT * FROM sessoes_assinatura WHERE organizacao_id = $1 AND state_hash = $2 FOR UPDATE`, [org.id, hashState(q.state)]);
  if (!s || s.status !== 'AGUARDANDO_AUTORIZACAO' || new Date(s.expira_em).getTime() < Date.now()) return comParametro(`${frontendPadrao(org)}/documentos`, 'invalida');
  await tx.query(`UPDATE sessoes_assinatura SET status = 'ASSINANDO' WHERE organizacao_id = $1 AND id = $2`, [org.id, s.id]);
  if (q.error || !q.code) {
    await encerrarSessao(tx, org, { ...s }, 'FALHOU', q.error === 'access_denied' ? 'A assinatura foi recusada no provedor.' : 'O provedor não autorizou a assinatura.');
    return comParametro(s.retorno_url, s.id);
  }
  const p = provedor(s.provedor);
  try {
    if (!p) throw new ErroPsc('provedor não está mais configurado');
    const token = await p.trocarCodigo({ code: q.code, verificador: decifrar(s.verificador_cifrado), redirectUri: urlRetorno(org) });
    await assinarDocumentos(tx, org, s.documentos_ids, (hashes) => p.assinar(token, hashes), log);
    await tx.query(`UPDATE sessoes_assinatura SET status = 'CONCLUIDA' WHERE organizacao_id = $1 AND id = $2`, [org.id, s.id]);
    await emitir(tx, org.id, 'documentos.assinatura.atualizada', { sessaoId: s.id }, [s.usuario_id]);
  } catch (e: any) {
    log.warn({ err: e?.message, sessaoId: s.id, provedor: s.provedor }, 'assinatura não concluída');
    await encerrarSessao(tx, org, s, 'FALHOU', e instanceof ErroPsc ? `O provedor recusou a assinatura (${e.message}).` : 'Não foi possível concluir a assinatura. Tente de novo.');
  }
  return comParametro(s.retorno_url, s.id);
}

// ─────────── Assinatura: PDF → hash → PSC → PAdES → entrega ───────────
const CARACTERES = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const novoCodigo = () => [...randomBytes(16)].map((b) => CARACTERES[b % CARACTERES.length]).join('');
const dataLocal = (org: Org, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: org.fuso }).format(d);

export async function assinarDocumentos(tx: Tx, org: Org, ids: string[], assinarHashes: (hashes: Buffer[]) => Promise<Buffer[]>, log: Log, opcoes: { em?: Date; codigos?: Record<string, string> } = {}) {
  const docs = await todos(tx, `SELECT * FROM documentos WHERE organizacao_id = $1 AND id = ANY($2) FOR UPDATE`, [org.id, ids]);
  const em = opcoes.em ?? new Date();
  const preparados = [];
  for (const d of docs) {
    const codigo = opcoes.codigos?.[d.id] ?? novoCodigo();
    const bytes = await gerarPdfDocumento(await dadosPdf(tx, org, d, codigo, em));
    const usuarios = await usuariosPorId(tx, org, [d.emissor_id]);
    preparados.push({ d, codigo, p: await preparar(bytes, { nome: usuarios.get(d.emissor_id)?.nome_exibicao ?? '', motivo: NOME_TIPO[d.tipo], local: org.nome, em }) });
  }
  const cms = await assinarHashes(preparados.map((x) => x.p.hash));
  for (const [i, { d, codigo, p }] of preparados.entries()) {
    const pdf = embutir(p, cms[i]);
    const v = verificar(pdf); // o CMS precisa corresponder a este PDF antes de chegar a alguém
    if (!v.ok) throw new ErroPsc(`assinatura devolvida não confere: ${v.motivo}`);
    const arqId = novoId('arq');
    const chave = `final/${org.id}/${arqId}`;
    await storage.gravar(chave, pdf, 'application/pdf');
    await tx.query(`INSERT INTO arquivos (organizacao_id, id, dono_id, nome, tipo, tamanho_bytes, finalidade, status, chave_storage, usado_em)
                    VALUES ($1,$2,$3,$4,'application/pdf',$5,'DOCUMENTO','DISPONIVEL',$6, now())`,
      [org.id, arqId, d.emissor_id, `${NOME_TIPO[d.tipo].toLowerCase()}-${dataLocal(org, em)}.pdf`, pdf.length, chave]);
    const r = (await um(tx, `UPDATE documentos SET status = 'ASSINADO', arquivo_id = $3, codigo = $4, sha256 = $5, assinado_em = $6, erro_assinatura = NULL, versao = versao + 1
                             WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, d.id, arqId, codigo, createHash('sha256').update(pdf).digest('hex'), em]))!;
    await entregar(tx, org, r, log);
    await avisar(tx, org, r);
  }
}
async function dadosPdf(tx: Tx, org: Org, d: any, codigo: string, em: Date) {
  const pac = (await um(tx, 'SELECT nome, tipo FROM pacientes WHERE organizacao_id = $1 AND id = $2', [org.id, d.paciente_id]))!;
  const tutor = pac.tipo === 'ANIMAL'
    ? (await um(tx, `SELECT u.nome FROM vinculos v JOIN usuarios u ON u.organizacao_id = v.organizacao_id AND u.id = v.usuario_id WHERE v.organizacao_id = $1 AND v.paciente_id = $2 ORDER BY u.nome LIMIT 1`, [org.id, d.paciente_id]))?.nome ?? null
    : null;
  const emissor = (await usuariosPorId(tx, org, [d.emissor_id])).get(d.emissor_id);
  const c = org.configuracao?.contato ?? {};
  return {
    tipo: d.tipo, organizacao: { nome: org.nome, endereco: c.endereco ?? null, telefone: c.telefone ?? null },
    emissor: { nome: emissor?.nome_exibicao ?? '', ...d.registro }, paciente: { nome: pac.nome, animal: pac.tipo === 'ANIMAL', tutor },
    receita: d.receita ?? null, atestado: d.atestado ?? null, emitidoEm: dataLocal(org, em), codigo,
    urlValidacao: `${org.urlApi}/v1/publico/documentos/${codigo}`, teste: config.psc.teste && !config.producao,
  };
}
/** Pelo chat (o aviso é a própria mensagem) ou, sem ele, notificação DOCUMENTO_DISPONIVEL. */
async function entregar(tx: Tx, org: Org, d: any, log: Log) {
  const contas = await contasDoPaciente(tx, org, d.paciente_id);
  if (temModulo(org.modulos, 'chat') && cfgDocumentos(org).entregarPeloChat) {
    let c = await conversaAtivaDoPaciente(tx, org, d.paciente_id);
    if (!c) c = (await criarConversa(tx, org, d.paciente_id, [d.emissor_id, ...contas])).conversa;
    else await adicionarParticipante(tx, org, c.id, d.emissor_id);
    const m = await postarMensagem(tx, org, c, { tipo: 'ANEXO', autorId: d.emissor_id, texto: `${NOME_TIPO[d.tipo]} assinada digitalmente.`, anexosIds: [d.arquivo_id], referencia: { tipo: 'DOCUMENTO', id: d.id, resumo: NOME_TIPO[d.tipo], temAlerta: false } }, log);
    await tx.query(`UPDATE documentos SET conversa_id = $3, mensagem_id = $4, entregue_em = $5 WHERE organizacao_id = $1 AND id = $2`, [org.id, d.id, c.id, m.id, m.enviado_em]);
    Object.assign(d, { conversa_id: c.id, mensagem_id: m.id, entregue_em: m.enviado_em });
    return;
  }
  for (const uid of contas)
    await notificar(tx, org, uid, { tipo: 'DOCUMENTO_DISPONIVEL', titulo: org.nome, texto: 'Você recebeu um documento.', destino: { tela: 'documentos.detalhe', parametros: { documentoId: d.id } } }, log);
}
/** Assinador do seed: CMS do PSC de teste direto (sem OAuth). Só fora de produção. */
export const assinadorDeTeste = async (hashes: Buffer[]) => hashes.map((h) => cmsDeTeste(h));

// ─────────── Tela inicial, contador e validação pública ───────────
export async function contadorParaAssinar(tx: Tx, org: Org, usuarioId: string, perms: Set<string>): Promise<number> {
  if (!temModulo(org.modulos, 'documentos') || !perms.has('documentos.documento.emitir')) return 0;
  return (await um<{ n: number }>(tx, `SELECT count(*)::int AS n FROM documentos WHERE organizacao_id = $1 AND emissor_id = $2 AND status = 'RASCUNHO'`, [org.id, usuarioId]))!.n;
}
export async function secoesInicioDocumentos(tx: Tx, ctx: Ctx): Promise<any[]> {
  if (!temModulo(ctx.org.modulos, 'documentos') || ctx.perfil === 'PACIENTE' || !ctx.perms.has('documentos.documento.emitir')) return [];
  const total = await contadorParaAssinar(tx, ctx.org, ctx.usuario.id, ctx.perms);
  if (!total) return [];
  const linhas = await todos(tx, `SELECT * FROM documentos WHERE organizacao_id = $1 AND emissor_id = $2 AND status = 'RASCUNHO' ORDER BY criado_em DESC, id DESC LIMIT 5`, [ctx.org.id, ctx.usuario.id]);
  return [{ id: 'documentos-para-assinar', tipo: 'DOCUMENTOS_PARA_ASSINAR', dados: { total, itens: await serDocumentos(tx, ctx, linhas) } }];
}
export async function validacaoPublica(tx: Tx, org: Org, codigo: string) {
  const d = await um(tx, `SELECT d.*, p.nome AS paciente_nome FROM documentos d JOIN pacientes p ON p.organizacao_id = d.organizacao_id AND p.id = d.paciente_id
                          WHERE d.organizacao_id = $1 AND d.codigo = $2 AND d.status IN ('ASSINADO','ANULADO')`, [org.id, codigo]);
  if (!d) return null;
  const emissor = (await usuariosPorId(tx, org, [d.emissor_id])).get(d.emissor_id);
  const iniciais = String(d.paciente_nome).split(/\s+/).filter(Boolean).map((p: string) => `${p[0].toUpperCase()}.`).join(' ');
  return {
    codigo: d.codigo, tipo: d.tipo, situacao: d.status === 'ANULADO' ? 'ANULADO' : 'VALIDO',
    emissor: { nome: emissor?.nome_exibicao ?? '', registro: d.registro }, pacienteIniciais: iniciais, organizacao: org.nome,
    assinadoEm: iso(d.assinado_em), anuladoEm: iso(d.anulado_em), sha256: d.sha256,
  };
}
