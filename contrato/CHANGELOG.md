# Changelog do contrato

Versionamento semântico (seção 4.2). Dentro de `1.x`, só mudanças aditivas.

## 1.1.0-rc.2 — 2026-11-06 (F4, etapa 4)

Procedimento da agenda ligado ao acompanhamento pós-procedimento (QUESTION-032, decidida). Só adições.

### Incluído
- `POST /v1/agendamentos`: campo opcional `acompanhamento` (`protocoloId`, `equipeIds`). Só equipe e só em `PROCEDIMENTO`; o acompanhamento nasce `AGENDADO` no dia local do procedimento.
- `Agendamento.acompanhamentoId` e `Acompanhamento.agendamentoId`: a ligação nos dois sentidos (`null` quando não há).
- `Servico.protocoloId` e `ServicoEdicao.protocoloId`: protocolo sugerido ao marcar o procedimento.

### Esclarecido
- RN-AGE-008:
  - remarcar para outro dia **encerra** o acompanhamento ligado e cria um novo, com o mesmo protocolo e a mesma equipe, no novo dia; o agendamento passa a apontar para o novo;
  - cancelar ou registrar falta encerra o acompanhamento ligado, com o motivo;
  - acompanhamento já concluído ou encerrado não muda.

## 1.1.0-rc.1 — 2026-11-06 (F4, etapa 1)

Módulo `agenda`: consultas e procedimentos (cirurgias), grade, bloqueios e autoagendamento ([ADR-0016](../docs/adr/0016-modulo-agenda.md)). Versão menor, só com adições. Organizações sem o módulo ficam idênticas.

### Incluído
- **Tag `agenda`, 18 operações:**
  - serviços (`/v1/agenda/servicos`: listar, criar, obter, editar, arquivar);
  - grade por profissional (`/v1/agenda/grades/{profissionalId}`);
  - bloqueios (`/v1/agenda/bloqueios`);
  - horários livres (`/v1/agenda/horarios`);
  - agendamentos: listar, criar, obter, editar, `confirmar`, `cancelar`, `remarcar`, `realizar` e `falta`.
- **Schemas:** `Servico`, `ServicoEdicao`, `ItemGrade`, `Grade`, `Bloqueio`, `HorarioLivre`, `Agendamento`, `AgendamentoResumo`, `EventoAgendamento`, `ConfigAgenda`, além dos enums `CategoriaServico`, `StatusServico` e `StatusAgendamento`.
- **Parâmetros:** `ServicoId`, `ProfissionalId`, `BloqueioId`, `AgendamentoId`, `De` e `Ate` (datas locais, inclusivas).
- **Catálogos:**
  - `ModuloId.agenda`;
  - 7 telas `agenda.*`;
  - termo `consulta`, opcional no manifesto (o frontend usa o padrão);
  - ícones `calendar-plus`, `calendar-check` e `calendar-clock`;
  - erro `HORARIO_INDISPONIVEL` (409);
  - notificações `AGENDAMENTO_CRIADO`, `AGENDAMENTO_ALTERADO` e `AGENDAMENTO_LEMBRETE`;
  - eventos `agenda.agendamento.criado` e `agenda.agendamento.atualizado`;
  - seções `PROXIMA_CONSULTA` e `AGENDA_DO_DIA`;
  - 4 permissões `agenda.*`.
- **Configuração da organização:** `OrganizacaoConfiguracao.agenda` e `OrganizacaoEdicao.agenda`.

### Esclarecido
- Menu com mais de 5 itens `PRINCIPAL`: o excedente vai para `SECUNDARIO`, na ordem. O paciente com agenda passa a ter "Meu perfil" em "Mais".

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
