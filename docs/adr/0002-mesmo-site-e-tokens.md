# ADR-0002 — Regra do mesmo site e estratégia de tokens

- **Status:** aceito (F0) · **Data:** 2026-11-05

## Contexto
O token de renovação precisa sobreviver a reaberturas do PWA sem ficar acessível a JavaScript. O Safari (ITP) bloqueia cookies de terceiros: com app e API em sites diferentes, o login quebraria no iPhone, aparelho de boa parte dos pacientes.

## Decisão
- App e API de cada organização no **mesmo site** (mesmo domínio registrável): `x.{{DOMINIO}}` + `api.x.{{DOMINIO}}`, ou `app.clinica.com.br` + `api.clinica.com.br`. O mesmo build estático é servido em vários domínios.
- `tokenAcesso`: 10–15 min, no corpo da resposta, **só em memória**, enviado em `Authorization: Bearer`.
- `tokenRenovacao`: cookie `HttpOnly; Secure; SameSite=Strict`, `Path={caminho de urlApi}/v1/auth`; rotacionado a cada uso; **reuso revoga a sessão inteira** (detecção de roubo). Com `X-Cliente: NATIVO`, vai no corpo (cofre do aparelho).
- Validade da renovação: 14 dias equipe, 90 dias paciente ([DECISÃO 6]).
- Nunca `localStorage` para tokens.
- CORS só para as origens da própria organização, com `credentials`.

## Consequências
- (+) Login estável no Safari/iOS; cada organização vira um app instalável com nome e ícone próprios.
- (−) Quem trabalha em duas clínicas instala dois apps (aceito no MVP). Cada organização precisa de DNS/TLS próprios.
- Em `http://localhost` o mock emite o cookie sem `Secure` (portas diferentes ainda são o mesmo site).
- A suíte verifica: atributos do cookie, rotação, reuso → `SESSAO_REVOGADA` também para o token novo, e saída.
