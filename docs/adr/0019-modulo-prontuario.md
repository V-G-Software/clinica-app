# ADR-0019: Módulo `prontuario` — ficha clínica, anamnese, evolução e cópia ao paciente

- **Status:** proposto (F7) · **Data:** 2026-11-11 · Segue a seção 10 do prompt · Pontos jurídicos em aberto: [roteiro para o jurídico](../legal/prontuario-roteiro-juridico.md)

## Contexto
O produto pediu o prontuário. O app já é o sistema de origem de agenda, cirurgias, exames, receitas e atestados (F4–F6).

**Decisões do produto (2026-11-11):**
- **Escopo completo:**
  - ficha clínica (alergias, medicações em uso, problemas e diagnósticos, antecedentes);
  - anamnese;
  - evolução por atendimento;
  - linha do tempo com o que já existe nos outros módulos.
- **Assinatura:** decidir com o jurídico. Agora, registros **imutáveis com autoria**, preparados para receber assinatura ICP-Brasil depois.
- **Paciente:** não vê o prontuário no app. Recebe **cópia sob pedido**, com prazo e auditoria.

**Normas que guiam o desenho** (a confirmar no parecer):
- **CFM 1.638/2002:** conteúdo mínimo, identificação, data e hora; nada se apaga e a correção é feita por adendo.
- **CFM 1.821/2007:** prontuário eletrônico; dispensar o papel exige assinatura ICP-Brasil e o padrão NGS2.
- **Lei 13.787/2018:** guarda mínima de 20 anos.
- **LGPD:** dado sensível (art. 11), direito de acesso com cópia completa em até 15 dias (art. 19).
- **CFMV 1.321/2020:** prontuário veterinário.

## Decisões

**Recursos.**
- **Ficha clínica**, uma por paciente, versionada (If-Match):
  - alergias (substância, reação, gravidade);
  - medicações em uso;
  - problemas e diagnósticos (descrição, CID opcional, ativo ou resolvido, desde);
  - antecedentes (pessoais, familiares, hábitos).
  Toda alteração gera **uma nova versão**: a anterior nunca é sobrescrita e o histórico fica consultável.
- **Registro clínico**, do tipo `ANAMNESE`, `EVOLUCAO` ou `ADENDO`:
  - texto e, opcionalmente, um **modelo** (formulário com finalidade `PRONTUARIO`, por especialidade) com as respostas;
  - pode ser ligado a um atendimento da agenda;
  - `RASCUNHO` (editável só pelo autor) passa a `FINALIZADO` (**imutável**);
  - correção é feita por **adendo** ao registro finalizado, nunca por edição;
  - rascunho pode ser descartado; finalizado não.
- **Linha do tempo:** registros e eventos clínicos de outros módulos (consultas e cirurgias, acompanhamentos, resultados de exame, documentos), em ordem de data e só com referências. Cada item abre na tela do módulo dele.
- **Cópia ao paciente** (LGPD art. 19):
  - o paciente (ou responsável ou tutor) pede pelo app;
  - a equipe é avisada;
  - o profissional gera a cópia (PDF do prontuário completo, gerado pelo servidor) dentro do prazo (`prazoEm` = 15 dias);
  - o paciente baixa em "Meus pedidos de cópia". Recusa só com motivo.
- **Auditoria de acesso:** toda leitura de prontuário (ficha, registros, linha do tempo) é registrada. A gestão consulta quem acessou o prontuário de cada paciente.

**Regras (RN-PRO).**
1. **Quem lê:** só quem tem `prontuario.prontuario.ler`, o profissional.
   - A secretaria não lê. O sigilo profissional vale para a equipe de saúde, não para o administrativo.
   - O gestor que não é profissional também não lê; ele audita.
   - O paciente nunca acessa diretamente: 404.
2. **Quem escreve** (`prontuario.registro.escrever`):
   - o profissional edita a ficha e cria registros;
   - só o autor edita, finaliza ou descarta o próprio rascunho;
   - adendo de qualquer profissional, sempre identificado.
3. **Imutabilidade:** registro finalizado e versão anterior da ficha não mudam nem são apagados (o banco garante; nem o dono das tabelas faz UPDATE em registro finalizado).
4. **Guarda:** nada do prontuário é apagado pela API. A exclusão de conta (`/v1/me/exclusao`) remove o acesso, não o prontuário. O prazo vem do parecer: 20 anos para humanos e, para veterinária, conforme o CFMV.
5. **Cópia:**
   - pedido de cópia só do próprio paciente vinculado;
   - um pedido aberto por paciente (o repetido devolve o mesmo);
   - atender gera o PDF e avisa;
   - recusar exige motivo.
6. **Assinatura:** fora deste módulo até o parecer. A ADR futura acrescenta `assinatura` ao registro e reaproveita o fluxo de PSC da ADR-0018, só como adição ao contrato.

**Superfície no app.**
- **Telas:**
  - `prontuario.paciente`: ficha, registros e linha do tempo;
  - `prontuario.registro`: novo ou detalhe;
  - `prontuario.copias`: equipe;
  - `prontuario.minhas-copias`: paciente.
- **Seção:** `COPIAS_PRONTUARIO_PENDENTES`. **Contador:** `prontuario.copiasPendentes`.
- **Eventos:** `prontuario.ficha.atualizada`, `prontuario.registro.atualizado`, `prontuario.copia.atualizada`.
- **Notificações:** `COPIA_PRONTUARIO_SOLICITADA` e `COPIA_PRONTUARIO_DISPONIVEL`. Textos discretos; nunca conteúdo clínico.
- **Permissões:**
  - `prontuario.prontuario.ler`, `prontuario.registro.escrever` e `prontuario.copia.atender` (profissional);
  - `prontuario.acesso.auditar` (gestor);
  - `prontuario.copia.solicitar` (paciente).
- **Formulário:** finalidade nova `PRONTUARIO`, para os modelos de anamnese e evolução.
- **Finalidade de arquivo:** `PRONTUARIO`, para o PDF da cópia (só o servidor cria).
- **Ícone:** `notebook-pen`.

## Alternativas descartadas
- **Paciente vendo o prontuário no app:** expõe anotações clínicas sem contexto e muda como o médico escreve. A cópia sob pedido atende à LGPD.
- **Edição de registro finalizado com histórico:** a norma pede correção por adendo, rastreável e visível. O adendo é mais simples de auditar.
- **Copiar exames, documentos e agenda para dentro do prontuário:** dados duplicados divergem. A linha do tempo referencia a fonte.

## Consequências
- O PDF da cópia contém o prontuário inteiro: geração no servidor e entrega só por URL assinada e curta.
- O volume de auditoria cresce com o uso (uma linha por leitura). A política de retenção do log de acesso entra no parecer.
- Sem a assinatura ICP, o prontuário digital não dispensa o papel (CFM 1.821/2007). Até o parecer, o app avisa que a clínica deve seguir o procedimento dela para o prontuário oficial.
