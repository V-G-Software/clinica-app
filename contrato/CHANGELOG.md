# Changelog do contrato

Versionamento semântico (seção 4.2). Dentro de `1.x`, só mudanças aditivas.

## 1.0.0-rc.3 — 2026-11-06

Decisões de produto das QUESTION-010, 014, 016, 019 e 029. Só mudanças aditivas.

### Incluído
- `ConfigAcompanhamento.resolverAlertasAoEncerrar` (opcional, padrão `false`): ao encerrar ou concluir um acompanhamento, os alertas ainda abertos são resolvidos com nota automática (QUESTION-019).
- `OrganizacaoConfiguracao.acompanhamento` e `OrganizacaoEdicao.acompanhamento`: o gestor liga e desliga a opção acima.

### Esclarecido (sem mudança de formato)
- `POST /v1/me/exclusao` inativa a conta (`DESLIGADO`); um novo convite reativa a mesma conta com o histórico (QUESTION-010).
- Termos novos: o aceite continua no próximo login (`ACEITAR_TERMOS`); a organização avisa as contas ativas com uma notificação `SISTEMA` (QUESTION-014).

## 1.0.0-rc.2 — 2026-11-05 (FE1)

### Corrigido
- Listas paginadas: o schema base `Pagina` não declara mais `itens` genérico, e cada lista marca `itens` como obrigatório com o tipo concreto. Antes, os tipos gerados viam `itens` como `unknown`. Sem mudança no JSON trafegado.

## 1.0.0-rc.1 — 2026-11-05 (F0)

Primeira versão completa da v1, escrita a partir de `docs/PROMPT_BACKEND.md`.

### Incluído
- Diretório, configuração pública, saúde e convite público.
- Autenticação por etapas (`CONCLUIDO`, `MFA`, `CONFIGURAR_MFA`, `CODIGO_ENVIADO`, `TROCAR_SENHA`, `ACEITAR_TERMOS`), TOTP, código por e-mail, convites, renovação rotacionada, saída.
- Manifesto, troca de perfil, contadores, conta, exclusão de conta, tela inicial com 9 tipos de seção.
- Notificações (central, preferências, Web Push), arquivos (envio em 3 passos), eventos (SSE e polling).
- Módulos `pacientes`, `acompanhamento` (formulários, protocolos, acompanhamentos, check-ins, alertas), `chat`, `equipe` e configuração da organização.
- Catálogos fechados (perfis, módulos, telas, termos, contadores, ícones, códigos de erro, notificações, eventos, seções, permissões).

### Diferenças em relação ao texto do prompt
- **Novo:** `GET /v1/equipe/membros/{membroId}` (fonte do `ETag` para o `PATCH`).
- **Novo:** `Convite.token`, para aceitar sem extrair token de URL opaca.
- **Novo:** `Saude.agora` (relógio do backend), usado pela suíte para datas relativas.
- **Novo:** `autenticacao.termosVersao` na configuração pública e `termos { versao, url }` na etapa `ACEITAR_TERMOS`.
- **Novo:** `GET /v1/eventos` sem `depois` devolve `ultimoEventoId` (ponto de partida).
- **Novo:** lista de mensagens usa `{ itens, temMais }` (paginação por `antesDe`/`depoisDe`, não por cursor).
- **Novo:** campos `Paciente.conversaAtivaId`, `Paciente.criadoEm`, `Acompanhamento.observacao|motivoEncerramento|criadoEm`, `resumoCheckins.agendados`, `Checkin.anexos`, `Secao.titulo`, `Mensagem.referencia.tipo = ACOMPANHAMENTO`, `StatusMembro.CONVIDADO`, `Capacidades.push.modo = NENHUM`.
- **Novo:** `304` com `If-None-Match` em `GET /v1/publico/configuracao` e `GET /v1/sessao`.
