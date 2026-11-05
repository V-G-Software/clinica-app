// Função de borda (CDN) que serve /manifest.webmanifest por organização, a partir do Host.
// Modelo genérico no formato `fetch(request)` (Cloudflare Workers, Deno Deploy, Vercel Edge).
// Variável: DIRETORIO_URL. Cache curto: a marca pode mudar pela configuração da organização.
import { gerarManifestWeb } from '../src/pwa/manifest-web';

export default {
  async fetch(request: Request, env: { DIRETORIO_URL: string; DOMINIO: string }): Promise<Response> {
    const host = new URL(request.url).hostname;
    const sufixo = `.${env.DOMINIO}`;
    const consulta = host.endsWith(sufixo)
      ? `${env.DIRETORIO_URL}/v1/organizacoes/${host.slice(0, -sufixo.length)}`
      : `${env.DIRETORIO_URL}/v1/organizacoes?dominio=${encodeURIComponent(host)}`;
    const org = await fetch(consulta);
    if (!org.ok) return new Response(null, { status: 404 });
    const { urlApi } = await org.json();
    const cfg = await fetch(`${urlApi}/v1/publico/configuracao`);
    if (!cfg.ok) return new Response(null, { status: 502 });
    return new Response(JSON.stringify(gerarManifestWeb(await cfg.json())), {
      headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' },
    });
  },
};
