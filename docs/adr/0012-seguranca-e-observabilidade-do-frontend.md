# ADR-0012 — Segurança e observabilidade do frontend

- **Status:** aceito (FE3) · **Data:** 2026-11-05

## CSP e cabeçalhos
A borda serve o HTML com cabeçalhos calculados por organização (`frontend/borda/seguranca.ts`):
- `script-src 'self'` e `style-src 'self'` — **sem `unsafe-inline` nem `unsafe-eval`**. Os estilos dinâmicos do Vue e do Reka UI vão por CSSOM (`element.style`), que a CSP não bloqueia.
- `connect-src` = o próprio site + a `urlApi` da organização + o diretório + as origens do storage de envio de arquivos (URLs assinadas).
- `img-src 'self' data: blob: https:` (logos, QR code em `data:`, prévia local em `blob:`, URLs assinadas de visualização); `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`.
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` restritiva, `COOP same-origin`, HSTS em produção.

**Verificação:** `e2e/csp.mjs` roda o build de **produção** (modo `homologacao`, que só difere por aceitar `?org=`) servido com a mesma política e percorre login, check-in com foto, conversa em tempo real, QR em diálogo e telas da equipe: zero violações. Um teste negativo confirmou que o detector captura script inline, `fetch` externo e `<style>` inline.

## Observabilidade sem dado pessoal
`src/observabilidade/`: adaptador neutro enquanto a ferramenta não é escolhida (QUESTION-021).
- Evento: mensagem e pilha **limpas** (e-mail, telefone, tokens e query strings removidos), rota como **padrão** (`/pacientes/:pacienteId`), `codigo`, `status` e `requestId` do erro da API, versão e organização. Nunca corpo de requisição/resposta, `detail`, nome ou texto de mensagem.
- 4xx esperados (validação, conflito, permissão) não são registrados; no máximo 1 evento por minuto por erro.
- Sem `VITE_ERROS_URL`, nada sai do aparelho.
- Build: `console.log/info/debug` removidos; source maps gerados mas não referenciados (`hidden`).

## Acessibilidade
`e2e/acessibilidade.mjs` (axe-core, WCAG 2.2 A/AA) em 86 telas: 3 organizações × claro/escuro × paciente/equipe. A primeira auditoria achou 17 telas com contraste insuficiente, por duas causas: texto secundário `zinc-500` e cores semânticas sem variante escura. Corrigido com tokens (`--texto-secundario`, `--erro`/`--atencao`/`--sucesso`/`--informacao` por modo). Resultado: zero violações de qualquer gravidade.
