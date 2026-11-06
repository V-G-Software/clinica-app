// Referências usadas nas respostas da F2 (paciente, usuário, arquivo) e quem recebe cada evento.
import { perfilPadrao, permissoesDe, type Perfil } from '@clinica/dominio';
import { global, todos, um, type Tx } from '../db.ts';
import { urlsArquivo } from '../modulos/arquivos.ts';
import { orgPorSlug, type Org } from '../nucleo.ts';

export async function nomesPacientes(tx: Tx, org: Org, ids: string[]): Promise<Map<string, string>> {
  const r = await todos(tx, 'SELECT id, nome FROM pacientes WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, [...new Set(ids)]]);
  return new Map(r.map((p) => [p.id, p.nome]));
}
export async function refPaciente(tx: Tx, org: Org, id: string) {
  return { id, nome: (await nomesPacientes(tx, org, [id])).get(id) ?? '—' };
}

export interface UsuarioRef { id: string; nome: string; nome_exibicao: string; perfis: Perfil[]; status: string }
export async function usuariosPorId(tx: Tx, org: Org, ids: string[]): Promise<Map<string, UsuarioRef>> {
  const r = await todos(tx, 'SELECT id, nome, nome_exibicao, perfis, status FROM usuarios WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, [...new Set(ids)]]);
  return new Map(r.map((u) => [u.id, u]));
}
/** { usuarioId, nome, perfil } — paciente aparece pelo nome; equipe, pelo nome de exibição. */
export function refUsuario(u: UsuarioRef | undefined, id: string, perfil?: string | null) {
  if (!u) return { usuarioId: id, nome: '—', perfil: (perfil ?? 'PACIENTE') as Perfil };
  return { usuarioId: id, nome: u.perfis.includes('PACIENTE') ? u.nome : u.nome_exibicao, perfil: (perfil ?? perfilPadrao(u.perfis)) as Perfil };
}
export const ehEquipeU = (u: { perfis: string[] }) => u.perfis.some((p) => p !== 'PACIENTE');

/** Contas ativas vinculadas ao paciente (o próprio paciente e/ou responsáveis). */
export async function contasDoPaciente(tx: Tx, org: Org, pacienteId: string): Promise<string[]> {
  const r = await todos(tx, `SELECT u.id FROM vinculos v JOIN usuarios u ON u.organizacao_id = v.organizacao_id AND u.id = v.usuario_id
                              WHERE v.organizacao_id = $1 AND v.paciente_id = $2 AND u.status = 'ATIVO' ORDER BY u.id`, [org.id, pacienteId]);
  return r.map((x) => x.id);
}
/** Membros da equipe do acompanhamento que continuam ativos (opcionalmente com uma permissão). */
export async function equipeAtiva(tx: Tx, org: Org, ids: string[], permissao?: string): Promise<string[]> {
  const r = await todos(tx, `SELECT id, perfis FROM usuarios WHERE organizacao_id = $1 AND id = ANY($2) AND status = 'ATIVO'`, [org.id, ids]);
  return r.filter((u) => ehEquipeU(u) && (!permissao || permissoesDe(org.modulos, perfilPadrao(u.perfis)).includes(permissao))).map((u) => u.id);
}
export async function membroValido(tx: Tx, org: Org, id: string) {
  const u = await um(tx, `SELECT id, perfis, status FROM usuarios WHERE organizacao_id = $1 AND id = $2`, [org.id, id]);
  return !!u && u.status === 'ATIVO' && ehEquipeU(u);
}

export async function arquivoResumo(tx: Tx, org: Org, id: string) {
  const a = await um(tx, 'SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = $2', [org.id, id]);
  return a ? { id, status: a.status, ...(await urlsArquivo(a)) } : { id, status: 'REJEITADO', urlVisualizacao: null, urlMiniatura: null, urlsExpiramEm: null };
}

/** Organização por id (jobs: o payload só carrega o id). */
export async function orgPorId(id: string): Promise<Org> {
  const r = await global('SELECT slug FROM organizacoes WHERE id = $1', [id]);
  const org = r.rows[0] ? await orgPorSlug(r.rows[0].slug) : null;
  if (!org) throw new Error(`organização inexistente: ${id}`);
  return org;
}
