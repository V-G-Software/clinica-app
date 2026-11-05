// Gera o Web App Manifest de uma organização a partir da configuração pública.
// Usado pelo middleware do Vite (dev) e pela função de borda (produção, borda/manifest.ts).
import type { ConfiguracaoPublica } from '@clinica/contrato-tipos';

export function gerarManifestWeb(cfg: ConfiguracaoPublica, startUrl = '/') {
  return {
    id: `/?org=${cfg.organizacao.slug}`,
    name: cfg.pwa.nome,
    short_name: cfg.pwa.nomeCurto,
    lang: cfg.organizacao.locale,
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: cfg.pwa.corTema,
    background_color: '#FFFFFF',
    icons: cfg.pwa.icones.map((i) => ({ src: i.src, sizes: i.tamanho, type: i.src.endsWith('.svg') ? 'image/svg+xml' : 'image/png', purpose: i.proposito ?? 'any' })),
  };
}
