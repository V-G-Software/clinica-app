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

## Estado: FE0 (esqueleto) concluída

| Critério de saída | Como foi verificado |
|---|---|
| As 3 organizações abrem com marca, nome e ícone próprios | E2E: título, `theme-color`, cor de ação e manifest por organização |
| O manifesto define o menu | E2E: menus diferentes por organização e por perfil (equipe, gestor, tutora) |
| Testes unitários verdes | 42 testes: descoberta, versões, cor/contraste, termos e plural, datas no fuso, menu, renovação single-flight, middleware 401, manifest |

Também verificado no E2E: sessão restaurada pelo cookie ao recarregar, nenhum token em storage, renovação automática depois de o relógio do mock avançar 1 dia, duas abas renovando juntas, troca de perfil, guarda de rotas.

**Adiantado da FE1:** login completo por etapas (senha, MFA, configurar MFA com QR, códigos de recuperação, troca de senha, termos e código por e-mail), necessário para validar o manifesto. As demais telas mostram "em construção", com a fase prevista.

## Estrutura
```text
src/app/         descoberta, inicialização (3 camadas), marca/cores, versão
src/api/         cliente do contrato, renovação single-flight entre abas, erros RFC 9457
src/sessao/      store de sessão (token só em memória) e menu do manifesto
src/catalogo/    catálogo fixo de telas e ícones
src/i18n/        vue-i18n (textos da UI) + termos do domínio + datas no fuso da organização
src/ds/          design system base (tokens da marca em runtime)
src/telas/       telas do catálogo
src/pwa/         service worker, registro e manifest web
borda/           função de borda que serve o manifest por organização em produção
```
