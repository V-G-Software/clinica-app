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

## Agenda (1.1 — ADR-0016)

| Cenário | Módulo `agenda` | O que tem |
|---|---|---|
| `modelo-otorrino` | ligado, **com autoagendamento** | consulta (autoagendável), retorno, septoplastia e rinoplastia; grades da Ana e do Carlos; feriado de 20/11 e congresso da Ana; cirurgias de Rafael (realizada) e Beatriz (confirmada), retornos, uma falta e um cancelamento |
| `vet-amigo` | ligado, **sem autoagendamento** (só a equipe marca) | consulta, vacinação e castração; castração da Nina realizada, retorno do Thor, vacina da Mel cancelada pela tutora |
| `fisio-movimento` | desligado | rotas `agenda` respondem 404 `MODULO_NAO_CONTRATADO` |

O lembrete sai `lembreteHorasAntes` antes do horário, como job `agendamento:{id}:lembrete`. Para vê-lo, avance o relógio.

## Exames (1.2 — ADR-0017)

| Cenário | Módulo `exames` | O que tem |
|---|---|---|
| `modelo-otorrino` | ligado; **paciente envia resultados** | pedido pré-operatório da Beatriz (3 exames, aberto) com o hemograma enviado por ela aguardando revisão; tomografia do Marcos enviada pela equipe, revisada pelo Carlos (pedido concluído) |
| `vet-amigo` | ligado; **só a equipe envia** | pedido de hemograma do Thor, aberto |
| `fisio-movimento` | desligado | rotas `exames` respondem 404 `MODULO_NAO_CONTRATADO`; PDF é recusado (415) |

PDF só é aceito com a finalidade `EXAME`. O mock simula o antivírus: um arquivo que contém a assinatura de teste EICAR fica `REJEITADO`. PDF é servido como anexo (`Content-Disposition: attachment`) e não tem miniatura.

## Documentos (1.3 — ADR-0018)

| Cenário | Módulo `documentos` | O que tem |
|---|---|---|
| `modelo-otorrino` | receita e atestado; entrega pelo chat | atestado de 7 dias do Rafael, assinado e entregue na conversa (validação `RAFAEL7DIASSEPTO`); receita do Marcos assinada e **anulada** (`MARCOSRECEITA001`); receita da Beatriz em **rascunho** para a Dra. Ana assinar |
| `vet-amigo` | **só receita**; entrega pelo chat | receita do Thor assinada pela Dra. Renata (CRMV), entregue à tutora (`THORRECEITAVET01`) |
| `fisio-movimento` | desligado | rotas `documentos` e a validação pública respondem 404 |

**PSC simulado.** `capacidades.assinatura.provedores` traz `teste`. A `urlAutorizacao` aponta para `/__mock/psc/{slug}/autorizar`, que autoriza na hora e redireciona (302) para o retorno público com `code`. O retorno assina e volta ao `retornoUrl` com `?assinatura={id}`. Para simular a recusa, chame o retorno com `state` e `error=access_denied`. O PDF gerado é um PDF de verdade, mas a assinatura é simulada e o rodapé diz que **não tem validade jurídica**.

Validação pública: `GET /o/{slug}/v1/publico/documentos/{codigo}`.

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
