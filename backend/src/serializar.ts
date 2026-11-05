// Linha do banco → formato do contrato. `acoesPermitidas` são calculadas aqui, para o usuário e o item.
import { ehEquipe, permissoesDe, PRIORIDADE_PERFIL, temModulo } from '@clinica/dominio';
import { todos, um, type Tx } from './db.ts';
import { ehEquipeCtx, iso, type Ctx, type Org, type Usuario } from './nucleo.ts';
import { urlsArquivo } from './modulos/arquivos.ts';

export async function serUsuario(tx: Tx, org: Org, u: Usuario) {
  const foto = u.foto_arquivo_id ? await um(tx, 'SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = $2', [org.id, u.foto_arquivo_id]) : null;
  return {
    id: u.id, nome: u.nome, nomeExibicao: u.nome_exibicao, email: u.email,
    fotoUrl: foto?.status === 'DISPONIVEL' ? (await urlsArquivo(foto)).urlMiniatura : null,
    preferencias: u.preferencias ?? { tema: 'SISTEMA', densidade: 'CONFORTAVEL' },
  };
}
export async function pacientesVinculados(tx: Tx, org: Org, usuarioId: string) {
  return (await todos(tx, `SELECT p.id, p.nome, p.tipo, v.relacao FROM vinculos v JOIN pacientes p ON p.organizacao_id = v.organizacao_id AND p.id = v.paciente_id
                            WHERE v.organizacao_id = $1 AND v.usuario_id = $2 ORDER BY p.nome`, [org.id, usuarioId])).map((r) => ({ id: r.id, nome: r.nome, tipo: r.tipo, relacao: r.relacao }));
}

export async function serPaciente(tx: Tx, ctx: Ctx, p: any) {
  const org = ctx.org;
  const contas = await todos(tx, `SELECT u.id, u.ultimo_acesso_em, EXISTS (SELECT 1 FROM inscricoes_push i WHERE i.organizacao_id = u.organizacao_id AND i.usuario_id = u.id) AS push
                                  FROM vinculos v JOIN usuarios u ON u.organizacao_id = v.organizacao_id AND u.id = v.usuario_id
                                  WHERE v.organizacao_id = $1 AND v.paciente_id = $2 AND u.status = 'ATIVO'`, [org.id, p.id]);
  const convitePendente = !!(await um(tx, `SELECT 1 FROM convites WHERE organizacao_id = $1 AND paciente_id = $2 AND usado_em IS NULL AND revogado_em IS NULL AND expira_em > now()`, [org.id, p.id]));
  const acoes: string[] = [];
  if (ehEquipeCtx(ctx)) {
    if (ctx.perms.has('pacientes.paciente.editar')) acoes.push('EDITAR', p.status === 'ATIVO' ? 'INATIVAR' : 'REATIVAR');
    if (p.status === 'ATIVO' && ctx.perms.has('pacientes.paciente.convidar')) acoes.push('CONVIDAR');
    if (p.status === 'ATIVO' && ctx.perms.has('acompanhamento.acompanhamento.criar')) acoes.push('INICIAR_ACOMPANHAMENTO');
    if (temModulo(org.modulos, 'chat') && ctx.perms.has('chat.conversa.criar')) acoes.push('ABRIR_CONVERSA');
  }
  const ultimo = contas.map((c) => c.ultimo_acesso_em).filter(Boolean).sort((a, b) => +b - +a)[0] ?? null;
  return {
    id: p.id, tipo: p.tipo, nome: p.nome, nomeSocial: p.nome_social, dataNascimento: p.data_nascimento,
    contato: { email: p.contato?.email ?? null, celular: p.contato?.celular ?? null },
    camposAdicionais: p.campos_adicionais ?? {}, responsaveis: p.responsaveis ?? [], status: p.status,
    acessoApp: {
      status: contas.length ? 'ATIVO' : convitePendente ? 'CONVITE_PENDENTE' : 'SEM_ACESSO',
      ultimoAcessoEm: iso(ultimo), notificacoes: !contas.length ? 'NENHUMA' : contas.some((c) => c.push) ? 'PUSH' : 'EMAIL',
    },
    acompanhamentosAtivos: 0, // F2
    conversaAtivaId: null, // F2
    criadoEm: iso(p.criado_em),
    acoesPermitidas: acoes,
  };
}

export function serMembro(ctx: Ctx, u: Usuario) {
  const acoes: string[] = [];
  if (ctx.perms.has('equipe.membro.gerenciar') && u.status !== 'DESLIGADO') {
    acoes.push('EDITAR');
    if (u.status === 'ATIVO') acoes.push('SUSPENDER');
    if (u.status === 'SUSPENSO') acoes.push('REATIVAR');
    acoes.push('DESLIGAR');
  }
  return { id: u.id, nome: u.nome_exibicao, email: u.email, perfis: u.perfis.filter((p) => p !== 'PACIENTE'), status: u.status, profissional: u.perfis.includes('PROFISSIONAL') ? u.profissional ?? null : null, acoesPermitidas: acoes };
}

export const ROTULOS_PERFIL: Record<string, string> = { GESTOR: 'Gestão', PROFISSIONAL: 'Profissional', SECRETARIA: 'Secretaria', PACIENTE: 'Paciente' };
export const perfisDisponiveis = (u: Usuario) => PRIORIDADE_PERFIL.filter((p) => u.perfis.includes(p)).map((p) => ({ id: p, rotulo: u.rotulos_perfis?.[p] ?? ROTULOS_PERFIL[p] }));
export { ehEquipe, permissoesDe };
