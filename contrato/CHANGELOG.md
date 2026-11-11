# Changelog do contrato

Versionamento semântico (seção 4.2). Dentro de `1.x`, só mudanças aditivas.

## 1.4.0-rc.1 — 2026-11-11 (F7, etapa 1)

Módulo `prontuario`: ficha clínica versionada, anamnese, evolução e adendo imutáveis, linha do tempo, cópia ao paciente sob pedido e auditoria de acesso ([ADR-0019](../docs/adr/0019-modulo-prontuario.md)). Versão menor, só com adições. Organizações sem o módulo ficam idênticas.

### Incluído
- **Tag `prontuario`, 15 operações:**
  - ficha (obter, gravar nova versão com If-Match, versões anteriores);
  - registros (listar, criar, obter, editar rascunho, `finalizar`, `descartar`);
  - linha do tempo;
  - log de acesso;
  - cópias (listar, solicitar, `atender`, `recusar`).
- **Schemas:**
  - `FichaClinica` e `FichaClinicaConteudo`, com `AlergiaFicha`, `MedicamentoFicha`, `ProblemaFicha` e `AntecedentesFicha`;
  - `RegistroClinico`, `ItemLinhaDoTempo`, `AcessoProntuario` e `CopiaProntuario`;
  - enums `TipoRegistroClinico` e `StatusRegistroClinico`.
- **Parâmetros:** `PacienteProntuarioId`, `RegistroClinicoId` e `CopiaProntuarioId`.
- **Catálogos:**
  - `ModuloId.prontuario`;
  - 4 telas `prontuario.*`;
  - ícone `notebook-pen`;
  - finalidade de formulário `PRONTUARIO` (modelos por especialidade);
  - finalidade de arquivo `PRONTUARIO` (só o servidor cria);
  - notificações `COPIA_PRONTUARIO_SOLICITADA` e `COPIA_PRONTUARIO_DISPONIVEL`;
  - 3 eventos `prontuario.*`;
  - seção `COPIAS_PRONTUARIO_PENDENTES`;
  - contador `prontuario.copiasPendentes`;
  - 5 permissões `prontuario.*`.

### Esclarecido
- Registro finalizado é imutável: a correção é feita por `ADENDO`. Versão anterior da ficha nunca é sobrescrita.
- Só o profissional lê o prontuário. Paciente, secretaria e gestor não profissional recebem 404. Toda leitura entra no log de acesso.

## 1.3.0-rc.1 — 2026-11-11 (F6, etapa 1)

Módulo `documentos`: receita simples e atestado assinados com certificado ICP-Brasil em nuvem (PSC, API do ITI) e entregues pelo chat ([ADR-0018](../docs/adr/0018-modulo-documentos.md); QUESTION-031 decidida). Versão menor, só com adições. Organizações sem o módulo ficam idênticas.

### Incluído
- **Tag `documentos`, 9 operações:**
  - `/v1/documentos`: listar, criar rascunho, obter, editar (If-Match), `descartar` e `anular`;
  - sessão de assinatura: `POST /v1/documentos/assinaturas` (1 a 10 rascunhos, provedor, `retornoUrl`), `GET /v1/documentos/assinaturas/{sessaoId}` e o retorno público do PSC (`GET /v1/documentos/assinaturas/retorno`, 302).
- **Validação pública:** `GET /v1/publico/documentos/{codigo}` (sem conteúdo clínico; iniciais do paciente e SHA-256 do PDF).
- **Schemas:** `Documento`, `ConteudoReceita`, `ConteudoAtestado`, `RegistroProfissional`, `SessaoAssinatura`, `ValidacaoDocumento` e `ConfigDocumentos`, além dos enums `TipoDocumento` e `StatusDocumento`.
- **Parâmetro:** `DocumentoId`.
- **Catálogos:**
  - `ModuloId.documentos`;
  - 4 telas `documentos.*`;
  - ícone `file-pen-line`;
  - finalidade de arquivo `DOCUMENTO` (só o servidor cria);
  - notificações `DOCUMENTO_DISPONIVEL` e `DOCUMENTO_ANULADO`;
  - eventos `documentos.documento.atualizado` e `documentos.assinatura.atualizada`;
  - seção `DOCUMENTOS_PARA_ASSINAR`;
  - contador `documentos.paraAssinar`;
  - permissões `documentos.documento.ler` e `documentos.documento.emitir`;
  - erros `REGISTRO_PROFISSIONAL_AUSENTE` e `ASSINATURA_INDISPONIVEL`;
  - `Mensagem.referencia.tipo = DOCUMENTO` (o documento entregue pelo chat).
- **Capacidades:** `capacidades.assinatura.provedores` (vazio = não há como assinar).
- **Configuração da organização:** `OrganizacaoConfiguracao.documentos` e `OrganizacaoEdicao.documentos` (`tiposPermitidos`, `entregarPeloChat`).

### Esclarecido
- Documento sem assinatura nunca chega ao paciente: o paciente só vê `ASSINADO` e `ANULADO`.
- Atestado com CID só com `cidAutorizado: true`.

## 1.2.0-rc.1 — 2026-11-07 (F5, etapa 1)

Módulo `exames`: pedidos de exame, resultados (imagem e PDF) e revisão ([ADR-0017](../docs/adr/0017-modulo-exames.md)). Versão menor, só com adições. Organizações sem o módulo ficam idênticas.

### Incluído
- **Tag `exames`, 9 operações:**
  - pedidos (`/v1/exames/pedidos`): listar, criar, obter, `concluir` e `cancelar`;
  - resultados (`/v1/exames/resultados`): listar, enviar, obter e `revisar`.
- **Schemas:** `PedidoExame`, `ItemPedidoExame`, `ResultadoExame`, `ResultadoExameResumo` e `ConfigExames`, além dos enums `StatusPedidoExame` e `StatusResultadoExame`.
- **Parâmetros:** `PedidoExameId` e `ResultadoExameId`.
- **Catálogos:**
  - `ModuloId.exames`;
  - 6 telas `exames.*`;
  - termo `exame`;
  - ícone `flask-conical`;
  - finalidade de arquivo `EXAME`;
  - notificações `EXAME_PEDIDO`, `EXAME_RESULTADO` e `EXAME_REVISADO`;
  - eventos `exames.pedido.atualizado` e `exames.resultado.atualizado`;
  - seções `RESULTADOS_PARA_REVISAR` e `EXAMES_PENDENTES`;
  - contador `exames.resultadosParaRevisar`;
  - 4 permissões `exames.*`.
- **Capacidades:** `capacidades.upload.tiposPermitidosExame` (inclui `application/pdf`).
- **Configuração da organização:** `OrganizacaoConfiguracao.exames` e `OrganizacaoEdicao.exames` (`pacienteEnviaResultados`).

### Esclarecido
- **PDF:** só na finalidade `EXAME`. Passa por antivírus e saneamento; o recusado fica `REJEITADO` e nunca é servido. `urlMiniatura` é `null` para PDF.

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
