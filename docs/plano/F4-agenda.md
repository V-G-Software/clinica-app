# Plano da F4 — Módulo `agenda` (consultas e cirurgias)

Primeiro módulo da seção 10 ("Módulos futuros"). Decisões do produto (2026-11-06):
- o app é o sistema de origem: agenda, cirurgias, exames e prontuário nascem aqui; integração com ERP vira módulo depois;
- começar por **agenda + cirurgias**, o módulo de menor risco regulatório;
- quem marca: **os dois**. A equipe marca, e o paciente também marca nos horários liberados, se a organização ligar o autoagendamento.

A F3 ainda não cumpriu o critério de saída (produção e clínica piloto). Começar a F4 antes disso é decisão do produto, registrada aqui.

Desenho em [ADR-0016](../adr/0016-modulo-agenda.md).

## Critério de saída
- Contrato `1.1.0-rc.1`, só com adições: nenhuma operação, campo ou valor existente muda.
- Mock e backend passam 100% da conformidade do módulo nas organizações com `agenda` (otorrino e vet). Na fisio, o módulo fica desligado e a conformidade prova que ele some: as rotas respondem 404 e não há tela nem seção.
- Dois agendamentos sobrepostos para o mesmo profissional são impossíveis, mesmo com requisições simultâneas. A garantia vem do banco, por constraint de exclusão.
- O frontend troca do mock para o backend mudando só o endereço do diretório.

## Etapas (um PR por etapa)

| # | Etapa | Entrega | Depende de |
|---|---|---|---|
| 1 ✅ | Contrato, mock e conformidade | endpoints, schemas, permissões, telas, seções, notificações, eventos e erro novos; cenários com serviços, grades e agendamentos; mock; testes de conformidade; CHANGELOG | — |
| 2 ✅ | Backend | migração 0005 (serviços, grades, bloqueios, agendamentos com `EXCLUDE USING gist`), regras, jobs de lembrete, notificações, seções da tela inicial, isolamento | 1 |
| 3 ✅ | Frontend | equipe: agenda do dia e da semana, novo agendamento, detalhe e ações, serviços, grade e bloqueios. Paciente: minhas consultas, marcar, confirmar, cancelar, seção "Próxima consulta". E2E contra mock e backend | 1 (mock), 2 (real) |
| 4 | Cirurgia ↔ acompanhamento | criar o acompanhamento (pós-operatório) a partir do procedimento; remarcação e cancelamento propagam para ele (QUESTION-032) | 2, 3 |

## Depois da agenda (ordem proposta)
1. **Exames:** pedido de exame e resultados (PDF e imagem) enviados pela clínica ou pelo paciente. Reaproveita `arquivos`; PDF exige antivírus (ADR-0015, "fica para depois").
2. **Documentos** (receita, atestado, declaração): depende da QUESTION-031, que decide entre plataforma de assinatura consolidada e solução própria.
3. **Prontuário:** evolução clínica com modelos por especialidade, reaproveitando `formularios`. Guarda de 20 anos e integridade (CFM 1.821/2007). Precisa de parecer jurídico.
