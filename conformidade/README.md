# Suíte de conformidade

Testa se **qualquer** backend segue o contrato. Um backend só entra no diretório para uma organização real se passar 100%.

```bash
pnpm conformidade                     # contra o mock (padrão)
CONF_URL_API=https://api.clinica.exemplo CONF_GESTOR_EMAIL=... pnpm conformidade
```

Saída: `conformidade/relatorio.md` e `relatorio.json` com **"Compatível com o contrato X.Y.Z: sim/não"**, falhas e cobertura de operações. Exit code 0 só se compatível.

## Configuração (ver `.env.exemplo`)

| Variável | Para quê |
|---|---|
| `CONF_DIRETORIO_URL` + `CONF_SLUG` ou `CONF_URL_API` | alvo |
| `CONF_GESTOR_EMAIL`, `CONF_GESTOR_SENHA`, `CONF_GESTOR_TOTP` | conta com perfil `GESTOR` e o **segredo TOTP** (a suíte calcula o código; nunca reusa a mesma janela de 30 s) |
| `CONF_PACIENTE_EMAIL`, `CONF_CODIGO_EMAIL` | login por código; o ambiente de teste precisa aceitar um código fixo (QUESTION-003) |
| `CONF_PRIMEIRO_ACESSO_EMAIL/SENHA` | conta nova para as etapas `TROCAR_SENHA`/`CONFIGURAR_MFA`/`ACEITAR_TERMOS` (consumida; vazio desliga) |
| `CONF_ANTES_URL` | `POST` antes da suíte (no mock: `/__mock/reiniciar`) |
| `CONF_PRAZO_TEMPO_REAL_MS` | prazo de entrega de eventos (padrão 5000) |

A suíte cria seus próprios pacientes (via convite) a cada execução, com e-mails únicos.

## O que é verificado

- **Toda resposta** contra o contrato: status declarado, content-type, schema, `problem+json` com `requestId`, eco de `X-Request-Id`, nenhum detalhe interno (stack, SQL) no erro.
- 404 para o invisível (paciente A × B em paciente, acompanhamento, check-in, conversa, arquivo, inscrição de push).
- Login: todas as etapas, MFA, código, limites (429), renovação com rotação e **reuso revogando a sessão**, cookie `HttpOnly; SameSite=Strict` restrito a `/v1/auth`, saída.
- Manifesto: menu só aponta para telas de módulos ativos, ≤ 5 itens principais, termos completos, permissões coerentes, `ETag`/304, perfil no token.
- Paginação, idempotência (POST repetido não duplica; chave ausente → 422), concorrência (`If-Match` desatualizado → 412 com `estadoAtual`).
- Arquivo até `DISPONIVEL`, rejeição por conteúdo (magic bytes), limites de tipo e tamanho, URL de até 5 min.
- Acompanhamento retroativo: check-in disponível, validação contra o formulário, alerta pela regra, versão do protocolo congelada, encerramento.
- Chat: mensagem do paciente chega à equipe **em até 5 s** pelo modo declarado (SSE ou polling) e **também por polling**; `Last-Event-ID`; `idCliente` idempotente; leitura; arquivada → 409.
- Equipe: convite → primeiro acesso, desligamento revoga sessão, `ULTIMO_GESTOR`.

Testes de módulos desligados na organização são ignorados (ex.: `fisio-movimento` não tem `equipe`).
