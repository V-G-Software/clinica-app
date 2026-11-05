# Backend de referência

Implementação do contrato (`contrato/openapi.yaml`) em Node 22 + Fastify + PostgreSQL. Decisões em [ADR-0013](../docs/adr/0013-backend-de-referencia.md). Fase atual: **F1** (núcleo — público, autenticação, sessão, pacientes, formulários, arquivos, equipe, notificações, eventos). Operações de F2/F3 respondem 404 `Operação ainda não implementada`.

## Subir localmente

```bash
psql -U postgres -f scripts/papeis.sql          # uma vez: papéis clinica_dono / clinica_app e banco
cp .env.exemplo .env                             # ajuste e exporte (ex.: set -a; . ./.env; set +a)
pnpm migrar                                      # como clinica_dono
pnpm org:criar --todos                           # os 3 cenários de contrato/exemplos/cenarios
pnpm dev                                         # http://localhost:4020/o/{slug}
```

Uma organização nova: `pnpm org:criar --arquivo org.json` (mesmo formato dos cenários); mudanças de configuração: `pnpm org:atualizar --arquivo org.json`. Chaves de produção: `pnpm chaves`.

## Testes

```bash
pnpm test        # isolamento entre organizações (banco e HTTP) e eventos — precisa do banco semeado
pnpm typecheck
```

Conformidade contra este backend (com `MODO_TESTE_CODIGO_EMAIL=123456`):

```bash
cd ../conformidade && CONF_DIRETORIO_URL=http://localhost:4020/diretorio CONF_SLUG=modelo-otorrino \
  npx vitest run testes/01* testes/02* testes/03* testes/04* testes/06* testes/08* testes/09*
```

A suíte consome a conta de primeiro acesso: para repetir, recrie o banco (ou `org:atualizar` não basta — a conta já está ativa).

## Regras que não podem quebrar
- Todo acesso a dado de cliente passa por `comOrg(orgId, fn)`. Nunca use `pool.query` em tabela de cliente.
- Tabela nova de cliente: coluna `organizacao_id`, RLS `ENABLE` + `FORCE`, política `isolamento`, `GRANT` mínimo. O teste `isolamento.test.ts` falha se uma tabela nova vier sem RLS.
- Recurso de outra organização ou invisível ao usuário: 404 igual ao inexistente.
- Respostas são validadas contra o contrato fora de produção (`VALIDAR_RESPOSTA`): violação vira 500 com `X-Violacao-Contrato`.
- `MODO_TESTE_*` impede o boot com `NODE_ENV=production`.
