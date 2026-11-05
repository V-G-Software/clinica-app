# ADR-0001 — Contrato spec-first em OpenAPI 3.1

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Contexto
Um frontend único atende organizações servidas por backends diferentes, inclusive backends próprios de clientes (modelo C), que podem não ser em TypeScript. O Prompt Mestre gerava o contrato a partir de schemas Zod no código.

## Decisão
- `contrato/openapi.yaml` (OpenAPI 3.1, JSON Schema 2020-12) é a **fonte da verdade**, escrita e revisada como documento.
- Derivados, nunca editados à mão: `contrato/schemas/*.schema.json` e `catalogos.json` (`pnpm contrato:gerar`), `pacotes/contrato-tipos` (openapi-typescript), `pacotes/contrato-cliente` (openapi-fetch) e a documentação HTML (Redocly).
- `pacotes/contrato-validador` compila o YAML com Ajv e é usado por três consumidores: o **mock** (valida requisição e resposta; resposta fora do contrato vira 500 com `X-Mock-Violacao`), a **suíte de conformidade** (valida toda resposta) e o lint de exemplos.
- Lint com Spectral + regras próprias da seção 4.3 (camelCase sem acento, enums em maiúsculas, campos de data terminando em `Em`, caminhos `/v1` kebab-case, busca livre fora da query string, erro padrão declarado). As regras foram testadas com um arquivo quebrado de propósito.
- `pnpm verificar` falha se os artefatos gerados estiverem desatualizados em relação ao YAML (CI).

## Consequências
- (+) Backend em qualquer stack implementa a partir do YAML/JSON Schema e prova conformidade pela suíte.
- (+) O mock não consegue divergir do contrato sem quebrar.
- (−) Mudança exige editar YAML antes do código (é o objetivo). Erros de `if/then` em JSON Schema são menos legíveis; o validador formata mensagens por campo.
- **Atenção:** os enums do contrato são fechados para validar backends. O **frontend não deve validar respostas estritamente** (compatibilidade para frente, seção 1.2.4): ignora valores desconhecidos em vez de rejeitar.
