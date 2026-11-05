# ADR-0006 — Um único frontend com perfis

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Decisão
Um só PWA para equipe e pacientes. O que muda por pessoa vem do **manifesto do perfil ativo**: menu, permissões, termos, módulos e capacidades. Perfis: `GESTOR`, `PROFISSIONAL`, `SECRETARIA`, `PACIENTE`; uma conta pode ter vários.

- O frontend desenha só telas de um catálogo fixo; item de menu ou seção desconhecida é ignorada.
- Botões dependem de `acoesPermitidas` (por item) e `permissoes` (globais); o frontend **não replica regra de negócio**.
- O perfil ativo vai **no token de acesso** (ADR-0008).

## Consequências
- (+) Uma base de código, um design system, um pipeline. Cada cliente "diferente" é configuração.
- (−) Bundle carrega telas de equipe também para pacientes → code splitting por rota é obrigatório no frontend.
