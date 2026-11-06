# Requisitos legais do piloto (F3): rascunhos

> **RASCUNHO PARA REVISÃO.** Estes documentos organizam o que o sistema faz, para que advogado,
> encarregado de dados e clínica decidam e assinem. **Não são parecer jurídico.** Os itens marcados
> **[DECIDIR]** precisam de resposta antes de colocar pacientes reais no sistema.

Critério de saída da F3 (seção 15) e onde cada item está:

| Item | Documento | Situação |
|---|---|---|
| Contrato de serviço e acordo de tratamento de dados com a clínica | [checklist-contrato-e-dpa.md](checklist-contrato-e-dpa.md) | cláusulas mínimas listadas; redação pelo advogado |
| Termos e privacidade publicados | [termos-e-privacidade.md](termos-e-privacidade.md) | estrutura e conteúdo factual; texto final pelo advogado; publicação = versão em `termos.versao` da organização |
| Registro das operações e bases legais (art. 37) | [registro-de-operacoes.md](registro-de-operacoes.md) | preenchido com o que o sistema trata |
| RIPD inicial (art. 38) | [ripd-inicial.md](ripd-inicial.md) | riscos e medidas a partir do código; avaliação final pelo encarregado |
| Encarregado de dados (art. 41) | [registro-de-operacoes.md](registro-de-operacoes.md#encarregado) | **[DECIDIR]** quem é, da plataforma e de cada clínica |
| Subprocessadores mapeados | [subprocessadores.md](subprocessadores.md) | lista por função; os fornecedores dependem da hospedagem (QUESTION-025) |
| Plano de incidente testado | [../operacao/incidente.md](../operacao/incidente.md) | plano, ferramentas (`pnpm incidente`) e roteiro de simulado |
| Textos de alerta e de urgência revisados | [textos-para-revisao.md](textos-para-revisao.md) | todos os textos reunidos, com campo para o revisor assinar |
| Produção no ar e primeira clínica com 5 pacientes | [../operacao/implantacao.md](../operacao/implantacao.md) | checklist de implantação |

Papéis na LGPD (ADR-0007):
- **Clínica: controladora** dos dados dos seus pacientes.
- **Plataforma: operadora.** Trata dados só por instrução da clínica (art. 39) e não cruza dados entre organizações: não há conta global de paciente, e o isolamento é por RLS, testado no CI.
