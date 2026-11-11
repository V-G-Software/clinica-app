# Plano da F6 — Módulo `documentos` (receita e atestado)

Decisão da QUESTION-031 (2026-11-11): assinatura própria com certificado ICP-Brasil em nuvem (PSC, padrão do ITI), com entrega pelo chat. Detalhes em [ADR-0018](../adr/0018-modulo-documentos.md).

## Critério de saída
- Contrato `1.3.0-rc.1`, só com adições.
- Mock e backend passam 100% da conformidade do módulo nas organizações com `documentos` (otorrino e vet). Na fisio, sem o módulo, as rotas respondem 404 e não há tela nem seção.
- Documento sem assinatura nunca chega ao paciente. Sem provedor configurado, não há como assinar.
- O PDF assinado tem assinatura PAdES válida para o certificado do PSC de teste: a verificação criptográfica passa no teste do backend.
- Receita e atestado chegam ao paciente pelo chat, como mensagem com o PDF, e em "Meus documentos".
- A validação pública responde pelo código e mostra `ANULADO` depois da anulação.

## Etapas (um PR por etapa)

| # | Etapa | Entrega | Depende de |
|---|---|---|---|
| 1 ✅ | Contrato, mock e conformidade | endpoints, schemas, catálogos, cenários, mock (PSC simulado, PDF, entrega pelo chat, validação pública), testes de conformidade, CHANGELOG | — |
| 2 ✅ | Backend | migração, geração do PDF, PAdES com PSC (adaptador da API do ITI e PSC de teste), sessão de assinatura, entrega pelo chat, validação pública, testes | 1 |
| 3 | Frontend | emitir receita e atestado (inclusive a partir do chat e do paciente), assinar em lote, telas do paciente, seções. E2E contra mock e backend | 1 (mock), 2 (real) |

## Antes de produção (fora do código)
- Cadastrar o app em cada PSC que a clínica do piloto usa e configurar `PSC_PROVEDORES`.
- Revisão jurídica do rodapé do PDF e do aviso sobre CID.
