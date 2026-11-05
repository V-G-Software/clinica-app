// Erros no formato RFC 9457 com `codigo` estável (4.5). Nunca stack, SQL ou nome de tabela na resposta.
import { config } from './config.ts';

export const STATUS_POR_CODIGO: Record<string, number> = {
  AUTENTICACAO_INVALIDA: 401, CODIGO_INVALIDO: 422, CODIGO_EXPIRADO: 422, MUITAS_TENTATIVAS: 429,
  SESSAO_EXPIRADA: 401, SESSAO_REVOGADA: 401, PERMISSAO_NEGADA: 403, RECURSO_NAO_ENCONTRADO: 404,
  VALIDACAO_FALHOU: 422, CONFLITO_VERSAO: 412, LIMITE_EXCEDIDO: 429, CONVITE_INVALIDO: 404,
  CONVITE_EXPIRADO: 410, MODULO_NAO_CONTRATADO: 404, ORGANIZACAO_SUSPENSA: 403, CHECKIN_INDISPONIVEL: 409,
  CHECKIN_JA_RESPONDIDO: 409, CONVERSA_ARQUIVADA: 409, ARQUIVO_MUITO_GRANDE: 413,
  TIPO_ARQUIVO_NAO_PERMITIDO: 415, ARQUIVO_REJEITADO: 422, CURSOR_EXPIRADO: 410, ULTIMO_GESTOR: 409,
  INDISPONIVEL_TEMPORARIAMENTE: 503,
};
const TITULOS: Record<string, string> = {
  AUTENTICACAO_INVALIDA: 'E-mail ou senha incorretos', CODIGO_INVALIDO: 'Código inválido', CODIGO_EXPIRADO: 'Código expirado',
  MUITAS_TENTATIVAS: 'Muitas tentativas', SESSAO_EXPIRADA: 'Sessão expirada', SESSAO_REVOGADA: 'Sessão encerrada',
  PERMISSAO_NEGADA: 'Ação não permitida', RECURSO_NAO_ENCONTRADO: 'Não encontrado', VALIDACAO_FALHOU: 'Dados inválidos',
  CONFLITO_VERSAO: 'O registro foi alterado por outra pessoa', LIMITE_EXCEDIDO: 'Limite excedido', CONVITE_INVALIDO: 'Convite inválido',
  CONVITE_EXPIRADO: 'Convite expirado', MODULO_NAO_CONTRATADO: 'Recurso indisponível', ORGANIZACAO_SUSPENSA: 'Organização suspensa',
  CHECKIN_INDISPONIVEL: 'Check-in indisponível', CHECKIN_JA_RESPONDIDO: 'Check-in já respondido', CONVERSA_ARQUIVADA: 'Conversa arquivada',
  ARQUIVO_MUITO_GRANDE: 'Arquivo muito grande', TIPO_ARQUIVO_NAO_PERMITIDO: 'Tipo de arquivo não permitido', ARQUIVO_REJEITADO: 'Arquivo rejeitado',
  CURSOR_EXPIRADO: 'Histórico expirado', ULTIMO_GESTOR: 'A organização precisa de ao menos um gestor', INDISPONIVEL_TEMPORARIAMENTE: 'Indisponível no momento',
};

export class ErroApi extends Error {
  constructor(public codigo: string, public detalhe?: string, public extra: Record<string, unknown> = {}, public status = STATUS_POR_CODIGO[codigo] ?? 500) {
    super(`${codigo}${detalhe ? `: ${detalhe}` : ''}`);
  }
  problema(requestId: string, instance?: string) {
    return {
      type: `${config.dominioErros}/${this.codigo.toLowerCase().replace(/_/g, '-')}`,
      title: TITULOS[this.codigo] ?? this.codigo, status: this.status,
      ...(this.detalhe ? { detail: this.detalhe } : {}), ...(instance ? { instance } : {}),
      codigo: this.codigo, requestId, ...this.extra,
    };
  }
}
export const naoEncontrado = (o = 'Recurso') => new ErroApi('RECURSO_NAO_ENCONTRADO', `${o} não encontrado.`);
export const negado = (d = 'Você não pode fazer isso.') => new ErroApi('PERMISSAO_NEGADA', d);
export const invalido = (campo: string, mensagem: string, codigo = 'INVALIDO') =>
  new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: [{ campo, codigo, mensagem }] });
export const conflito = (estadoAtual: unknown) => new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual });
