# Plano da F5 — Módulo `exames` (central de exames)

Decisões do produto (2026-11-07):
- pedido como registro estruturado;
- resultados enviados pelo paciente e pela equipe;
- PDF aceito com antivírus e saneamento;
- revisão pelo médico, com nota.

Desenho em [ADR-0017](../adr/0017-modulo-exames.md).

## Critério de saída
- Contrato `1.2.0-rc.1`, só com adições.
- Mock e backend passam 100% da conformidade do módulo nas organizações com `exames` (otorrino e vet). Na fisio, o módulo some: as rotas respondem 404 e não há tela nem seção.
- PDF com malware (EICAR) é REJEITADO e nunca servido; PDF com JavaScript é servido sem ele.
- O frontend troca do mock para o backend mudando só o endereço do diretório.

## Etapas (um PR por etapa)

| # | Etapa | Entrega | Depende de |
|---|---|---|---|
| 1 ✅ | Contrato, mock e conformidade | endpoints, schemas, catálogos, cenários, mock, testes de conformidade, CHANGELOG | — |
| 2 ✅ | Backend | migração, regras, notificações, seções, contador, pipeline de PDF (ClamAV e saneamento), testes | 1 |
| 3 ✅ | Frontend | telas da equipe e do paciente, envio de PDF e foto, revisão, seções do início. E2E contra mock e backend | 1 (mock), 2 (real) |
