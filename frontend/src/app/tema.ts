// Aplica a marca da organização: escala de cores, cor de ação com contraste garantido,
// modo claro/escuro, título, theme-color, ícones e manifest (3.3).
import type { ConfiguracaoPublica } from '@clinica/contrato-tipos';
import { corComContraste, gerarEscala, PASSOS, textoSobre } from './cor';

export const FUNDO_CLARO = '#FFFFFF';
export const FUNDO_ESCURO = '#18181B';

export function variaveisDaMarca(corMarca: string): Record<string, string> {
  const escala = gerarEscala(corMarca);
  const acao = corComContraste(corMarca, FUNDO_CLARO).cor;
  const acaoEscuro = corComContraste(escala[400], FUNDO_ESCURO).cor;
  const v: Record<string, string> = {
    '--acao': acao, '--acao-texto': textoSobre(acao),
    '--acao-escuro': acaoEscuro, '--acao-escuro-texto': textoSobre(acaoEscuro),
  };
  for (const p of PASSOS) v[`--marca-${p}`] = escala[p];
  return v;
}

export function aplicarMarca(cfg: ConfiguracaoPublica, opcoes: { dev: boolean }) {
  const raiz = document.documentElement;
  for (const [k, v] of Object.entries(variaveisDaMarca(cfg.tema.corMarca))) raiz.style.setProperty(k, v);
  document.title = cfg.pwa.nome;
  definirMeta('theme-color', cfg.pwa.corTema);
  definirMeta('apple-mobile-web-app-title', cfg.pwa.nomeCurto);
  definirMeta('application-name', cfg.pwa.nomeCurto);
  const icone = [...cfg.pwa.icones].sort((a, b) => Number(b.tamanho.split('x')[0]) - Number(a.tamanho.split('x')[0])).find((i) => i.proposito !== 'maskable') ?? cfg.pwa.icones[0];
  if (icone) { definirLink('apple-touch-icon', icone.src); definirLink('icon', icone.src); }
  // Em produção a borda serve o manifest pelo Host; em dev, o middleware precisa do slug.
  if (opcoes.dev) definirLink('manifest', `/manifest.webmanifest?org=${cfg.organizacao.slug}`);
}

export type ModoTema = 'CLARO' | 'ESCURO' | 'SISTEMA';
export function aplicarModo(preferido: ModoTema | undefined, padrao: ModoTema) {
  const modo = preferido ?? padrao;
  const escuro = modo === 'ESCURO' || (modo === 'SISTEMA' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', !!escuro);
}

function definirMeta(nome: string, valor: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${nome}"]`);
  if (!el) { el = document.createElement('meta'); el.name = nome; document.head.appendChild(el); }
  el.content = valor;
}
function definirLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  el.href = href;
}
