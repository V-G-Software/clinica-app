# ADR-0004 — Formato próprio de formulário

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Contexto
O Prompt Mestre usava JSON Schema + UI Schema (estilo JSON Forms). Isso é poderoso, mas difícil de gerar corretamente por backends de terceiros, de desenhar com o design system e de avaliar regras de alerta.

## Decisão
Formato próprio, `components.schemas.Formulario` (gerado em `contrato/schemas/formulario.schema.json`): lista ordenada de campos com 11 tipos fechados (`TEXTO`, `TEXTO_LONGO`, `NUMERO`, `ESCALA`, `SIM_NAO`, `ESCOLHA_UNICA`, `ESCOLHA_MULTIPLA`, `DATA`, `HORA`, `FOTO`, `INFORMACAO`), `visivelSe` com 5 operadores, versão imutável (RN-FRM-001).

- Regras de alerta reaproveitam os mesmos operadores sobre `respostas[campo]`.
- Campo obrigatório só é exigido se visível; valor enviado para campo invisível é rejeitado (evita dado "fantasma" que dispararia alerta).
- O backend valida sempre (RN-FRM-003); a validação do frontend é só UX.
- `opcoes[].valor` em MAIÚSCULAS (estável) e `rotulo` livre (exibição).

## Consequências
- (+) Qualquer backend gera e valida com pouco código; o frontend mapeia 1 tipo → 1 componente.
- (−) Sem layout (colunas, grupos) nem validação cruzada além de `visivelSe`. Se necessário, vira tipo/propriedade nova (aditiva, 1.x).
