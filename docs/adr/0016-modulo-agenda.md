# ADR-0016: Módulo `agenda` — consultas, cirurgias e autoagendamento

- **Status:** proposto (F4) · **Data:** 2026-11-06 · Segue a seção 10 do prompt ("Como adicionar um módulo ao contrato")

## Contexto
O produto pediu agenda e cirurgias "marcadas, realizadas e canceladas". Pediu também que a equipe marque e o paciente possa marcar sozinho. O app é o sistema de origem.

O contrato está em `1.0.0-rc.3`. O módulo precisa entrar sem quebrar nada:
- nenhum campo existente muda;
- organizações sem `agenda` continuam idênticas.

## Decisões

**Um módulo, dois tipos de atendimento.** Consulta e cirurgia são o mesmo recurso, `Agendamento`, e diferem pela `categoria` do serviço.

| Categoria | Exemplos | O que muda |
|---|---|---|
| `CONSULTA` | consulta, retorno, avaliação | pode ser autoagendável |
| `PROCEDIMENTO` | cirurgia, procedimento em consultório | nunca é autoagendável; tem `local` (ex.: hospital); na etapa 4, liga ao acompanhamento pós-operatório |

O vocabulário vem dos termos que já existem: `procedimento` ("cirurgia" na otorrino) e o novo `consulta`.

**Recursos novos:**
- **`Servico` (tipo de atendimento):**
  - campos: nome, categoria, duração e `autoagendavel`;
  - profissionais que atendem e orientações de preparo, mostradas ao paciente (ex.: "jejum de 8 h");
  - versão por `ETag`, como os outros recursos.
- **`Grade`:** horários semanais de cada profissional (dia, início, fim e, opcionalmente, quais serviços).
- **`Bloqueio`:** férias, congresso ou feriado, de um profissional ou da organização inteira.
- **`Agendamento`:**
  - paciente, profissional, serviço, `inicio` e `fim` (UTC) e status;
  - origem (`EQUIPE` ou `PACIENTE`), local e observação;
  - histórico de ações e `acoesPermitidas`.

**Estados.** `AGENDADO → CONFIRMADO → REALIZADO | FALTOU`; `CANCELADO` vale a partir de `AGENDADO` ou `CONFIRMADO`.
- Remarcar volta para `AGENDADO` e grava a mudança no histórico.
- Nada é apagado.

**Regras (RN-AGE):**
1. **Sem sobreposição:** dois agendamentos ativos (não cancelados) do mesmo profissional não se sobrepõem. Resposta: 409 `HORARIO_INDISPONIVEL`, código de erro novo. A exceção é o **encaixe**: só a equipe pode marcar, e precisa pedir explicitamente (`encaixe: true`). No backend, a garantia é do banco: `EXCLUDE USING gist (profissional WITH =, periodo WITH &&) WHERE (status <> 'CANCELADO' AND NOT encaixe)`. Duas requisições simultâneas não passam.
2. **Paciente marca** só em serviço autoagendável e só com o autoagendamento ligado na organização. O horário precisa estar dentro da grade, fora de bloqueio, com a antecedência mínima e dentro da janela de dias. Os horários livres vêm de `GET /v1/agenda/horarios`, já descontados os ocupados. Não há como pedir "qualquer horário".
3. **Equipe marca** qualquer serviço, inclusive fora da grade. Uma secretária marcando uma cirurgia num sábado não pode ser bloqueada pelo sistema.
4. **Paciente cancela** até `cancelamentoAteHoras` antes do início. Depois disso, 422 com orientação para falar com a clínica pelo chat.
5. **Lembrete:** job determinístico `agendamento:{id}:lembrete`, `lembreteHorasAntes` antes do início. Notificação `AGENDAMENTO_LEMBRETE`, com o pedido de confirmação. Remarcar reagenda o job; cancelar remove.
6. **Realizar e marcar falta:** só a equipe, e só depois do início.
7. **Notificações:** mudança feita pela equipe avisa o paciente; mudança feita pelo paciente avisa o profissional. O texto é discreto, como sempre (RN-NOT-002). Push diz só "Sua consulta foi confirmada — {organização}", sem serviço nem horário.
8. **Procedimento ↔ acompanhamento (RN-AGE-008):** ver Consequências (etapa 4).

**Datas.** `inicio` e `fim` trafegam em UTC (ISO-8601). Grade e bloqueios são locais, no fuso da organização (`HH:mm` e datas), pelas mesmas funções de `@clinica/dominio/datas` usadas no acompanhamento (ADR-0009). Horário de verão não existe mais no Brasil, mas o cálculo não depende disso.

**Permissões novas:**
- `agenda.agendamento.ler`;
- `agenda.agendamento.criar`;
- `agenda.agendamento.gerenciar` (confirmar, cancelar, remarcar, realizar, falta);
- `agenda.configuracao.gerenciar` (serviços, grades, bloqueios).

O paciente recebe `ler` e `criar`. O backend ainda confere o autoagendamento e só deixa o paciente confirmar ou cancelar o que é dele.

**Superfície no app.**
- **Telas:** `agenda.lista` (equipe: dia e semana), `agenda.novo`, `agenda.detalhe`, `agenda.servicos`, `agenda.grade`, `agenda.meus` (paciente), `agenda.marcar` (paciente).
- **Seções da tela inicial:** `PROXIMA_CONSULTA` (paciente) e `AGENDA_DO_DIA` (equipe).
- **Eventos:** `agenda.agendamento.criado` e `agenda.agendamento.atualizado`.
- **Notificações:** `AGENDAMENTO_CRIADO`, `AGENDAMENTO_ALTERADO` e `AGENDAMENTO_LEMBRETE`.

**Configuração do módulo** (`ConfigAgenda`, editável pelo gestor):

| Campo | O que controla | Padrão |
|---|---|---|
| `autoagendamento` | paciente pode marcar sozinho | — |
| `antecedenciaMinimaHoras` | antecedência mínima para o paciente marcar | 2 |
| `janelaDias` | até quantos dias à frente o paciente vê horários | 30 |
| `cancelamentoAteHoras` | prazo para o paciente cancelar | 24 |
| `lembreteHorasAntes` | quando sai o lembrete | 24 |
| `intervaloMinutos` | grade de horários oferecidos | 15 |

## Alternativas descartadas
- **Recursos separados para consulta e cirurgia:** duplicariam estados, regras, telas e testes por uma diferença de categoria.
- **Checagem de sobreposição só na aplicação** (`SELECT` antes do `INSERT`): sofre corrida com duas requisições simultâneas. Só a constraint ou um lock serializável resolvem, e a constraint é declarativa.
- **Pedido de horário pelo paciente com aprovação da equipe:** mais um estado e mais uma fila para a secretaria. Fica como opção futura de configuração, se uma clínica pedir.

## Consequências
- **Implementado no backend (etapa 2):**
  - migração `0005_agenda.sql`;
  - `servicos/agenda.ts` (regras, horários livres, job `agenda.lembrete`);
  - `modulos/agenda.ts` (handlers e seções da tela inicial).
  - A violação da constraint de exclusão (SQLSTATE `23P01`) vira 409 `HORARIO_INDISPONIVEL`.
  - `testes/agenda.test.ts` prova a concorrência: de três marcações simultâneas, só uma passa. Prova também o ciclo do lembrete e o seed.
- **Implementado no frontend (etapa 3):**
  - 7 telas em `src/telas/agenda/`, mais o componente `EscolherHorario`;
  - seções `PROXIMA_CONSULTA` e `AGENDA_DO_DIA` na tela inicial;
  - bloco da agenda nas configurações;
  - invalidação por `agenda.agendamento.*`.
  - Conversão data/hora local → UTC em `telas/agenda/util.ts`, no fuso da organização e com duas passadas por causa do horário de verão. Nunca no fuso do aparelho.
  - Botões só pelo `acoesPermitidas`: o prazo de cancelamento do paciente é decidido pelo backend, e o app só orienta a falar com a equipe.
- **Etapa 4 (RN-AGE-008, QUESTION-032):** procedimento ligado ao acompanhamento pós-procedimento.
  - Ao marcar, é **opcional** iniciar o acompanhamento, com o protocolo sugerido pelo serviço. Ele nasce `AGENDADO` no dia local do procedimento.
  - A ligação vai nos dois sentidos: `Agendamento.acompanhamentoId` e `Acompanhamento.agendamentoId`.
  - **Remarcar para outro dia encerra o atual e cria um novo**, com o mesmo protocolo e a mesma equipe; nada é apagado. Cancelar ou registrar falta encerra, com o motivo.
  - Tudo na mesma transação: se o acompanhamento falha, o agendamento não fica pela metade.
  - Migração `0006`: FKs `DEFERRABLE INITIALLY DEFERRED`, porque a ligação é circular. Durante o `ADD CONSTRAINT`, o `FORCE RLS` sai por um instante para o dono validar todas as linhas.
  - O encerramento é um efeito do sistema: vale mesmo quando quem cancela a cirurgia não tem a permissão de encerrar acompanhamento (a secretária, por exemplo). O motivo e a autoria ficam registrados.
- Contrato `1.1.0-rc.1`, minor e só com adições, conforme a regra 4.2. A etapa 4 levou a `1.1.0-rc.2`, também só com adições.
- O backend precisa da extensão `btree_gist`, que existe no Postgres gerenciado (RDS, Cloud SQL, Neon).
- Integração com ERP e agenda externa (Google Calendar, ERP GeneXus): fora do escopo; vira módulo de integração depois.
