# Backend de referência

Implementação do contrato (`contrato/openapi.yaml`) em Node 22 + Fastify + PostgreSQL. Decisões em [ADR-0013](../docs/adr/0013-backend-de-referencia.md) (núcleo) e [ADR-0014](../docs/adr/0014-jobs-push-e-email.md) (jobs, push, e-mail) e [ADR-0015](../docs/adr/0015-seguranca-para-o-piloto.md) (segurança do piloto) e [ADR-0016](../docs/adr/0016-modulo-agenda.md) (agenda) e [ADR-0017](../docs/adr/0017-modulo-exames.md) (exames). Fase atual: **F5** — todas as operações do contrato 1.2: núcleo (F1), protocolos, acompanhamentos, check-ins, alertas, chat, jobs agendados, Web Push, e-mail SMTP (F2–F3), o módulo agenda (consultas e cirurgias) e o módulo exames (pedidos, resultados com PDF sob antivírus e saneamento, revisão). PDF exige `ANTIVIRUS_URL` (clamd; `teste` fora de produção).

## Subir localmente

```bash
psql -U postgres -f scripts/papeis.sql          # uma vez: papéis clinica_dono / clinica_app e banco
cp .env.exemplo .env                             # ajuste e exporte (ex.: set -a; . ./.env; set +a)
pnpm migrar                                      # como clinica_dono
pnpm org:criar --todos                           # os 3 cenários de contrato/exemplos/cenarios
pnpm dev                                         # API + worker de jobs em http://localhost:4020/o/{slug}
```

O seed reproduz a linha do tempo dos cenários (respostas, alertas, mensagens) até agora, deslocada em dias inteiros para que "hoje" seja o dia de referência do mock (2026-11-08); o que fica no futuro vira job agendado. `CENARIO_DESLOCAR=0` mantém as datas absolutas.

Frontend apontando para este backend: `VITE_DIRETORIO_URL=http://localhost:4020/diretorio pnpm --filter frontend dev` (backend com `MODO_TESTE_CODIGO_EMAIL=123456` e `MODO_TESTE_TOTP=000000` para entrar com os códigos fixos).

Ambiente completo com Docker (Postgres 17, MinIO, Mailpit): ver `docker-compose.yml` na raiz. Produção: [docs/operacao/implantacao.md](../docs/operacao/implantacao.md); incidente: [docs/operacao/incidente.md](../docs/operacao/incidente.md) e `pnpm incidente`.

Uma organização nova: `pnpm org:criar --arquivo org.json` (mesmo formato dos cenários); mudanças de configuração: `pnpm org:atualizar --arquivo org.json`. Se `autenticacao.termosVersao` mudar, todas as contas ativas recebem uma notificação na hora (texto em `--aviso "..."`) e aceitam no próximo login (QUESTION-014). Chaves de produção: `pnpm chaves`.

## Testes

```bash
pnpm test        # isolamento, eventos, jobs, concorrência, Web Push, imagem, JWT, cabeçalhos, limites e agenda — precisa do banco semeado
pnpm typecheck
```

Conformidade contra este backend (com `MODO_TESTE_CODIGO_EMAIL=123456`):

```bash
cd .. && CONF_DIRETORIO_URL=http://localhost:4020/diretorio CONF_SLUG=modelo-otorrino pnpm conformidade
node frontend/e2e/backend-real.mjs     # frontend real contra este backend (precisa do frontend em :5173)
```

A suíte consome a conta de primeiro acesso: para repetir, recrie o banco (ou `org:atualizar` não basta — a conta já está ativa).

## Regras que não podem quebrar
- Todo acesso a dado de cliente passa por `comOrg(orgId, fn)`. Nunca use `pool.query` em tabela de cliente.
- Tabela nova de cliente: coluna `organizacao_id`, RLS `ENABLE` + `FORCE`, política `isolamento`, `GRANT` mínimo. O teste `isolamento.test.ts` falha se uma tabela nova vier sem RLS.
- Recurso de outra organização ou invisível ao usuário: 404 igual ao inexistente.
- Respostas são validadas contra o contrato fora de produção (`VALIDAR_RESPOSTA`): violação vira 500 com `X-Violacao-Contrato`.
- `MODO_TESTE_*` impede o boot com `NODE_ENV=production`.
- Efeito agendado é job (`agendar()` na MESMA transação da regra), com id determinístico e handler idempotente que confere o estado antes de agir. Nunca `setTimeout` para regra de negócio.
- Push e e-mail nunca levam conteúdo clínico nem nome de paciente (RN-NOT-002): só o texto discreto e o destino.
