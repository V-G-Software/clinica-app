// Módulo exames (ADR-0017): regras RN-EXA-001..006, serialização, seções do início e contador.
// Toda função recebe a transação com o contexto da organização.
import { configModulo, permissoesDe, temModulo, type Termo } from '@clinica/dominio';
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { invalido } from '../erros.ts';
import { emitir } from '../eventos.ts';
import type { Log } from '../http.ts';
import { iso, type Ctx, type Org } from '../nucleo.ts';
import { serArquivo } from '../modulos/arquivos.ts';
import { antivirusConfigurado } from './antivirus.ts';
import { avisarContadores, notificar } from './notificar.ts';
import { contasDoPaciente, nomesPacientes, refUsuario, usuariosPorId } from './refs.ts';

export const cfgExames = (org: Org) => ({ pacienteEnviaResultados: configModulo(org.modulos, 'exames').pacienteEnviaResultados !== false });
const termoExame = (org: Org): Termo => (org.termos as Record<string, Termo>).exame ?? { singular: 'exame', plural: 'exames', genero: 'M' };

// ─────────── Arquivos de exame ───────────
/**
 * Upload anunciado no manifesto: `tiposPermitidosExame` só com o módulo, e PDF só com antivírus
 * configurado (falha fechada: sem antivírus, o app nem oferece PDF).
 */
export function capacidadeUpload(org: Org) {
  const { tiposPermitidosExame, ...up } = org.capacidades.upload ?? {};
  if (!temModulo(org.modulos, 'exames')) return up;
  const tipos = ((tiposPermitidosExame ?? up.tiposPermitidos) as string[]).filter((t) => t !== 'application/pdf' || antivirusConfigurado());
  return { ...up, tiposPermitidosExame: tipos };
}
export function tiposPermitidos(org: Org, finalidade: string): string[] {
  const up = capacidadeUpload(org) as { tiposPermitidos: string[]; tiposPermitidosExame?: string[] };
  return finalidade === 'EXAME' ? up.tiposPermitidosExame ?? [] : up.tiposPermitidos;
}

// ─────────── Destinatários ───────────
async function equipeComPermissao(tx: Tx, org: Org, permissao: string): Promise<string[]> {
  const us = await todos(tx, `SELECT id, perfis FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO'`, [org.id]);
  return us.filter((u) => (u.perfis as string[]).some((p) => p !== 'PACIENTE' && permissoesDe(org.modulos, p as any).includes(permissao))).map((u) => u.id);
}
const interessados = async (tx: Tx, org: Org, pacienteId: string) =>
  [...new Set([...await equipeComPermissao(tx, org, 'exames.exame.ler'), ...await contasDoPaciente(tx, org, pacienteId)])];
/** Quem revisa (RN-EXA-005): o solicitante do pedido; sem pedido (ou solicitante inativo), quem pode revisar. */
async function revisores(tx: Tx, org: Org, pedidoId: string | null): Promise<string[]> {
  if (pedidoId) {
    const s = await um(tx, `SELECT u.id FROM pedidos_exame p JOIN usuarios u ON u.organizacao_id = p.organizacao_id AND u.id = p.solicitante_id
                            WHERE p.organizacao_id = $1 AND p.id = $2 AND u.status = 'ATIVO'`, [org.id, pedidoId]);
    if (s) return [s.id];
  }
  return equipeComPermissao(tx, org, 'exames.resultado.revisar');
}

// ─────────── Serialização ───────────
export async function serPedidos(tx: Tx, ctx: Ctx, linhas: any[]) {
  if (!linhas.length) return [];
  const org = ctx.org;
  const equipe = ctx.perfil !== 'PACIENTE';
  const nomes = await nomesPacientes(tx, org, linhas.map((p) => p.paciente_id));
  const usuarios = await usuariosPorId(tx, org, linhas.map((p) => p.solicitante_id));
  const res = await todos(tx, `SELECT id, pedido_id, titulo, status, criado_em FROM resultados_exame WHERE organizacao_id = $1 AND pedido_id = ANY($2) ORDER BY criado_em, id`, [org.id, linhas.map((p) => p.id)]);
  const envia = ctx.perms.has('exames.resultado.enviar') && (equipe || cfgExames(org).pacienteEnviaResultados);
  return linhas.map((p) => {
    const acoes: string[] = [];
    if (p.status === 'ABERTO') {
      if (envia) acoes.push('ENVIAR_RESULTADO');
      if (equipe && ctx.perms.has('exames.pedido.criar')) acoes.push('CONCLUIR', 'CANCELAR');
    }
    return {
      id: p.id, paciente: { id: p.paciente_id, nome: nomes.get(p.paciente_id) ?? '—' },
      solicitante: refUsuario(usuarios.get(p.solicitante_id), p.solicitante_id, 'PROFISSIONAL'),
      itens: (p.itens as any[]).map((i) => ({ nome: i.nome, orientacoes: i.orientacoes ?? null })),
      orientacoes: p.orientacoes ?? null, observacao: equipe ? p.observacao ?? null : null,
      status: p.status, motivoCancelamento: p.motivo_cancelamento ?? null,
      resultados: res.filter((x) => x.pedido_id === p.id).map((x) => ({ id: x.id, titulo: x.titulo, status: x.status, criadoEm: iso(x.criado_em) })),
      criadoEm: iso(p.criado_em), concluidoEm: iso(p.concluido_em), acoesPermitidas: acoes,
    };
  });
}
export async function serResultados(tx: Tx, ctx: Ctx, linhas: any[]) {
  if (!linhas.length) return [];
  const org = ctx.org;
  const nomes = await nomesPacientes(tx, org, linhas.map((x) => x.paciente_id));
  const usuarios = await usuariosPorId(tx, org, linhas.flatMap((x) => [x.enviado_por, x.revisado_por].filter(Boolean)));
  const arqs = await todos(tx, `SELECT ra.resultado_id, a.* FROM resultado_arquivos ra JOIN arquivos a ON a.organizacao_id = ra.organizacao_id AND a.id = ra.arquivo_id
                                WHERE ra.organizacao_id = $1 AND ra.resultado_id = ANY($2) ORDER BY ra.ordem`, [org.id, linhas.map((x) => x.id)]);
  const revisa = ctx.perfil !== 'PACIENTE' && ctx.perms.has('exames.resultado.revisar');
  return Promise.all(linhas.map(async (x) => ({
    id: x.id, paciente: { id: x.paciente_id, nome: nomes.get(x.paciente_id) ?? '—' }, pedidoId: x.pedido_id ?? null,
    titulo: x.titulo, dataColeta: x.data_coleta ?? null,
    arquivos: await Promise.all(arqs.filter((a) => a.resultado_id === x.id).map((a) => serArquivo(a))),
    comentario: x.comentario ?? null, origem: x.origem,
    enviadoPor: refUsuario(usuarios.get(x.enviado_por), x.enviado_por),
    status: x.status,
    revisao: x.revisado_em ? { por: refUsuario(usuarios.get(x.revisado_por), x.revisado_por), revisadoEm: iso(x.revisado_em), nota: x.nota_revisao ?? null } : null,
    criadoEm: iso(x.criado_em), acoesPermitidas: x.status === 'AGUARDANDO_REVISAO' && revisa ? ['REVISAR'] : [],
  })));
}

// ─────────── Regras (RN-EXA) ───────────
export async function criarPedido(tx: Tx, org: Org, d: { id?: string; pacienteId: string; solicitanteId: string; itens: any[]; orientacoes?: string | null; observacao?: string | null; criadoEm?: Date }, log: Log) {
  const p = (await um(tx, `INSERT INTO pedidos_exame (organizacao_id, id, paciente_id, solicitante_id, itens, orientacoes, observacao, criado_em)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now())) RETURNING *`,
    [org.id, d.id ?? novoId('ped'), d.pacienteId, d.solicitanteId, JSON.stringify(d.itens.map((i) => ({ nome: String(i.nome).trim(), orientacoes: i.orientacoes ?? null }))),
      d.orientacoes ?? null, d.observacao ?? null, d.criadoEm ?? null]))!;
  await emitir(tx, org.id, 'exames.pedido.atualizado', { pedidoId: p.id }, await interessados(tx, org, p.paciente_id));
  const t = termoExame(org);
  for (const uid of await contasDoPaciente(tx, org, p.paciente_id))
    await notificar(tx, org, uid, { tipo: 'EXAME_PEDIDO', titulo: `Pedido de ${t.singular}`, texto: `Há um novo pedido de ${t.singular} para você. Veja as orientações no app.`, destino: { tela: 'exames.pedido', parametros: { pedidoId: p.id } } }, log);
  return p;
}
export async function finalizarPedido(tx: Tx, org: Org, p: any, status: 'CONCLUIDO' | 'CANCELADO', motivo: string | null) {
  if (p.status === status) return p; // repetir não muda nada
  if (p.status !== 'ABERTO') throw invalido('status', 'Este pedido já foi finalizado.');
  const r = (await um(tx, `UPDATE pedidos_exame SET status = $3, motivo_cancelamento = $4, concluido_em = CASE WHEN $3 = 'CONCLUIDO' THEN now() END, versao = versao + 1
                           WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, p.id, status, motivo]))!;
  await emitir(tx, org.id, 'exames.pedido.atualizado', { pedidoId: r.id }, await interessados(tx, org, r.paciente_id));
  return r;
}

export async function criarResultado(tx: Tx, org: Org, d: { id?: string; pacienteId: string; pedidoId?: string | null; titulo: string; dataColeta?: string | null; arquivosIds: string[]; comentario?: string | null; enviadoPor: string; origem: 'PACIENTE' | 'EQUIPE'; criadoEm?: Date }, log: Log) {
  const x = (await um(tx, `INSERT INTO resultados_exame (organizacao_id, id, paciente_id, pedido_id, titulo, data_coleta, comentario, origem, enviado_por, criado_em)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now())) RETURNING *`,
    [org.id, d.id ?? novoId('res'), d.pacienteId, d.pedidoId ?? null, d.titulo.trim(), d.dataColeta ?? null, d.comentario ?? null, d.origem, d.enviadoPor, d.criadoEm ?? null]))!;
  for (const [ordem, arquivoId] of d.arquivosIds.entries()) {
    // PK (organizacao_id, arquivo_id): o mesmo arquivo em dois resultados viola a chave, mesmo em paralelo.
    const r = await um(tx, `INSERT INTO resultado_arquivos (organizacao_id, arquivo_id, resultado_id, ordem) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1`, [org.id, arquivoId, x.id, ordem]);
    if (!r) throw invalido(`arquivosIds.${ordem}`, 'Arquivo já usado em outro resultado.');
    await tx.query('UPDATE arquivos SET usado_em = now() WHERE organizacao_id = $1 AND id = $2', [org.id, arquivoId]);
  }
  const para = await interessados(tx, org, x.paciente_id);
  await emitir(tx, org.id, 'exames.resultado.atualizado', { resultadoId: x.id, ...(x.pedido_id ? { pedidoId: x.pedido_id } : {}) }, para);
  if (x.pedido_id) await emitir(tx, org.id, 'exames.pedido.atualizado', { pedidoId: x.pedido_id }, para);
  const t = termoExame(org);
  const nome = (await nomesPacientes(tx, org, [x.paciente_id])).get(x.paciente_id) ?? '';
  for (const uid of await revisores(tx, org, x.pedido_id))
    await notificar(tx, org, uid, { tipo: 'EXAME_RESULTADO', titulo: `Resultado de ${t.singular}`, texto: `${nome} tem um resultado de ${t.singular} para revisar.`, destino: { tela: 'exames.resultado', parametros: { resultadoId: x.id } } }, log);
  await avisarContadores(tx, org, await equipeComPermissao(tx, org, 'exames.resultado.revisar'));
  return x;
}
export async function revisarResultado(tx: Tx, org: Org, x: any, porId: string, nota: string | null, log: Log, em?: Date) {
  if (x.status === 'REVISADO') return x; // idempotente: não muda autor nem data
  const r = (await um(tx, `UPDATE resultados_exame SET status = 'REVISADO', revisado_por = $3, revisado_em = COALESCE($5, now()), nota_revisao = $4
                           WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, x.id, porId, nota, em ?? null]))!;
  await emitir(tx, org.id, 'exames.resultado.atualizado', { resultadoId: r.id, ...(r.pedido_id ? { pedidoId: r.pedido_id } : {}) }, await interessados(tx, org, r.paciente_id));
  const t = termoExame(org);
  for (const uid of await contasDoPaciente(tx, org, r.paciente_id))
    await notificar(tx, org, uid, { tipo: 'EXAME_REVISADO', titulo: `Resultado de ${t.singular}`, texto: `A equipe revisou seu resultado de ${t.singular}.`, destino: { tela: 'exames.resultado', parametros: { resultadoId: r.id } } }, log);
  await avisarContadores(tx, org, await equipeComPermissao(tx, org, 'exames.resultado.revisar'));
  return r;
}

// ─────────── Tela inicial e contador ───────────
export async function contadorParaRevisar(tx: Tx, org: Org, perms: Set<string>): Promise<number> {
  if (!temModulo(org.modulos, 'exames') || !perms.has('exames.resultado.revisar')) return 0;
  return (await um<{ n: number }>(tx, `SELECT count(*)::int AS n FROM resultados_exame WHERE organizacao_id = $1 AND status = 'AGUARDANDO_REVISAO'`, [org.id]))!.n;
}
export async function secoesInicioExames(tx: Tx, ctx: Ctx): Promise<any[]> {
  const org = ctx.org;
  if (!temModulo(org.modulos, 'exames') || !ctx.perms.has('exames.exame.ler')) return [];
  if (ctx.perfil !== 'PACIENTE') {
    if (!ctx.perms.has('exames.resultado.revisar')) return [];
    const total = await contadorParaRevisar(tx, org, ctx.perms);
    const linhas = await todos(tx, `SELECT * FROM resultados_exame WHERE organizacao_id = $1 AND status = 'AGUARDANDO_REVISAO' ORDER BY criado_em, id LIMIT 5`, [org.id]);
    return [{ id: 'resultados-para-revisar', tipo: 'RESULTADOS_PARA_REVISAR', dados: { total, itens: await serResultados(tx, ctx, linhas) } }];
  }
  const abertos = await todos(tx, `SELECT * FROM pedidos_exame WHERE organizacao_id = $1 AND status = 'ABERTO'
                                     AND paciente_id IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2)
                                   ORDER BY criado_em DESC, id DESC LIMIT 5`, [org.id, ctx.usuario.id]);
  return abertos.length ? [{ id: 'exames-pendentes', tipo: 'EXAMES_PENDENTES', dados: { itens: await serPedidos(tx, ctx, abertos) } }] : [];
}
