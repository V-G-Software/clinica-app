# ADR-0007 — Sem conta global de paciente entre organizações

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Decisão
Cada organização tem suas próprias contas. O mesmo e-mail em duas clínicas são duas contas independentes, em dois apps instalados (consequência também do ADR-0002). O diretório não guarda usuário nem dado de paciente.

## Por quê
- **LGPD:** a clínica é a **controladora** dos dados; a plataforma, **operadora**. Uma conta global faria a plataforma decidir finalidade (ligar dados entre clínicas), o que a aproximaria de controladora, com outra base legal, RIPD e responsabilidade.
- Isolamento por organização (RLS) fica simples e testável: nenhuma consulta atravessa organizações.

## Consequências
- (−) Paciente atendido por duas clínicas faz dois logins. Aceitável no MVP.
- Reverter exigiria consentimento específico e novo desenho jurídico — registrar em ADR novo.
