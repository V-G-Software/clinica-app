# ADR-0003 — Tempo real por SSE com polling como alternativa

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Decisão
- `GET /v1/eventos/stream` (SSE) e `GET /v1/eventos?depois=` (polling e recuperação). O manifesto declara o modo em `capacidades.tempoReal` (`SSE` ou `POLLING`, com intervalo).
- O frontend consome SSE via `fetch` (não `EventSource`) para enviar `Authorization`; reconecta com `Last-Event-ID`.
- Eventos levam **só identificadores** (`modulo.entidade.fato`); o conteúdo é buscado na REST, onde a permissão é checada. Ping `: ping` a cada 25 s. Retenção de 24 h; cursor fora da janela → 410 `CURSOR_EXPIRADO` e o frontend recarrega as listas.
- `GET /v1/eventos` sem `depois` devolve `itens: []` e `ultimoEventoId` (ponto de partida do polling) — adição ao prompt.

## Por que não WebSocket
SSE atravessa proxies/CDN com HTTP comum, reconecta sozinho, é unidirecional (o envio já é REST, com idempotência) e no backend de referência distribui entre instâncias com `LISTEN/NOTIFY` do Postgres, sem Redis no MVP.

## Consequências
- O polling é **obrigatório** para todo backend (fallback quando o SSE falha); a suíte testa os dois e exige entrega em até 5 s.
- O cenário `vet-amigo` roda em `POLLING` para provar que o frontend funciona sem SSE.
