// Cabeçalhos de segurança do app (PROMPT_FRONTEND 13). A CSP depende da organização: `connect-src`
// precisa da urlApi dela e do storage onde as fotos são enviadas. Servida pela borda junto com o HTML.
export interface OpcoesSeguranca {
  urlApi: string;
  diretorioUrl: string;
  /** Origens extras para envio de arquivos (URLs assinadas do storage), ex.: https://storage.exemplo.com.br */
  origensEnvio?: string[];
  /** Origens de imagens (logo, ícones e URLs de visualização). Padrão: qualquer https. */
  origensImagem?: string[];
  producao?: boolean;
}
const origem = (url: string) => new URL(url).origin;

export function politicaCsp(o: OpcoesSeguranca): string {
  const conectar = [...new Set(["'self'", origem(o.urlApi), origem(o.diretorioUrl), ...(o.origensEnvio ?? []).map(origem)])];
  const diretivas: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    // Estilos do Vue vão por CSSOM (element.style), que a CSP não bloqueia; nada de 'unsafe-inline'.
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', ...(o.origensImagem ?? ['https:'])],
    'font-src': ["'self'"],
    'connect-src': conectar,
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    ...(o.producao ? { 'upgrade-insecure-requests': [] } : {}),
  };
  return Object.entries(diretivas).map(([k, v]) => [k, ...v].join(' ').trim()).join('; ');
}

export function cabecalhosSeguranca(o: OpcoesSeguranca): Record<string, string> {
  return {
    'Content-Security-Policy': politicaCsp(o),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', // nenhuma URL do app vaza para sites externos (links de termos, mapa)
    'Permissions-Policy': 'geolocation=(), microphone=(), payment=(), usb=(), camera=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(o.producao ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}
