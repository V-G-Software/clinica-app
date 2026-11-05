# Dúvidas em aberto

Decisões assumidas na F0 que precisam de confirmação. As decisões de negócio da seção 19 do prompt continuam valendo; aqui ficam as que surgiram na implementação. Formato: pergunta · o que foi assumido · impacto se mudar.

| # | Pergunta | Assumido na F0 | Impacto se mudar |
|---|---|---|---|
| QUESTION-001 | Check-in já vencido ao criar acompanhamento retroativo deve gerar alerta `CHECKIN_EXPIRADO`? | Não: nasce `EXPIRADO` sem alerta nem notificação (ADR-0009). | Regra no backend; contrato não muda. |
| QUESTION-002 | Orientações com horário já passado na criação retroativa são publicadas na conversa? | Não. | Idem. |
| QUESTION-003 | Como a suíte faz login por código em backend real (não lê e-mail)? | Ambiente de teste aceita um código fixo configurável (`CONF_CODIGO_EMAIL`). Alternativa: caixa de e-mail de teste com API. | Só a suíte. |
| QUESTION-004 | Status HTTP exato de `CODIGO_INVALIDO` (401 ou 422)? | Mock usa 422; a suíte aceita 401/422 e confere o `codigo`. Proposta: fixar a tabela código→status no contrato antes de `1.0.0`. | Contrato (rc ainda permite). |
| QUESTION-005 | [DECISÃO 3] O profissional pode desligar a visão de check-ins/alertas da secretária? | Secretária vê por padrão; não há chave de configuração no contrato ainda. | Aditivo: `acompanhamento.config.secretariaVeCheckins`. |
| QUESTION-006 | Quando o paciente inicia conversa (`pacientePodeIniciar`), quem da equipe entra? | Todos os `PROFISSIONAL` e `SECRETARIA` ativos. | Regra no backend; talvez `chat.config.participantesPadrao`. |
| QUESTION-007 | `POST /v1/conversas` com conversa ativa existente e quem chama não participa? | Equipe com `chat.conversa.gerenciar` entra na conversa e recebe 200 ("clica no paciente e cai na conversa"). | Regra no backend. |
| QUESTION-008 | A observação do acompanhamento é interna? | Sim: o paciente recebe `observacao: null`. | Se não for, só o backend muda. |
| QUESTION-009 | Notificações de chat na central: uma por mensagem ou agrupadas? | Agrupadas por conversa enquanto não lidas. | Só backend. |
| QUESTION-010 | Exclusão de conta pelo paciente: um novo convite reativa a conta? | Não tratado (conta fica `DESLIGADO`). | Definir antes da F1. |
| QUESTION-011 | `MODULO_NAO_CONTRATADO` devolve 404 ou 403? | 404 (não revela o que não está contratado). | Contrato (rc). |
| QUESTION-012 | URI base do `type` dos erros (`https://{{DOMINIO}}/erros/...`). | Mock usa `https://exemplo.com.br/erros`. | Depende da decisão 1 (nome e domínio). |
| QUESTION-013 | `Membro.id` é igual ao `usuarioId`? | Sim. | Simplifica o frontend; mudar seria quebra. |
| QUESTION-014 | Termos de uso mudaram: aceite no próximo login (`ACEITAR_TERMOS`) ou também durante a sessão? | Só no próximo login. Proposta: evento `sessao.manifesto.alterado` + etapa no próximo `renovar`. | Aditivo. |
| QUESTION-015 | Retenção de conversas, check-ins e fotos (decisão 7, 20 anos se prontuário). | Nada é apagado; `POST /v1/me/exclusao` só remove o acesso. | Jurídico. |
| QUESTION-016 | Título da conversa para conta com mais de um paciente vinculado (tutora com dois pets): RN-CHA-003 manda mostrar o nome da organização, e as duas conversas ficam iguais. | O frontend mostra o nome do paciente quando há mais de um vinculado. Proposta: o backend devolve `titulo` com o nome do paciente nesse caso. | Regra no backend; frontend já trata. |
| QUESTION-017 | Na tela de login, antes do manifesto, não há `termos` ("Sou paciente" vs "Sou tutor"). | Texto neutro "Sou paciente ou responsável". Proposta: `termos` opcional na configuração pública (aditivo). | Aditivo no contrato. |
| QUESTION-018 | Padrão de `frontend.versaoMinima` do mock era `1.0.0` e bloqueava o build `0.1.0`. | Mock passou a `0.1.0` (cenário pode subir com `versaoMinimaFrontend`). Definir a política de versão do frontend antes do piloto. | Só operação. |
| QUESTION-019 | Ao encerrar (ou concluir) um acompanhamento, os alertas ainda abertos continuam abertos? | Continuam (nada é resolvido automaticamente). No cenário vet, a Mel encerrada mantém 3 alertas abertos no início da equipe. Proposta: resolver automaticamente com nota "Acompanhamento encerrado", registrando quem encerrou. | Regra no backend; contrato não muda. |
| QUESTION-020 | Preferência de densidade `COMPACTA` (equipe) | **Resolvida na FE3**: a interface da equipe fica mais densa; paciente sempre confortável. | — |
| QUESTION-021 | Ferramenta de registro de erros do frontend e região dos dados ([DECISÃO 4] do prompt do frontend) | Adaptador neutro: sem `VITE_ERROS_URL`, nada sai do aparelho; com ela, evento já limpo vai por `sendBeacon`. Source maps gerados, mas não publicados (`hidden`), para subir só na ferramenta escolhida. | Configuração. |
| QUESTION-022 | Fotos devem ser **recodificadas** (decodificar e gerar de novo) além de ter os metadados removidos? | F1: remove segmentos de metadados (JPEG APP1/APP13/COM, PNG tEXt/iTXt/zTXt/eXIf, WebP EXIF/XMP) sem recodificar. Recodificar (ex.: `sharp`) elimina também dado escondido nos pixels/trailers e normaliza orientação, ao custo de CPU e de uma dependência nativa. | Só no backend; nenhum efeito no contrato. |
| QUESTION-023 | Provedor de e-mail e envio de Web Push (chaves VAPID por organização ou da plataforma?) | F1 grava a notificação e o evento; push fica “enfileirado” e e-mail só em `log`/`arquivo`. Proposta F2: VAPID da plataforma, fila pg-boss, SMTP genérico. | Configuração e operação. |
| QUESTION-024 | Como a suíte de conformidade roda contra homologação/produção sem código fixo? | `MODO_TESTE_*` só fora de produção (o backend se recusa a subir com eles em `NODE_ENV=production`). Para homologação: caixa de e-mail de teste via API do provedor. | Só na suíte. |
| QUESTION-025 | Hospedagem do banco (região, backup, PITR) e quem administra os papéis `clinica_dono`/`clinica_app` | Gerenciado (RDS/Cloud SQL/Neon) com PITR; papéis criados por `backend/scripts/papeis.sql`. | Operação; LGPD (região dos dados). |

## Adições ao contrato em relação ao prompt (registradas no CHANGELOG)

`GET /v1/equipe/membros/{membroId}` (necessário para obter `ETag` antes do `PATCH`), `Convite.token`, `Saude.agora`, `autenticacao.termosVersao`, `RespostaEtapa.termos`/`emailMascarado`, `ultimoEventoId` em `GET /v1/eventos`, `temMais` na lista de mensagens, `Paciente.conversaAtivaId`, `Checkin.anexos`, `Secao.titulo`, `StatusMembro.CONVIDADO`, `304` em configuração pública e manifesto.
