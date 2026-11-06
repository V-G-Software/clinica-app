# Plano de resposta a incidente de segurança

> Rascunho operacional: prazos e comunicação precisam de validação jurídica (LGPD art. 48; Resolução CD/ANPD nº 15/2024).
> A **clínica** (controladora) comunica a ANPD e os titulares. A **plataforma** (operadora) detecta, contém, investiga e entrega à clínica as informações para isso.

## Papéis **[DECIDIR] nomes e contatos**
- **Responsável técnico de plantão:** contém e investiga.
- **Encarregado da plataforma:** coordena e fala com a clínica.
- **Encarregado da clínica:** decide e faz a comunicação à ANPD e aos titulares.

## Fases
1. **Detectar e registrar** (T0). Abrir o registro do incidente: o que se viu, quando, quem viu e o request id, se houver.
2. **Conter** (meta: até 1 h). Ferramentas prontas, todas auditadas:
   - **Conta comprometida:** `pnpm incidente revogar-sessoes --org <slug> --usuario <usr_id>`. Efeito imediato: a sessão é conferida a cada requisição e o app aberto vai para o login. Depois suspenda o membro pela tela de equipe e troque a senha.
   - **Organização inteira em risco:** `pnpm incidente revogar-sessoes --org <slug>`, e se preciso `pnpm incidente suspender --org <slug>` (`--reativar` para voltar).
   - **Chave vazada:**
     - JWT: rotação (implantacao.md §6) e revogação de sessões;
     - `SEGREDO_ASSINATURA`: trocar;
     - credencial de banco ou S3: trocar no provedor e reiniciar.
3. **Avaliar o alcance** (meta: até 24 h).
   - Quem acessou o quê: `pnpm incidente acessos --org <slug> --paciente <pac_id> [--desde AAAA-MM-DD]` (CSV com usuário, ação, recurso, IP e request id).
   - Para uma conta suspeita, consulte a tabela `auditoria` filtrando por `usuario_id` (papel `clinica_backup` ou dono com o contexto da organização).
   - Logs do contêiner: correlacionar pelo `requestId`.
   - Classificar: que dados (saúde = sensível), quantos titulares, risco ou dano relevante?
4. **Comunicar.** A plataforma avisa a clínica em até 24 h depois de confirmar o incidente, com o modelo abaixo. A clínica comunica a ANPD e os titulares no prazo regulamentar (3 dias úteis; confirmar).
5. **Corrigir e aprender.** Causa raiz, correção com teste que reproduz o problema e revisão deste plano.

## Modelo de comunicação plataforma → clínica
- Data e hora da detecção e do início estimado.
- Natureza do incidente e dados afetados (categorias; saúde: sim ou não).
- Titulares afetados: número e lista, se identificáveis.
- Medidas de contenção já tomadas, com horários.
- Riscos para os titulares.
- Próximos passos e contato do responsável.

## Simulado (fazer antes do piloto e a cada 6 meses)
Roteiro em homologação, cronometrado:
1. "Senha de um profissional vazou": com um usuário de teste logado no app, rode `revogar-sessoes --usuario`. Confira que o app volta ao login em segundos e que a próxima chamada recebe 401.
2. Rode `acessos` para um paciente que esse profissional abriu e confira que a lista bate com o que foi feito.
3. `suspender` a organização de homologação: todo acesso recebe `ORGANIZACAO_SUSPENSA`. Depois, `--reativar`.
4. Preencha o modelo de comunicação com dados fictícios e mande para o encarregado da clínica (ensaio do canal).
5. Registre os tempos de cada fase e o que travou.

Verificado localmente na F3:
- **revogar:** o app aberto recebeu `sessao.encerrada` e o stream fechou em cerca de 0,5 s depois do comando; a requisição seguinte com o mesmo token recebeu 401;
- **suspender e reativar:** funcionaram;
- **relatório de acessos:** saiu com 55 registros de um paciente de exemplo.

O simulado com pessoas e o canal de comunicação ainda precisam ser feitos.
