// Estado em memória do mock: uma "Org" por cenário, com coleções, fila de jobs, eventos e caixas
// de saída (e-mail e push). Nada aqui faz parte do contrato; é a simulação do backend.
import { randomBytes, randomUUID } from 'node:crypto';
import { agoraIso, agoraMs, comRelogioForcado, DIA, HORA, iso } from './tempo.ts';

export const DOMINIO_ERROS = process.env.MOCK_DOMINIO_ERROS ?? 'https://exemplo.com.br/erros';

// ─────────── Erros ───────────
export const STATUS_POR_CODIGO: Record<string, number> = {
  AUTENTICACAO_INVALIDA: 401, CODIGO_INVALIDO: 422, CODIGO_EXPIRADO: 422, MUITAS_TENTATIVAS: 429,
  SESSAO_EXPIRADA: 401, SESSAO_REVOGADA: 401, PERMISSAO_NEGADA: 403, RECURSO_NAO_ENCONTRADO: 404,
  VALIDACAO_FALHOU: 422, CONFLITO_VERSAO: 412, LIMITE_EXCEDIDO: 429, CONVITE_INVALIDO: 404,
  CONVITE_EXPIRADO: 410, MODULO_NAO_CONTRATADO: 404, ORGANIZACAO_SUSPENSA: 403, CHECKIN_INDISPONIVEL: 409,
  CHECKIN_JA_RESPONDIDO: 409, CONVERSA_ARQUIVADA: 409, ARQUIVO_MUITO_GRANDE: 413,
  TIPO_ARQUIVO_NAO_PERMITIDO: 415, ARQUIVO_REJEITADO: 422, CURSOR_EXPIRADO: 410, ULTIMO_GESTOR: 409,
  INDISPONIVEL_TEMPORARIAMENTE: 503, HORARIO_INDISPONIVEL: 409,
};
const TITULOS: Record<string, string> = {
  AUTENTICACAO_INVALIDA: 'E-mail ou senha incorretos', CODIGO_INVALIDO: 'Código inválido',
  CODIGO_EXPIRADO: 'Código expirado', MUITAS_TENTATIVAS: 'Muitas tentativas', SESSAO_EXPIRADA: 'Sessão expirada',
  SESSAO_REVOGADA: 'Sessão encerrada', PERMISSAO_NEGADA: 'Ação não permitida',
  RECURSO_NAO_ENCONTRADO: 'Não encontrado', VALIDACAO_FALHOU: 'Dados inválidos',
  CONFLITO_VERSAO: 'O registro foi alterado por outra pessoa', LIMITE_EXCEDIDO: 'Limite excedido',
  CONVITE_INVALIDO: 'Convite inválido', CONVITE_EXPIRADO: 'Convite expirado',
  MODULO_NAO_CONTRATADO: 'Recurso indisponível', ORGANIZACAO_SUSPENSA: 'Organização suspensa',
  CHECKIN_INDISPONIVEL: 'Check-in indisponível', CHECKIN_JA_RESPONDIDO: 'Check-in já respondido',
  CONVERSA_ARQUIVADA: 'Conversa arquivada', ARQUIVO_MUITO_GRANDE: 'Arquivo muito grande',
  TIPO_ARQUIVO_NAO_PERMITIDO: 'Tipo de arquivo não permitido', ARQUIVO_REJEITADO: 'Arquivo rejeitado',
  CURSOR_EXPIRADO: 'Histórico expirado', ULTIMO_GESTOR: 'A organização precisa de ao menos um gestor',
  INDISPONIVEL_TEMPORARIAMENTE: 'Indisponível no momento', HORARIO_INDISPONIVEL: 'Horário indisponível',
};

export class ErroApi extends Error {
  constructor(
    public codigo: string,
    public detalhe?: string,
    public extra: Record<string, unknown> = {},
    public status = STATUS_POR_CODIGO[codigo] ?? 500,
  ) {
    super(`${codigo}: ${detalhe ?? ''}`);
  }
  problema(requestId: string, instance?: string) {
    return {
      type: `${DOMINIO_ERROS}/${this.codigo.toLowerCase().replace(/_/g, '-')}`,
      title: TITULOS[this.codigo] ?? this.codigo,
      status: this.status,
      ...(this.detalhe ? { detail: this.detalhe } : {}),
      ...(instance ? { instance } : {}),
      codigo: this.codigo,
      requestId,
      ...this.extra,
    };
  }
}
export const naoEncontrado = (o = 'Recurso') => new ErroApi('RECURSO_NAO_ENCONTRADO', `${o} não encontrado.`);
export const negado = (d = 'Você não pode fazer isso.') => new ErroApi('PERMISSAO_NEGADA', d);
export const invalido = (campo: string, mensagem: string, codigo = 'INVALIDO') =>
  new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: [{ campo, codigo, mensagem }] });

// ─────────── Ids ───────────
let seq = 0;
/** Id opaco com prefixo legível e sufixo ordenável (imitando UUIDv7). Determinístico no seed. */
export function novoId(prefixo: string): string {
  seq += 1;
  return `${prefixo}_${agoraMs().toString(36).padStart(9, '0')}${seq.toString(36).padStart(5, '0')}`;
}
export const reiniciarIds = () => { seq = 0; };
export const tokenAleatorio = (n = 24) => randomBytes(n).toString('base64url');
export const uuid = () => randomUUID();

// ─────────── Tipos (internos do mock) ───────────
export type Perfil = 'GESTOR' | 'PROFISSIONAL' | 'SECRETARIA' | 'PACIENTE';
export interface Usuario {
  id: string; nome: string; nomeExibicao: string; email: string; senha: string | null; perfis: Perfil[];
  status: 'CONVIDADO' | 'ATIVO' | 'SUSPENSO' | 'DESLIGADO';
  mfaSegredo: string | null; codigosRecuperacao: string[]; trocarSenha: boolean; termosAceitosVersao: string | null;
  rotulosPerfis: Record<string, string>; profissional: any | null; preferencias: any; fotoArquivoId: string | null;
  vinculos: { pacienteId: string; relacao: 'PROPRIO' | 'DEPENDENTE' | 'ANIMAL' }[];
  ultimoAcessoEm: string | null; criadoEm: string; _v: number;
  preferenciasNotificacao: Record<string, { push: boolean; email: boolean }>;
}
export interface Evento { id: string; seq: number; tipo: string; ocorridoEm: string; dados: any; para: Set<string> }
export interface Job { id: string; em: number; ordem: number; fn: () => void }

export interface Org {
  cenario: any; // seed original
  id: string; slug: string;
  config: any; // organizacao do seed (mutável via PATCH /v1/organizacao)
  termos: any; modulos: any[]; capacidades: any; _vConfig: number; _vManifesto: number;
  usuarios: Map<string, Usuario>;
  pacientes: Map<string, any>;
  formularios: Map<string, any[]>; // id → versões
  protocolos: Map<string, any[]>; // id → versões
  acompanhamentos: Map<string, any>;
  checkins: Map<string, any>;
  alertas: Map<string, any>;
  conversas: Map<string, any>;
  mensagens: Map<string, any[]>; // conversaId → mensagens (ordem cronológica)
  notificacoes: Map<string, any[]>; // usuarioId → notificações (mais recente primeiro)
  inscricoesPush: Map<string, any>;
  arquivos: Map<string, any>;
  convites: Map<string, any>; // token → convite
  desafios: Map<string, any>;
  sessoes: Map<string, any>;
  tokensAcesso: Map<string, any>;
  tokensRenovacao: Map<string, any>;
  codigosEmail: Map<string, any>;
  tokensSenha: Map<string, any>;
  idempotencia: Map<string, any>;
  tentativas: Map<string, number[]>;
  eventos: Evento[];
  seqEvento: number;
  ouvintes: Set<{ usuarioId: string; sessaoId: string; enviar: (e: Evento) => void; fechar: () => void }>;
}

// ─────────── Fila de jobs (determinística) ───────────
const jobs = new Map<string, Job>();
let ordemJob = 0;
/** Agenda (ou reagenda) um job com id determinístico, ex.: `checkin:{id}:abrir`. */
export function agendar(id: string, em: number, fn: () => void) {
  jobs.set(id, { id, em, ordem: ++ordemJob, fn });
}
export const cancelarJob = (id: string) => jobs.delete(id);
export const cancelarJobsComPrefixo = (prefixo: string) => {
  for (const id of jobs.keys()) if (id.startsWith(prefixo)) jobs.delete(id);
};
/** Executa, em ordem, todos os jobs com horário até `ate`, com o relógio no horário de cada job. */
export function processarJobsAte(ate: number): number {
  let n = 0;
  for (;;) {
    let proximo: Job | null = null;
    for (const j of jobs.values()) if (j.em <= ate && (!proximo || j.em < proximo.em || (j.em === proximo.em && j.ordem < proximo.ordem))) proximo = j;
    if (!proximo) return n;
    jobs.delete(proximo.id);
    comRelogioForcado(Math.max(proximo.em, 0), proximo.fn);
    n++;
  }
}
export const limparJobs = () => jobs.clear();
export const listarJobs = () => [...jobs.values()].sort((a, b) => a.em - b.em).map((j) => ({ id: j.id, em: iso(j.em) }));

// ─────────── Caixas de saída ───────────
export const caixaEmails: any[] = [];
export const caixaPush: any[] = [];
export function enviarEmail(org: Org, para: string, assunto: string, texto: string) {
  caixaEmails.unshift({ id: novoId('eml'), org: org.slug, para, assunto, texto, enviadoEm: agoraIso() });
}

// ─────────── Eventos ───────────
export function emitir(org: Org, tipo: string, dados: any, para: Iterable<string>) {
  const destinatarios = new Set(para);
  if (destinatarios.size === 0) return;
  org.seqEvento += 1;
  const ev: Evento = { id: `evt_${org.seqEvento.toString().padStart(8, '0')}`, seq: org.seqEvento, tipo, ocorridoEm: agoraIso(), dados, para: destinatarios };
  org.eventos.push(ev);
  const limite = agoraMs() - DIA;
  while (org.eventos.length && Date.parse(org.eventos[0].ocorridoEm) < limite) org.eventos.shift();
  for (const o of org.ouvintes) if (destinatarios.has(o.usuarioId)) o.enviar(ev);
}
export const eventoPublico = (e: Evento) => ({ id: e.id, tipo: e.tipo, ocorridoEm: e.ocorridoEm, dados: e.dados });

// ─────────── Notificações (RN-NOT-001..004) ───────────
const TIPOS_EMAIL_SEM_PUSH = new Set(['CHECKIN_DISPONIVEL', 'CHECKIN_LEMBRETE', 'ALERTA_CRIADO', 'AGENDAMENTO_LEMBRETE', 'AGENDAMENTO_ALTERADO']);
const TEXTO_PUSH: Record<string, string> = {
  CHAT_MENSAGEM: 'Você tem uma nova mensagem',
  CHECKIN_DISPONIVEL: 'Seu check-in de hoje está disponível',
  CHECKIN_LEMBRETE: 'Lembrete: seu check-in ainda não foi respondido',
  ALERTA_CRIADO: 'Há um novo alerta para revisar',
  ACOMPANHAMENTO_INICIADO: 'Seu acompanhamento foi iniciado',
  ACOMPANHAMENTO_CONCLUIDO: 'Seu acompanhamento foi concluído',
  CONVITE_ACEITO: 'Um convite foi aceito',
  SISTEMA: 'Você tem um novo aviso',
  AGENDAMENTO_CRIADO: 'Há um novo agendamento', AGENDAMENTO_ALTERADO: 'Um agendamento foi alterado',
  AGENDAMENTO_LEMBRETE: 'Lembrete de agendamento',
};
const TAG_PUSH: Record<string, string> = { CHAT_MENSAGEM: 'chat', CHECKIN_DISPONIVEL: 'checkin', CHECKIN_LEMBRETE: 'checkin', ALERTA_CRIADO: 'alerta' };

export function notificar(
  org: Org,
  usuarioId: string,
  n: { tipo: string; titulo: string; texto: string; destino: any; agrupar?: string },
  aoAlterarContadores: (usuarioId: string) => void,
) {
  const u = org.usuarios.get(usuarioId);
  if (!u || u.status !== 'ATIVO') return;
  const lista = org.notificacoes.get(usuarioId) ?? [];
  org.notificacoes.set(usuarioId, lista);
  // Mensagens de chat da mesma conversa não lidas são agrupadas em uma notificação.
  const existente = n.agrupar ? lista.find((x) => x._agrupar === n.agrupar && !x.lidoEm) : null;
  if (existente) {
    existente.titulo = n.titulo; existente.texto = n.texto; existente.criadoEm = agoraIso();
    lista.splice(lista.indexOf(existente), 1);
    lista.unshift(existente);
  } else {
    lista.unshift({ id: novoId('ntf'), tipo: n.tipo, titulo: n.titulo, texto: n.texto, criadoEm: agoraIso(), lidoEm: null, destino: n.destino, _agrupar: n.agrupar });
  }
  const ntf = lista[0];
  emitir(org, 'notificacao.criada', { notificacaoId: ntf.id }, [usuarioId]);
  aoAlterarContadores(usuarioId);

  // Cópias discretas: push ou e-mail, sem conteúdo clínico e sem nome de paciente (RN-NOT-002).
  const pref = u.preferenciasNotificacao[n.tipo] ?? { push: true, email: true };
  const inscricoes = [...org.inscricoesPush.values()].filter((i) => i.usuarioId === usuarioId);
  const textoDiscreto = `${TEXTO_PUSH[n.tipo] ?? 'Você tem uma nova notificação'} — ${org.config.nome}.`;
  if (inscricoes.length && pref.push) {
    for (const i of inscricoes) {
      if (i.endpoint.includes('expirado')) {
        org.inscricoesPush.delete(i.id); // RN-NOT-004: serviço de push devolveu 410
        caixaPush.unshift({ id: novoId('psh'), org: org.slug, usuarioId, inscricaoId: i.id, resultado: 'REMOVIDA_410', enviadoEm: agoraIso() });
        continue;
      }
      caixaPush.unshift({
        id: novoId('psh'), org: org.slug, usuarioId, inscricaoId: i.id, resultado: 'ENVIADO', enviadoEm: agoraIso(),
        payload: { notificacaoId: ntf.id, titulo: org.config.nome, texto: textoDiscreto, tag: TAG_PUSH[n.tipo] ?? 'geral', destino: n.destino },
      });
    }
    return;
  }
  if (!pref.email) return;
  if (TIPOS_EMAIL_SEM_PUSH.has(n.tipo)) {
    enviarEmail(org, u.email, org.config.nome, `${textoDiscreto} Abra o app para ver.`);
  } else if (n.tipo === 'CHAT_MENSAGEM' && n.agrupar) {
    const chave = `email:${usuarioId}:${n.agrupar}`;
    const ultimo = (org as any)[chave] as number | undefined;
    if (!ultimo || agoraMs() - ultimo >= 6 * HORA) {
      (org as any)[chave] = agoraMs();
      enviarEmail(org, u.email, org.config.nome, `${textoDiscreto} Abra o app para ver.`);
    }
  }
}

// ─────────── Registro global de organizações ───────────
export const orgs = new Map<string, Org>();

export function novaOrg(cenario: any): Org {
  const c = structuredClone(cenario);
  return {
    cenario, id: c.organizacao.id, slug: c.organizacao.slug, config: c.organizacao, termos: c.termos,
    modulos: c.modulos, capacidades: c.capacidades, _vConfig: 1, _vManifesto: 1,
    usuarios: new Map(), pacientes: new Map(), formularios: new Map(), protocolos: new Map(),
    acompanhamentos: new Map(), checkins: new Map(), alertas: new Map(), conversas: new Map(), mensagens: new Map(),
    notificacoes: new Map(), inscricoesPush: new Map(), arquivos: new Map(), convites: new Map(), desafios: new Map(),
    sessoes: new Map(), tokensAcesso: new Map(), tokensRenovacao: new Map(), codigosEmail: new Map(),
    tokensSenha: new Map(), idempotencia: new Map(), tentativas: new Map(), eventos: [], seqEvento: 0, ouvintes: new Set(),
  };
}
