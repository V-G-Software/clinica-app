# ADR-0005 — Conta do app separada do paciente

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Decisão
**Conta** (quem faz login) e **paciente** (quem recebe cuidado) são entidades distintas. Uma conta se vincula a 1..N pacientes com `relacao` `PROPRIO`, `DEPENDENTE` ou `ANIMAL`; a organização define as relações aceitas em `pacientes.config.relacoesPermitidas`.

- O manifesto do perfil `PACIENTE` e `GET /v1/me` trazem `pacientesVinculados`; o frontend alterna entre eles.
- Convite aceito com e-mail de conta já existente **vincula** em vez de criar outra conta (tutora com dois pets = 1 conta, 2 pacientes; ver cenário `vet-amigo`).
- Visibilidade do paciente = vínculo da conta (RN-ACO-009, RN-CHA-002); fora disso, 404.

## Consequências
- (+) Responsável por criança, idoso e pet sem gambiarra; troca de responsável não reescreve histórico.
- (−) Toda checagem de acesso do paciente passa pela tabela de vínculos (índice por `organizacao_id, conta_id`).
