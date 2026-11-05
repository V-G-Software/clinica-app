# Frontend — PWA único

Construído a partir de `docs/PROMPT_FRONTEND.md`, sobre o contrato (`@clinica/contrato-cliente`) e o mock.

```bash
pnpm mock                          # http://localhost:4010
pnpm --filter frontend dev         # http://localhost:5173/?org=modelo-otorrino
pnpm --filter frontend test        # unitários (Vitest)
pnpm --filter frontend e2e         # E2E com Playwright (mock e dev server no ar)
pnpm --filter frontend build       # build de produção + service worker
```

Em desenvolvimento, `?org=` escolhe a organização (fica lembrado) e o botão de chave inglesa troca de organização e avança o relógio do mock. Logins de teste: `mock/README.md`.

## Estado

### FE1 · login e paciente: concluída
| Critério de saída | Como foi verificado |
|---|---|
| E2E 2: paciente responde o check-in, vê a confirmação e não vê o alerta | `e2e/fe1.mjs` |
| E2E 4: relógio +1 dia, renovação sem login, dia 4 aparece | `e2e/fe1.mjs` |
| E2E 5: convite + onboarding | `e2e/fe1.mjs` (Paulo) |
| E2E 6: primeiro acesso da equipe | `e2e/fe1.mjs` (Carlos) |
| E2E 9: mensagem offline reenviada sem duplicar | `e2e/fe1.mjs` |
| Teste manual em iPhone real instalado (push chegando) | **pendente**: precisa de build publicado em HTTPS e chave VAPID real |

Também no E2E: alerta e mensagem chegam à equipe em tempo real, sem recarregar.

Telas: início do paciente, meus acompanhamentos (com seletor de pet), detalhe com linha do tempo, check-in passo a passo com fotos, conversas (envio otimista, fila offline, fotos, aviso de urgência, fora do horário, leitura), notificações, perfil (tema, densidade, notificações por tipo, push, sair de todos, excluir conta), convite e onboarding. Tempo real com SSE/polling e aba líder.

### FE0 · esqueleto: concluída
As 3 organizações com marca própria e o menu vindo do manifesto (`e2e/fe0.mjs`).

## Estrutura
```text
src/app/         descoberta, inicialização (3 camadas), marca/cores, versão
src/api/         cliente do contrato, renovação single-flight entre abas, erros RFC 9457
src/sessao/      store de sessão (token só em memória) e menu do manifesto
src/catalogo/    catálogo fixo de telas e ícones
src/i18n/        vue-i18n (textos da UI) + termos do domínio + datas no fuso da organização
src/ds/          design system base (tokens da marca em runtime)
src/telas/       telas do catálogo
src/pwa/         service worker, registro, manifest web e push
src/tempo-real/  SSE/polling, aba líder, evento → invalidação
src/dados/       cache de consultas, mensagens, envio de arquivos
borda/           função de borda que serve o manifest por organização em produção
```
