# Mock do contrato (F0)

Backend de mentira que o frontend usa enquanto o real não existe. Estado em memória carregado de `contrato/exemplos/cenarios/*.json`. **Toda requisição e toda resposta são validadas contra `contrato/openapi.yaml`**: se o mock gerar resposta fora do contrato, devolve 500 com `X-Mock-Violacao` e loga `RESPOSTA FORA DO CONTRATO`.

```bash
pnpm mock
```

| Endereço | O quê |
|---|---|
| `http://localhost:4010/diretorio/v1/organizacoes/{slug}` | diretório |
| `http://localhost:4010/o/{slug}` | `urlApi` de cada organização |
| `http://localhost:4010/__mock/cenarios` | logins de teste e convites pendentes de cada cenário |

Variáveis: `PORT` (4010), `MOCK_URL_PUBLICA`, `MOCK_URL_FRONTEND` (5173, usado nos links de convite), `MOCK_RELOGIO_INICIAL` (`2026-11-08T13:30:00Z`), `MOCK_CODIGO_EMAIL` (`123456`), `MOCK_TOTP` (`000000`), `MOCK_VALIDAR_RESPOSTA=0` (desliga o modo estrito — não use).

## Logins de teste

Senha da equipe: `Senha@12345`. **TOTP aceita `000000`** (ou o código real do segredo, num app autenticador). **Código por e-mail: `123456`.** Códigos de recuperação: `RECUPERA-0001..0003`.

| Cenário | Gestor + profissional | Secretaria | Pacientes (código por e-mail) |
|---|---|---|---|
| `modelo-otorrino` | ana@modelo-otorrino.exemplo | julia@modelo-otorrino.exemplo | marcos@ (dia 3, alerta aberto), rafael@ (dia 1), beatriz@ (antes da cirurgia), helena@ (concluído, conversa arquivada), sonia@ (sem push) — todos `@exemplo.com` |
| `fisio-movimento` | pedro@fisio-movimento.exemplo | lucas@fisio-movimento.exemplo | fernanda@ (14 dias), gustavo@ (conversa iniciada pelo paciente), clara@ (mãe de dependente) |
| `vet-amigo` | renata@vet-amigo.exemplo | diego@vet-amigo.exemplo | laura@ (tutora de Thor e Mel), caio@ (tutor de Nina) |

Primeiro acesso: `carlos@modelo-otorrino.exemplo` / `Provisoria@1` percorre `TROCAR_SENHA → CONFIGURAR_MFA → ACEITAR_TERMOS`. Convite pendente: Paulo Teixeira (`/__mock/cenarios` mostra o link).

## Relógio simulado e simuladores (fora do contrato)

O relógio começa em `2026-11-08T13:30:00Z` (10:30 em São Paulo) e anda junto com o tempo real.

| Rota | Uso |
|---|---|
| `GET /__mock/relogio` | hora simulada e próximos jobs |
| `POST /__mock/relogio` `{ "avancarHoras": 6 }` / `{ "avancarDias": 1 }` / `{ "definir": "2026-11-10T12:00:00Z" }` | avança e dispara check-ins, lembretes, expirações, orientações e conclusões com as regras RN-ACO |
| `POST /__mock/simular/checkin` `{ "org", "checkinId", "respostas"? }` | responde como o paciente (sem `respostas`, gera mínimas válidas) |
| `POST /__mock/simular/mensagem` `{ "org", "conversaId", "texto", "autorId"? }` | mensagem de outro participante (testa tempo real) |
| `POST /__mock/reiniciar` | volta ao estado inicial (ids determinísticos) |
| `GET /__mock/emails?org=&para=` · `GET /__mock/push?org=&usuarioId=` | caixas de saída |

Inscrição de push com `endpoint` contendo `expirado` simula 410 do serviço de push (RN-NOT-004).

## Falhas de propósito (qualquer rota)

- `X-Mock-Atraso-Ms: 2000` — atraso.
- `X-Mock-Erro: SESSAO_EXPIRADA` (um `codigo`) ou `X-Mock-Erro: 503` (um status) — erro no formato do contrato.

## Fluxo de ponta a ponta (roteiro para o frontend)

1. Entrar como `marcos@exemplo.com` (código `123456`): início mostra dia 3 com check-in disponível.
2. Responder com sangramento `INTENSO` → alerta para a equipe, mensagem `CHECKIN` na conversa.
3. Em outra aba, `ana@…` vê o alerta chegar (SSE) e o contador mudar.
4. `POST /__mock/relogio {"avancarDias":1}` → dia 4 abre, push em `/__mock/push`; o token de 15 min expira e o frontend renova.
5. `POST /__mock/relogio {"avancarDias":6}` → expirações e `CONCLUIDO`.
