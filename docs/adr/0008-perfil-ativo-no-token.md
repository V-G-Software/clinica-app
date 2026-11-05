# ADR-0008 — Perfil ativo vai no token de acesso

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Contexto
`PUT /v1/sessao/perfil-ativo` devolve um novo `tokenAcesso`. Na primeira versão do mock o perfil ficava na sessão: trocar de perfil numa aba mudava as permissões de todos os tokens da sessão. A suíte de conformidade expôs o problema (testes de gestor herdando o perfil `PROFISSIONAL` de outro teste).

## Decisão
O perfil ativo é uma **propriedade do token de acesso** (uma claim, no backend de referência). A sessão guarda o último perfil escolhido apenas para a renovação. Token antigo continua no perfil antigo até expirar (≤ 15 min).

## Consequências
- (+) Duas abas com perfis diferentes não interferem; autorização sem estado mutável compartilhado.
- A suíte verifica que, depois da troca, o token anterior continua no perfil anterior.
