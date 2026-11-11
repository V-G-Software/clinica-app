# ADR-0018: Módulo `documentos` — receita e atestado assinados (ICP-Brasil em nuvem) e entregues pelo chat

- **Status:** proposto (F6) · **Data:** 2026-11-11 · Fecha a QUESTION-031 · Segue a seção 10 do prompt ("Como adicionar um módulo ao contrato")

## Contexto
O produto pediu receita e atestado automáticos: "o médico receita e envia para o paciente pelo próprio chat do app".

Para ter validade, o documento médico digital precisa de assinatura com certificado **ICP-Brasil** (Lei 14.063/2020, art. 13; Resolução CFM 2.299/2021), verificável por qualquer pessoa no validador do ITI (`validar.iti.gov.br`). Um PDF sem essa assinatura não serve para a farmácia nem para o empregador.

**Comparativo (QUESTION-031, 2026-11-11):**

| | Integrar Memed / Mevo / iClinic Rx | Assinatura própria (PSC em nuvem) |
|---|---|---|
| API | Nenhuma das três tem documentação pública: integração por contrato de parceria | API padronizada pelo ITI para PSC (DOC-ICP-17.01), igual em todos os provedores credenciados |
| Burocracia | Contrato comercial, cadastro do médico na plataforma, contrato de tratamento de dados (LGPD): o paciente e a prescrição vão para o parceiro | Cadastro do app em cada PSC (certificado SSL ICP-Brasil do servidor). Sem contrato comercial |
| Médico | Precisa de conta na plataforma (e do certificado dela) | Precisa de certificado ICP-Brasil em nuvem (BirdID, VIDaaS, SafeID, etc.), que a maioria já usa para prescrever |
| Cobertura | Base de medicamentos, controlados, integração com farmácias | Receita simples e atestado. Controlados ficam de fora |
| Dados | Saem da organização | Ficam na organização |

**Decisão do produto (2026-11-11):** assinatura própria com certificado em nuvem.

## Decisões

**Escopo.**
- **Receita simples:** medicamentos com posologia e quantidade, mais orientações.
- **Atestado:** afastamento (N dias a partir de uma data) ou comparecimento (data e horário).
- **Fora do MVP:**
  - receita de controle especial e notificações de receita (Portaria SVS/MS 344/1998: talonário numerado da vigilância, retenção);
  - receita antimicrobiana;
  - laudos;
  - guia de pedido de exame (QUESTION-038; entra depois neste mesmo módulo, como um tipo novo).

**Recurso `Documento`.**
- **Conteúdo:** tipo `RECEITA | ATESTADO`, paciente, emissor (com registro no conselho) e o conteúdo estruturado do tipo.
- **Status:** `RASCUNHO → ASSINANDO → ASSINADO`, além de `DESCARTADO` (rascunho) e `ANULADO` (assinado, com motivo).
- **Nada é apagado.** Documento assinado não muda: errou, anula e emite outro.
- **PDF gerado pelo servidor**, nunca pelo aparelho, para que o que se assina seja exatamente o que se guarda. Ele contém:
  - cabeçalho da organização;
  - emissor (nome, conselho, número e UF);
  - paciente (no veterinário, o animal e o tutor);
  - data e local;
  - o conteúdo;
  - código e QR de validação.

**Assinatura (PSC em nuvem, padrão ITI).**
- **Sessão de assinatura** (`/v1/documentos/assinaturas`):
  - o médico escolhe o provedor (`capacidades.assinatura.provedores`) e de 1 a 10 rascunhos próprios. Um atestado e uma receita da mesma consulta saem com uma só autorização;
  - a resposta traz `urlAutorizacao`: o médico autoriza no app do provedor (OAuth 2.0 *authorization code* com PKCE, escopo de assinatura);
  - o provedor redireciona para o retorno público do backend (`/v1/documentos/assinaturas/retorno`). O backend troca o código, envia ao PSC só o **hash** de cada PDF e recebe a assinatura (CMS), que embute como **PAdES**. Por fim, redireciona o navegador para o `retornoUrl` do app;
  - o PDF nunca sai da organização; o PSC vê apenas hashes.
- **`retornoUrl`:** só origens do frontend da organização (`dominios`; `localhost` fora de produção). Evita *open redirect*.
- **`state`:** aleatório e de uso único, ligado à sessão. A sessão expira em 10 minutos. Recusa ou expiração → sessão `FALHOU`/`EXPIRADA` e os documentos voltam a `RASCUNHO` com o motivo.
- **Falha fechada:** sem provedor configurado no servidor, `capacidades.assinatura.provedores` vem vazio e não há como assinar (`ASSINATURA_INDISPONIVEL`). Documento sem assinatura **nunca** é entregue ao paciente.
- **Em teste:** o mock e o backend têm um PSC simulado (`teste`), recusado em produção como o `ANTIVIRUS_URL=teste`. O PDF assinado por ele não é ICP-Brasil e diz isso no rodapé.

**Entrega.**
- Ao assinar, o documento aparece em "Meus documentos".
- **Pelo chat:** com o módulo `chat` e `ConfigDocumentos.entregarPeloChat` (padrão: ligado), o documento também chega como mensagem da conversa do paciente, criada se não existir. A mensagem é do tipo `ANEXO`, com o PDF e `referencia.tipo = DOCUMENTO`, e tem como autor o emissor. O aviso ao paciente é o da própria mensagem (`CHAT_MENSAGEM`), sem notificação duplicada.
- **Sem o chat** (ou com a entrega pelo chat desligada), o paciente recebe `DOCUMENTO_DISPONIVEL`.
- O texto da notificação é discreto, como sempre (RN-NOT-002): "Você recebeu um documento", nunca o nome do medicamento.

**Validação pública.** `GET /v1/publico/documentos/{codigo}`:
- **Código:** aleatório de 16 caracteres, impresso no PDF e no QR.
- **Responde:**
  - tipo;
  - emissor (nome e registro);
  - **iniciais** do paciente (minimização, LGPD);
  - data da assinatura;
  - situação `VALIDO | ANULADO`;
  - SHA-256 do PDF assinado, para quem recebeu o arquivo conferir que é o mesmo.
- **Não responde** conteúdo clínico.
- Tem limite de requisições.
- A validade jurídica continua sendo a do validador do ITI. A nossa página só diz se o documento foi anulado.

**Regras (RN-DOC).**
1. **Visibilidade:**
   - a equipe com `documentos.documento.ler` vê os documentos da organização;
   - o paciente vê só `ASSINADO` e `ANULADO` dos pacientes vinculados; o resto responde 404.
   - A secretaria não tem acesso, porque receita revela tratamento.
2. **Emitir** (`documentos.documento.emitir`, de profissional e gestor):
   - exige registro profissional cadastrado (`profissional.conselho`, `numero`, `uf`), senão `REGISTRO_PROFISSIONAL_AUSENTE`;
   - só o emissor edita, descarta ou assina o próprio rascunho.
3. **Atestado com CID:** só com `cidAutorizado: true`. A Resolução CFM 1.658/2002 exige autorização expressa do paciente. Sem ela, o CID é recusado (422).
4. **Anular:** emissor ou gestor, com motivo. O paciente é avisado (`DOCUMENTO_ANULADO`) e a validação pública passa a `ANULADO`.
5. **Tipos permitidos por organização** (`ConfigDocumentos.tiposPermitidos`). Por exemplo, a fisioterapia não emite receita.

**Superfície no app.**
- **Telas:**
  - `documentos.lista` (equipe: rascunhos para assinar e emitidos);
  - `documentos.novo` (`?pacienteId=&tipo=`);
  - `documentos.detalhe`;
  - `documentos.meus` (paciente).
- **Seção:** `DOCUMENTOS_PARA_ASSINAR` (rascunhos do próprio emissor). **Contador:** `documentos.paraAssinar`.
- **Eventos:** `documentos.documento.atualizado` e `documentos.assinatura.atualizada`.
- **Notificações:** `DOCUMENTO_DISPONIVEL` e `DOCUMENTO_ANULADO`.
- **Permissões:** `documentos.documento.ler` e `documentos.documento.emitir`. O paciente recebe `ler`.
- **Finalidade de arquivo:** `DOCUMENTO` (só o servidor cria; enviar por `/v1/arquivos` é recusado).
- **Ícone:** `file-pen-line`.
- **Erros:** `REGISTRO_PROFISSIONAL_AUSENTE` e `ASSINATURA_INDISPONIVEL`.

## Alternativas descartadas
- **Integrar Memed ou outra plataforma:** sem API pública; exige contrato e envia dados do paciente para terceiros (ver comparativo). Fica possível no futuro como outro "provedor" do mesmo fluxo, sobretudo para controlados.
- **Assinar no aparelho (certificado A1/A3 local):** o celular não acessa token A3, e A1 em navegador expõe a chave. O certificado em nuvem é o caminho que os médicos já usam.
- **PDF sem assinatura para o médico assinar fora (assinador do ITI) e anexar:** manual, sujeito a anexar o arquivo errado, e o paciente poderia receber documento sem validade.
- **Gerar o PDF no aparelho:** o que se assina tem de ser o que o servidor guarda e entrega.

## Consequências
- **Para usar em produção, cada PSC exige o cadastro do app** (e um certificado SSL ICP-Brasil do servidor). Sem cadastro, aquele provedor não aparece.
- **O médico precisa de certificado em nuvem ativo.** O app explica isso quando a lista de provedores vem vazia ou quando o provedor recusa.
- **Controlados continuam fora do app.** A tela de receita avisa.
- **Textos legais** (rodapé do PDF, aviso sobre CID) vão para revisão jurídica junto com `docs/legal/textos-para-revisao.md`.
