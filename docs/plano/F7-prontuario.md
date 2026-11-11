# Plano da F7 — Módulo `prontuario`

Decisões do produto (2026-11-11):
- escopo completo (ficha clínica, anamnese, evolução, adendo, linha do tempo);
- registros imutáveis com autoria, com a assinatura ICP decidida pelo jurídico;
- paciente recebe só cópia sob pedido.

Detalhes em [ADR-0019](../adr/0019-modulo-prontuario.md) e perguntas para o jurídico em [prontuario-roteiro-juridico.md](../legal/prontuario-roteiro-juridico.md).

## Critério de saída
- Contrato `1.4.0-rc.1`, só com adições.
- Mock e backend passam 100% da conformidade do módulo nas organizações com `prontuario` (otorrino e vet). Na fisio, sem o módulo, as rotas respondem 404.
- **Imutabilidade comprovada:**
  - registro finalizado não muda pela API nem por UPDATE direto no banco (teste do backend);
  - versão anterior da ficha continua consultável.
- **Acesso:**
  - secretaria, gestor não profissional e paciente não leem (404/403);
  - toda leitura fica no log de acesso consultável pela gestão.
- **Cópia ao paciente:** pedido, aviso à equipe, PDF gerado no servidor, download pelo paciente, prazo de 15 dias visível.

## Etapas (um PR por etapa)

| # | Etapa | Entrega | Depende de |
|---|---|---|---|
| 1 | Contrato, mock e conformidade | ADR, roteiro jurídico, endpoints, schemas, catálogos, cenários, mock, testes de conformidade, CHANGELOG | — |
| 2 | Backend | migração (imutabilidade no banco, RLS), ficha versionada, registros, linha do tempo, cópia em PDF, auditoria de acesso, seed, testes | 1 |
| 3 | Frontend | prontuário do paciente (ficha, registros, linha do tempo), modelos por especialidade, cópias (equipe e paciente), log de acesso. E2E contra mock e backend | 1 (mock), 2 (real) |

## Depende do parecer jurídico (não bloqueia as etapas)
- assinatura ICP das evoluções (o fluxo da ADR-0018 é reaproveitado como adição);
- prazos de guarda (humano e veterinário), retenção do log de acesso e fim do contrato.
