# ADR-0011 — Manifest web por organização e ordem de inicialização

- **Status:** aceito (FE0) · **Data:** 2026-11-05

## Manifest
O mesmo build estático atende todas as organizações, então `/manifest.webmanifest` não pode ser arquivo estático: nome, ícones e cor mudam por organização.
- **Produção:** função na borda (CDN) — `frontend/borda/manifest.ts` — resolve o Host no diretório, lê a configuração pública e gera o manifest (`Cache-Control: max-age=300`).
- **Desenvolvimento:** middleware do Vite em `/manifest.webmanifest?org={slug}`, lendo o mock.
- Ambos usam a mesma função pura `gerarManifestWeb` (testada com os 3 cenários).
- `document.title`, `theme-color`, `apple-touch-icon` e `apple-mobile-web-app-title` são aplicados em runtime antes de o usuário conseguir instalar: o iOS lê esses valores do DOM no momento de "Adicionar à Tela de Início".
- Não usamos manifest em `blob:` (instável fora do Chrome).

## Ordem de inicialização
A navegação inicial do Vue Router começa no `app.use(router)`, antes do `mount`. Se a guarda decidir antes de a sessão ser restaurada pelo cookie, o usuário logado é mandado para o login a cada recarga (bug encontrado no E2E da FE0).
- `iniciar()` roda em `main.ts` antes da primeira navegação; a guarda de rotas **aguarda** a inicialização (`aguardarInicializacao()`).
- Ordem: diretório → configuração pública (marca, idioma, `versaoMinima`, status) → `/v1/publico/saude` (desvio do relógio do backend) → renovação pelo cookie → manifesto.

## Renovação entre abas
`navigator.locks` serializa as renovações por organização. Como o cookie de renovação é compartilhado pelo navegador, a aba que renova depois já envia o cookie rotacionado, e a detecção de reuso do backend não derruba a sessão. Não é preciso repassar tokens entre abas: cada aba tem o seu token de acesso, só em memória.
