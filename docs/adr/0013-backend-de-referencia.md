# ADR-0013 — Backend de referência (F1)

- **Status:** aceito (F1) · **Data:** 2026-11-05

## Contexto
O mesmo código serve todas as organizações por configuração (seção 19). O contrato (`contrato/openapi.yaml`) é a fonte da verdade; o mock e a suíte de conformidade já existem. O backend precisa passar na mesma suíte e ser seguro por construção num banco compartilhado.

## Decisões

**Stack.** Node 22 + Fastify 5 + `pg` com SQL escrito à mão. Sem ORM: as consultas são poucas, o isolamento depende de detalhes de transação (`set_config(..., true)`) que ORMs escondem, e RLS exige saber exatamente qual SQL sai. Validação de entrada e saída com o mesmo validador do mock (`@clinica/contrato-validador`) — o contrato não é reescrito em código. Regras puras compartilhadas com o frontend em `@clinica/dominio` (permissões por perfil, navegação, termos, formulários).

**Isolamento (multi-organização num banco).**
- RLS `ENABLE` + `FORCE` em toda tabela de cliente, política `organizacao_id = org_atual()` em `USING` e `WITH CHECK`.
- `org_atual()` usa `current_setting` **sem** `missing_ok`: conexão sem contexto dá erro, não “tudo”. Depois de um `set_config` local, a variável volta a `''` e nada casa.
- A aplicação conecta como `clinica_app` (`NOBYPASSRLS`, não dona das tabelas); migrations como `clinica_dono`. `auditoria` só tem `SELECT, INSERT`.
- Uma transação por requisição (`comOrg`), com o contexto local à transação — nunca vaza entre conexões do pool.
- A organização vem da URL (`/o/{slug}`); o `org` do token precisa ser igual, senão 401. Recurso de outra organização é 404 idêntico ao inexistente.
- Verificado em `backend/testes/isolamento.test.ts` (banco e HTTP) e pela suíte de conformidade.

**Autenticação.** Senha com argon2id (parâmetros mínimos OWASP). Token de acesso JWT EdDSA (Ed25519), 15 min, claims `org, ses, sub, perfil, exp` (ADR-0008); sessão conferida no banco a cada requisição (revogação imediata). Renovação por cookie `HttpOnly; SameSite=Strict; Path=/o/{slug}/v1/auth` com rotação e detecção de reuso (reuso revoga a família). Segredo TOTP cifrado com AES-256-GCM; **um código TOTP não vale duas vezes** (`mfa_ultima_janela`). Tokens de renovação, convite, troca de senha, códigos por e-mail e de recuperação guardados só como hash.

**Contagem de tentativas fora da transação da requisição.** Tentativas de login/código são gravadas numa transação própria (autônoma). Antes, um erro 401 desfazia a transação e apagava a tentativa — o rate limit nunca disparava.

**Idempotência.** `Idempotency-Key` serializada por `pg_advisory_xact_lock(hash(org, chave))`, resposta guardada 24 h; mesma chave com corpo diferente é 422.

**Tempo real.** Eventos gravados em `eventos` (seq monotônico) + `pg_notify`; cada instância escuta e repassa aos SSE conectados. `Last-Event-ID` replays do banco; cursor antigo demais é `CURSOR_EXPIRADO` (o frontend refaz as consultas). Funciona com várias instâncias sem Redis.

**Arquivos.** Adaptador de storage: `local` (disco + URLs assinadas com HMAC servidas pelo próprio backend — dev/CI e instalações pequenas) ou `s3` (URLs pré-assinadas; S3, MinIO, R2). Envio direto ao storage; `concluir` confere tipo pelos bytes, remove metadados (EXIF/XMP/IPTC/comentários) e move para a chave final.

**Banco.** PostgreSQL 16+ (dev local 16, CI 17). Migrations SQL numeradas, aplicadas em transação e registradas em `schema_migracoes`.

## Consequências e limitações conhecidas
- **Uma chave JWT só, sem `kid`.** Rotacionar invalida os tokens de acesso em uso (no máximo 15 min; o frontend renova pelo cookie). Para rotação sem atrito: `kid` + conjunto de chaves públicas — aditivo, sem mudar o contrato.
- **Limpeza de metadados não recodifica a imagem** (QUESTION-022).
- **Processamento de arquivo síncrono** no `concluir`; com imagens grandes e muito tráfego, vira job (ADR-0014).
- `NOTIFY` aceita até 8000 bytes e, acima disso, **desfaz a transação da requisição**. Eventos até ~7 kB vão inteiros; maiores vão só como referência (`seq`) e cada instância lê do banco (`testes/eventos.test.ts`).
- Enquanto a conexão `LISTEN` de uma instância está caindo/reconectando, os SSE dela perdem eventos ao vivo; o cliente se recupera ao reconectar com `Last-Event-ID`.
- Push e e-mail SMTP: implementados na F2 (ADR-0014).
- `MODO_TESTE_CODIGO_EMAIL`/`MODO_TESTE_TOTP` existem só para a suíte e **impedem o boot** com `NODE_ENV=production` (QUESTION-024).
