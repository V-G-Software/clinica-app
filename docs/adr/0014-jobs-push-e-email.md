# ADR-0014: Jobs, Web Push e e-mail no backend (F2)

- **Status:** proposto (F2) · **Data:** 2026-11-06 · Complementa a [ADR-0013](0013-backend-de-referencia.md)

## Contexto
A F2 precisa de efeitos agendados (seção 14.3: abrir, lembrar e expirar check-in, publicar orientação, ativar e concluir acompanhamento, descartar envios), de Web Push e de e-mail. A seção 14.1 sugere pg-boss. As invariantes da F1 continuam valendo: a aplicação conecta com um papel sem `BYPASSRLS`, que não é dono das tabelas e não roda DDL. Tudo que é de cliente fica atrás de RLS forçado, e push e e-mail nunca levam conteúdo clínico (RN-NOT-002).

## Decisões

**Fila de jobs própria no Postgres em vez do pg-boss.** A fila é a tabela `jobs`, reivindicada com `FOR UPDATE SKIP LOCKED` (cerca de 80 linhas em `servicos/jobs.ts`).
- **Por que não o pg-boss:**
  1. O pg-boss 10+ cria partições por fila em `createQueue` (DDL em tempo de execução) e migra o próprio schema no `start()`. Isso exigiria dar DDL ao papel da aplicação ou montar um papel e um processo à parte só para a fila.
  2. Gravar o job na mesma transação da regra exige um adaptador de `db` por chamada. Aqui sai de graça: `agendar(tx, ...)` usa a transação da requisição. Se a requisição desfaz, o job não existe.
  3. Os requisitos da 14.3 cabem numa tabela: id determinístico, reagendar, cancelar por prefixo, retry com backoff.
- **Id determinístico** (`checkin:{id}:abrir`):
  - agendar é upsert: reagendar não duplica;
  - cancelar é `DELETE ... LIKE 'acompanhamento:{id}:%'`.
- **Execução:**
  - O worker chama `reivindicar_jobs(n, '5 min')`. É `SECURITY DEFINER` do dono: o único ponto que atravessa organizações. Devolve só id, organização, tipo e dados, que contêm apenas identificadores.
  - Cada job roda em `comOrg(org)`: o efeito e o `DELETE` do job estão na mesma transação. Ou os dois acontecem, ou o job volta para a fila.
  - Em falha: backoff exponencial (30 s, 1 min, 2 min…). Depois de 5 tentativas, `falhou_em` marca o job e o erro fica em `ultimo_erro`.
  - Handlers são idempotentes: conferem o estado antes de agir (check-in já respondido, acompanhamento encerrado). A constraint `UNIQUE (organizacao_id, checkin_id, regra_id)` impede alerta duplicado mesmo com reentrega.
- **RLS:** `jobs` tem RLS **habilitado e não forçado**. A aplicação só lê e grava os jobs da própria organização; o dono (a função de reivindicação) vê todos. O teste `isolamento.test.ts` fixa que `jobs` é a única tabela nessa situação.
- **Implantação:** o worker roda no mesmo processo da API (14.1: "um contêiner com API e worker"). Várias instâncias são seguras graças ao `SKIP LOCKED`. `JOBS=0` sobe uma instância só de API.
- **Quando trocar:** com mais de ~50 jobs/s sustentados, ou se surgirem filas de prioridade ou fluxos com dependência entre jobs, migrar para o pg-boss (papel e processo próprios) ou para o BullMQ. A interface `agendar` / `cancelarPrefixo` / `registrarJob` isola os chamadores.

**Web Push com VAPID da plataforma** (responde à QUESTION-023, parte de push).
- **Chave única:** um par de chaves VAPID para todas as organizações, gerado por `pnpm chaves` e mantido num cofre. Chave por organização não ganha nada (o endpoint de push já é por navegador) e multiplica a rotação.
- **Manifesto:** a chave pública vem da configuração do servidor, não do cenário. Sem chaves, o manifesto anuncia `push.modo = NENHUM` e o app cai na central de notificações e no e-mail.
- **Envio:** `notificar()` agenda `push:{notificacaoId}` na mesma transação. Notificações agrupadas (chat) reaproveitam o id, e um push ainda pendente é substituído em vez de repetido.
- **Conteúdo:** só o texto discreto ("Há um novo alerta para revisar — {organização}"), o tipo e o destino, que contém apenas ids. O teste `push.test.ts` decifra o push (aes128gcm) e confere que não há nome de paciente nem texto clínico.
- **Respostas do serviço de push:**
  - 404 ou 410: a inscrição morreu e é apagada.
  - Chave inválida: apagada.
  - 429, 5xx ou erro de rede: o job tenta de novo.
- **Urgência:** `high` para `ALERTA_CRIADO`, `normal` no resto. TTL de 24 h.

**E-mail por SMTP genérico** (`EMAIL=smtp`, `SMTP_URL`; Mailpit em desenvolvimento).
- Serve qualquer provedor com SMTP (SES, Resend, Postmark), sem SDK. A escolha do provedor continua na QUESTION-023.
- **Não passa pela tabela de jobs.** Esses e-mails carregam código de login, link de convite ou de redefinição de senha, e o segredo não deve ficar em repouso no banco. O envio é assíncrono, com 3 tentativas em memória.
- **Risco aceito no piloto:** se o processo cair entre a requisição e o envio, o e-mail se perde. O usuário pede outro código ou convite.
- **Retorno:** o e-mail discreto de notificação (RN-NOT-003) só sai quando não há push.

**Seed da F2** (`pnpm org:criar`).
- **Mesma regra da API:** os acompanhamentos são criados por `criarAcompanhamento`, a mesma usada pela API.
- **Linha do tempo:** respostas, alertas, mensagens, arquivamento e encerramento do cenário são reproduzidos em ordem cronológica até agora. Cada passo recebe o instante do cenário.
- **Datas deslocadas:** as datas do cenário são deslocadas em dias inteiros para que hoje seja o dia de referência do mock (2026-11-08). Assim o backend real mostra o mesmo tipo de estado que o mock. `CENARIO_DESLOCAR=0` desliga.
- **Caixas limpas:** notificações e eventos gerados pelo seed são apagados, porque o histórico não é novidade para quem entra.

## Consequências
- **Conformidade completa (10 arquivos, 63 testes) nas 3 organizações contra o backend real:**
  - otorrino 63/63;
  - fisio 60, mais 3 pulados por módulo não contratado;
  - vet 63/63.
- **Frontend real:** o mesmo frontend, apontado para o backend só pelo `VITE_DIRETORIO_URL`, passa no E2E `frontend/e2e/backend-real.mjs` (login, check-in, alerta em tempo real, chat). Ambos rodam no CI.
- **Testes de jobs e concorrência:** o backend testa os jobs sem depender do relógio, vencendo jobs específicos no teste. Também testa as corridas: duas respostas ao mesmo check-in e duas conversas para o mesmo paciente.
  - O teste das respostas simultâneas falha sem o `FOR UPDATE`, conferido de propósito.
  - O teste das conversas depende do índice único parcial.
- **Limitações:**
  - Precisão dos jobs: ±`JOBS_INTERVALO_MS` (2 s), o que basta para check-ins com horário em minutos.
  - O processamento de imagem continua síncrono no `concluir`.
  - O SMTP perde e-mails em queda do processo, como descrito acima.
  - O seed não publica orientações que já passaram.
