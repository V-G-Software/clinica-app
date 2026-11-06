# Relatório de Impacto à Proteção de Dados (RIPD): versão inicial

> Rascunho técnico (LGPD art. 38). A avaliação de probabilidade e impacto e a conclusão são do encarregado e da clínica controladora.

## 1. Descrição do tratamento
Acompanhamento pós-procedimento à distância: check-ins diários respondidos pelo paciente (escalas, sintomas, fotos), alertas automáticos para a equipe por regras do protocolo e chat paciente-equipe. São dados pessoais sensíveis de saúde (art. 5º II, art. 11), inclusive de crianças (responsáveis respondem) e de tutores de animais.

## 2. Necessidade e proporcionalidade
- **Dados coletados:** o formulário de cada protocolo define exatamente o que é perguntado. Nada é coletado fora dele: o backend recusa campo desconhecido.
- **Fotos:** só quando o protocolo pede. Metadados como GPS e câmera são removidos por recodificação (ADR-0015).
- **Notificações fora do app** (push e e-mail) não levam conteúdo clínico nem nome de paciente.
- **Sem cruzamento entre clínicas:** cada organização é isolada (ADR-0007).

## 3. Riscos e medidas

| Risco | Medida implementada | Evidência | Risco residual |
|---|---|---|---|
| Uma clínica ver dados de outra | RLS forçado em todas as tabelas; o papel da aplicação não ignora RLS; organização vem do token | `isolamento.test.ts` e conformidade (404 para recurso alheio) no CI | baixo |
| Acesso indevido por conta comprometida da equipe | senha argon2id; MFA TOTP obrigatório para a equipe; código não reutilizável; limite de tentativas; sessão revogável na hora | testes da suíte 02-auth; `pnpm incidente revogar-sessoes` | médio: phishing de TOTP |
| Paciente ver dados de outro paciente | visibilidade por vínculo conta↔paciente; 404 sem revelar existência | conformidade 04, 05 e 07 (isolamento entre pacientes) | baixo |
| Vazamento por foto (localização, conteúdo escondido) | recodificação completa, limite de pixels | `imagem.test.ts` | baixo |
| Vazamento por notificação na tela bloqueada | push e e-mail discretos, payload cifrado | `push.test.ts` decifra e confere | baixo |
| Perda de dados | PITR do provedor; ensaio de restauração mensal | `scripts/ensaio-restauracao.sh` | depende do provedor (QUESTION-025) |
| Indisponibilidade em momento crítico (alerta não visto) | aviso de urgência fixo na conversa; o app não é canal de emergência (texto a revisar) | `textos-para-revisao.md` | **médio**: alerta é informativo, não substitui contato (RN-ACO-005) |
| Uso indevido interno (equipe consultando sem necessidade) | trilha de auditoria de leitura e alteração, só acréscimo | `pnpm incidente acessos` | médio: depende de revisão periódica pela clínica |
| Abuso ou ataque automatizado | limites por IP, conta e organização; cabeçalhos de segurança; CORS restrito | `seguranca.test.ts` | baixo-médio (limite por instância) |
| Segredos expostos | segredos fora do repositório; o servidor não sobe em produção sem chaves; rotação de JWT sem derrubar sessões | `config.ts`, `jwt.test.ts` | baixo |

## 4. Pendências para concluir o RIPD
- **[DECIDIR]** Tempo de guarda: é prontuário? (decisão 7; Lei 13.787/2018).
- **[DECIDIR]** Hospedagem e região (QUESTION-025); transferência internacional, se houver.
- **[DECIDIR]** Retenção de logs e da auditoria (QUESTION-028).
- **[DECIDIR]** Criptografia por campo com chave por organização (decisão 8: depois do piloto).
- Revisão dos textos de urgência e de alerta por profissional e advogado.
