# {{PRODUTO}} — acompanhamento entre consultas

Monorepo do contrato da API, do mock, da suíte de conformidade e (a partir da F1) do backend de referência. Um único frontend (PWA) se adapta a cada organização lendo diretório → configuração pública → manifesto da sessão.

| Pasta | O quê |
|---|---|
| `contrato/` | `openapi.yaml` (fonte da verdade), `schemas/` e `catalogos.json` gerados, cenários e exemplos, Spectral, CHANGELOG |
| `pacotes/contrato-validador` | Ajv sobre o YAML; usado por mock, suíte e lint |
| `pacotes/contrato-tipos`, `pacotes/contrato-cliente` | tipos TS gerados e cliente tipado (openapi-fetch) |
| `mock/` | servidor de mentira com 3 organizações — ver `mock/README.md` |
| `conformidade/` | suíte que testa qualquer backend — ver `conformidade/README.md` |
| `docs/` | `PROMPT_BACKEND.md`, ADRs, plano das fases, `QUESTIONS.md` |

```bash
pnpm install
pnpm contrato:lint      # Spectral + regras próprias + exemplos válidos
pnpm contrato:gerar     # schemas JSON + tipos TS a partir do YAML
pnpm contrato:docs      # contrato/dist/index.html
pnpm mock               # http://localhost:4010
pnpm conformidade       # suíte contra o mock (com o mock no ar)
pnpm verificar          # lint + gerados em dia + typecheck (CI)
```

Requer Node 22+ e pnpm 10.
