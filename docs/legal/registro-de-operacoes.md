# Registro das operações de tratamento (LGPD art. 37): rascunho

> Rascunho a partir do sistema como ele é na F3. Revisar com o encarregado. **[DECIDIR]** marca escolhas em aberto.

## Agentes
- **Controladora:** cada clínica (organização). Define finalidade, equipe e protocolos.
- **Operadora:** a plataforma (fornecedora do app). **[DECIDIR]** razão social e CNPJ.
- **Suboperadores:** ver [subprocessadores.md](subprocessadores.md).

## Encarregado
- **Da clínica:** **[DECIDIR]** nome e canal. A clínica é controladora e é obrigada a indicar.
- **Da plataforma:** **[DECIDIR]** nome e canal. Recomendado mesmo como operadora: é o ponto de contato técnico em incidentes.
- **Onde aparece:** o canal do encarregado deve estar na política de privacidade e na tela "Privacidade" do app, pelos links da organização (`links.privacidade`).

## Operações

| # | Operação | Titulares | Dados | Finalidade | Base legal (proposta) | Retenção |
|---|---|---|---|---|---|---|
| 1 | Cadastro do paciente | pacientes; responsáveis e tutores | nome, contato, data de nascimento, campos adicionais definidos pela clínica | identificar quem é acompanhado | art. 7º V (execução de contrato) e, para dado de saúde, art. 11 II "f" (tutela da saúde por profissional ou serviço de saúde) | enquanto houver vínculo, depois conforme prontuário **[DECIDIR]** |
| 2 | Acompanhamento pós-procedimento: check-ins e alertas | pacientes | respostas de saúde (dor, sintomas, temperatura), fotos de ferida, data do procedimento | monitorar a recuperação e alertar a equipe | art. 11 II "f" | **[DECIDIR]**: se for prontuário, 20 anos (Lei 13.787/2018). O sistema não apaga dado clínico. |
| 3 | Chat com a equipe | pacientes; equipe | mensagens, fotos | comunicação assistencial | art. 11 II "f" | idem. Conversa é arquivada, nunca apagada. |
| 4 | Contas e autenticação | equipe; pacientes | e-mail, hash de senha (argon2id), segredo TOTP cifrado, sessões, IP do login | acesso seguro | art. 7º V; art. 7º IX (legítimo interesse: segurança) | sessões e tentativas expiram (24 h a 30 dias); contas até a exclusão |
| 5 | Notificações (central, push, e-mail) | todos | inscrição de push (endpoint do navegador), e-mail | avisar de check-in, mensagem e alerta | art. 7º V | inscrição removida quando o navegador a invalida |
| 6 | Trilha de auditoria | todos | quem leu ou alterou o quê, quando e de que IP | segurança, art. 46, e prestação de contas | art. 7º II (obrigação legal) e IX | **[DECIDIR]** (QUESTION-028) |
| 7 | Logs técnicos | todos | request id, rota, status, IP (sem corpo, sem token, sem conteúdo clínico) | operação e diagnóstico | art. 7º IX | **[DECIDIR]**; sugestão: 30–90 dias |

Para animais (vet), o paciente é o animal. O titular de dados pessoais é o **tutor**, que entra como responsável.

## Direitos dos titulares (art. 18)
- **Acesso:** a clínica responde; a plataforma fornece o histórico. Quem acessou os dados sai de `pnpm incidente acessos --paciente`.
- **Exclusão de conta:** existe no app (`POST /v1/me/exclusao`). O paciente perde o acesso, mas os registros clínicos ficam com a clínica, que precisa guardá-los. O app informa isso ao paciente.
- **Correção:** a equipe edita o cadastro, e a edição é auditada.
