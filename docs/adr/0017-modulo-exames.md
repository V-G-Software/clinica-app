# ADR-0017: Módulo `exames` — pedidos, resultados (imagem e PDF) e revisão

- **Status:** proposto (F5) · **Data:** 2026-11-07 · Segue a seção 10 do prompt ("Como adicionar um módulo ao contrato")

## Contexto
O produto pediu uma "central de exames". Decisões do produto (2026-11-07):
- **Pedido de exame:** registro estruturado (quais exames, preparo). A guia assinada em PDF fica para depois, junto com receita e atestado (QUESTION-031).
- **Quem envia resultados:** o paciente e a equipe.
- **PDF:** aceito, com antivírus e saneamento. É o formato real dos laboratórios.
- **Revisão:** o médico marca o resultado como revisado, com nota opcional que o paciente vê.

O contrato está em `1.1.0-rc.2`. O módulo entra como minor (`1.2.0-rc.1`), só com adições. Organizações sem `exames` ficam idênticas.

## Decisões

**Dois recursos.**
- **`PedidoExame`** (equipe cria):
  - paciente, solicitante e itens (`nome` e `orientacoes` de preparo por item, até 30);
  - orientações gerais ao paciente e observação interna;
  - status `ABERTO → CONCLUIDO | CANCELADO`.
  Concluir é ação explícita da equipe (o laboratório pode mandar resultados em partes). Cancelar exige motivo. Nada é apagado.
- **`ResultadoExame`** (paciente ou equipe envia):
  - paciente, pedido opcional (o paciente pode mandar um exame feito por conta própria), título, data de coleta opcional;
  - de 1 a 10 arquivos (imagem ou PDF) e comentário de quem enviou;
  - status `AGUARDANDO_REVISAO → REVISADO`; a revisão guarda quem revisou, quando e uma nota visível ao paciente.

**Regras (RN-EXA):**
1. **Visibilidade:** a equipe vê tudo da organização. O paciente vê só o que é dos pacientes vinculados à conta, com 404 para o resto. A observação do pedido é interna e chega `null` ao paciente.
2. **Pedido:** só quem tem `exames.pedido.criar` (profissional e gestor; não a secretaria, porque pedir exame é ato do profissional). Paciente ativo.
3. **Resultado:**
   - todo arquivo precisa estar `DISPONIVEL`, ter finalidade `EXAME` e ter sido enviado pela própria conta (arquivo de outra pessoa não pode ser anexado);
   - pedido, quando informado, precisa ser do mesmo paciente e estar `ABERTO`;
   - o paciente só envia com `pacienteEnviaResultados` ligado (padrão: ligado).
4. **Revisão:** só com `exames.resultado.revisar` (profissional e gestor). É idempotente: revisar de novo não muda autor nem data.
5. **Avisos:**
   - pedido novo avisa o paciente (`EXAME_PEDIDO`);
   - resultado novo avisa o solicitante do pedido; sem pedido, avisa os profissionais com permissão de revisar (`EXAME_RESULTADO`);
   - revisão avisa o paciente (`EXAME_REVISADO`).
   Os textos são discretos, como sempre (RN-NOT-002): nunca o nome do exame no push.
6. **Arquivos de exame:**
   - finalidade nova `EXAME`; aceita JPEG, PNG, WebP e **PDF** (só nessa finalidade, anunciado em `capacidades.upload.tiposPermitidosExame`), com o mesmo limite de tamanho da organização;
   - imagens seguem a recodificação da ADR-0015;
   - PDF passa por antivírus e saneamento (abaixo). Se for recusado, o arquivo fica `REJEITADO` com motivo e nunca é servido.

**PDF: antivírus e saneamento (backend, etapa 2).**
- **Antivírus:**
  - ClamAV pelo protocolo `INSTREAM` do `clamd`, configurado por `ANTIVIRUS_URL`;
  - **falha fechada:** sem antivírus configurado em produção, PDF é recusado (`TIPO_ARQUIVO_NAO_PERMITIDO`); com o antivírus fora do ar, o arquivo fica `PROCESSANDO` e o job tenta de novo;
  - em teste, um verificador falso que reconhece a assinatura EICAR prova o caminho de rejeição.
- **Saneamento:** o PDF é aberto e regravado sem JavaScript (`/JS`, `/JavaScript`, `/OpenAction`, `/AA`), sem anexos (`/EmbeddedFiles`), sem formulários (`/AcroForm`) e sem `/Launch` ou `/URI` nas anotações. PDF criptografado ou que não abre é REJEITADO.
- **Exibição:** o PDF é baixado por URL assinada com `Content-Disposition: attachment` e `Content-Type: application/pdf`; o app não renderiza PDF dentro da própria origem. `urlMiniatura` é `null` para PDF no MVP.

**Superfície no app.**
- **Telas:**
  - `exames.lista` (equipe: para revisar e pedidos abertos);
  - `exames.novo` (equipe: novo pedido);
  - `exames.pedido` e `exames.resultado` (detalhes);
  - `exames.meus` (paciente);
  - `exames.enviar` (enviar resultado: paciente e equipe).
- **Seções da tela inicial:** `RESULTADOS_PARA_REVISAR` (equipe) e `EXAMES_PENDENTES` (paciente: pedidos abertos).
- **Contador:** `exames.resultadosParaRevisar`.
- **Eventos:** `exames.pedido.atualizado` e `exames.resultado.atualizado`.
- **Notificações:** `EXAME_PEDIDO`, `EXAME_RESULTADO` e `EXAME_REVISADO`.
- **Permissões:**
  - `exames.exame.ler`;
  - `exames.pedido.criar`;
  - `exames.resultado.enviar`;
  - `exames.resultado.revisar`.
  O paciente recebe `ler` e `enviar` (este, se a organização permitir).
- **Termo:** `exame`. **Ícone:** `flask-conical`.
- **Configuração:** `ConfigExames.pacienteEnviaResultados`.

## Alternativas descartadas
- **Só imagens:** o paciente teria de fotografar laudos de várias páginas, com perda de legibilidade. PDF com antivírus e saneamento cobre o caso real.
- **Renderizar PDF no app (pdf.js na origem do app):** amplia a superfície de ataque. Baixar como anexo é mais simples e seguro no MVP.
- **Pedido como PDF assinado já agora:** depende da QUESTION-031 (plataforma de assinatura). O registro estruturado não impede gerar a guia depois.
- **Concluir o pedido automaticamente ao chegar o resultado:** o laboratório entrega em partes. Quem conclui é a equipe.

## Consequências
- Contrato `1.2.0-rc.1`.
- Backend (etapa 2): migração com `pedidos_exame` e `resultados_exame`, mais o pipeline de PDF com ClamAV (infraestrutura nova: um contêiner `clamav/clamav` ao lado do backend).
- Prontuário e integração com laboratório (HL7/FHIR) ficam fora do escopo.
