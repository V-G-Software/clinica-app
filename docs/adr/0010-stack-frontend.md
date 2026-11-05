# ADR-0010 — Stack do frontend

- **Status:** aceito (FE0) · **Data:** 2026-11-05

## Decisão
Vue 3.5 (Composition API, `<script setup>`), TypeScript estrito, Vite 6, Vue Router 4, Pinia 3, TanStack Query, vue-i18n 11, Tailwind CSS 4 com tokens + Reka UI (headless), lucide-vue-next, vite-plugin-pwa (`injectManifest`), Vitest + Playwright.

- **Majors fixados de propósito.** Já existem Vite 8, Vue Router 5 e Pinia 4; ficamos nos majors consolidados até a FE3 e atualizamos em PR próprio, com a suíte E2E como rede de segurança.
- **Headless + tokens** em vez de biblioteca completa (Vuetify/Quasar): a marca muda em runtime por organização e o contraste/acessibilidade fica sob nosso controle ([DECISÃO 3] do prompt do frontend).
- **TanStack Query** para dados do servidor (cache, revalidação, invalidação por evento); **Pinia** só para sessão, manifesto e estado do app.
- **Token só em memória** (Pinia não persistido); renovação por cookie `HttpOnly` (ADR-0002).

## Consequências
- JS inicial do build de produção: ~79 KB gzip (orçamento: 170 KB).
- Ferramentas de desenvolvimento e chamadas a `/__mock` são removidas do build por `import.meta.env.DEV` (verificado: nenhuma ocorrência de `__mock` no `dist/`).
