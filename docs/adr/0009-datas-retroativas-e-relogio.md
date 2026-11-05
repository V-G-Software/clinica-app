# ADR-0009 — Acompanhamento com data retroativa e relógio do backend

- **Status:** proposto (F0) — confirmar com produto (QUESTION-001) · **Data:** 2026-11-05

## Decisão
Ao criar um acompanhamento com `dataInicio` no passado (RN-ACO-002):
- check-in com `disponivelEm` no passado e `expiraEm` no futuro nasce `DISPONIVEL` (e notifica);
- check-in com `expiraEm` também no passado nasce `EXPIRADO` **sem** gerar alerta `CHECKIN_EXPIRADO` nem notificação (é registro retroativo, não falta do paciente);
- orientações cujo horário já passou não são publicadas na conversa.

`GET /v1/publico/saude` expõe `agora` (relógio do backend). A suíte usa esse valor e o fuso da organização para montar datas relativas — funciona contra o mock (relógio simulado) e contra backends reais.

## Consequências
- Sem rajada de alertas falsos ao cadastrar retroativamente.
- O mock usa os **mesmos jobs** para o seed e para o relógio simulado: o histórico dos cenários é produzido pelas regras, não escrito à mão.
