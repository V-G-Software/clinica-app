import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { gerarManifestWeb } from './src/pwa/manifest-web';
import { cabecalhosSeguranca } from './borda/seguranca';
import pkg from './package.json' with { type: 'json' };

/**
 * Em desenvolvimento, /manifest.webmanifest?org={slug} é gerado a partir da configuração pública
 * do mock — o mesmo papel da função de borda em produção (borda/manifest.ts), que usa o Host.
 */
function manifestPorOrganizacao(diretorio: string): Plugin {
  const servirManifest = async (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b?: string) => void; statusCode: number }) => {
        const slug = new URL(req.url ?? '/', 'http://x').searchParams.get('org') ?? 'modelo-otorrino';
        try {
          const org = await (await fetch(`${diretorio}/v1/organizacoes/${slug}`)).json();
          const cfg = await (await fetch(`${org.urlApi}/v1/publico/configuracao`)).json();
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(JSON.stringify(gerarManifestWeb(cfg, `/?org=${slug}`)));
        } catch {
          res.statusCode = 404;
          res.end();
        }
  };
  return {
    name: 'manifest-por-organizacao',
    configureServer(server) { server.middlewares.use('/manifest.webmanifest', servirManifest); },
    configurePreviewServer(server) {
      server.middlewares.use('/manifest.webmanifest', servirManifest);
      // Homologação local: o build de produção é servido com a mesma CSP que a borda aplicaria.
      const api = new URL(diretorio).origin;
      const cab = cabecalhosSeguranca({ urlApi: api, diretorioUrl: diretorio, origensEnvio: [api] });
      server.middlewares.use((_req, res, next) => { for (const [k, v] of Object.entries(cab)) res.setHeader(k, v); next(); });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      vue(),
      tailwindcss(),
      manifestPorOrganizacao(env.VITE_DIRETORIO_URL ?? 'http://localhost:4010/diretorio'),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/pwa',
        filename: 'sw.ts',
        manifest: false, // servido por organização (borda em produção, middleware em dev)
        injectRegister: false,
        injectManifest: { globPatterns: ['**/*.{js,css,html,svg,woff2}'] },
        devOptions: { enabled: false },
      }),
    ],
    define: { __VERSAO_APP__: JSON.stringify(pkg.version) },
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    server: { port: 5173 },
    build: { target: 'es2022', sourcemap: 'hidden' },
    // Produção: sem console.log/info/debug (podem carregar dado pessoal); console.error/warn ficam.
    esbuild: mode === 'development' ? {} : { pure: ['console.log', 'console.info', 'console.debug'], drop: ['debugger'] },
    test: { environment: 'jsdom', include: ['tests/unit/**/*.test.ts'], globals: true },
  };
});
