// Remove dado pessoal ou clínico antes de qualquer registro de erro (PROMPT_FRONTEND 13; LGPD).
// Regra: o que sai do aparelho tem só ids opacos, códigos e a rota em forma de padrão.
const CHAVES_SENSIVEIS = /^(nome|nomeSocial|nomeExibicao|email|celular|telefone|endereco|dataNascimento|texto|respostas|observacao|nota|motivo|resumo|titulo|mensagem|responsaveis|contato|camposAdicionais|senha|novaSenha|codigo|token|tokenAcesso|tokenRenovacao|segredo|uriOtpauth|authorization|cookie|idempotency-key)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TELEFONE = /\+?\d[\d\s().-]{8,}\d/g;
const TOKEN = /\b(ac|rn)\.[A-Za-z0-9_-]{10,}|\bBearer\s+\S+/g;
const URL_COM_QUERY = /\b(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g;

export function limparTexto(s: string): string {
  return s.replace(URL_COM_QUERY, '$1').replace(TOKEN, '[token]').replace(EMAIL, '[email]').replace(TELEFONE, '[telefone]');
}

export function limpar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return '[profundo]';
  if (typeof valor === 'string') return limparTexto(valor);
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => limpar(v, profundidade + 1));
  if (valor && typeof valor === 'object') {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) r[k] = CHAVES_SENSIVEIS.test(k) ? '[removido]' : limpar(v, profundidade + 1);
    return r;
  }
  return valor;
}
