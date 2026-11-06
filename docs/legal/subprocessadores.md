# Subprocessadores (suboperadores): mapeamento

> Lista por FUNÇÃO. Quem preenche cada linha depende da hospedagem (QUESTION-025) e do provedor de e-mail (QUESTION-023).
> Antes do piloto, cada fornecedor precisa ter:
> 1. contrato ou termo de tratamento de dados;
> 2. região definida;
> 3. transferência internacional avaliada (art. 33 e Resolução CD/ANPD nº 19/2024) quando os dados saem do Brasil.

| Função | O que recebe | Fornecedor | Região | Contrato / DPA | Observação |
|---|---|---|---|---|---|
| Hospedagem da API (contêiner) | tudo que passa pela API, em memória | **[DECIDIR]** | **[DECIDIR]** (preferir Brasil) | | logs sem conteúdo clínico (ADR-0013) |
| Banco de dados gerenciado (PostgreSQL 17, PITR) | todos os dados | **[DECIDIR]** | idem | | criptografia em repouso do provedor; backup lógico com o papel `clinica_backup` |
| Armazenamento de arquivos (S3) | fotos recodificadas, sem metadados | **[DECIDIR]** | idem | | URLs assinadas de 5 min; bucket privado |
| E-mail (SMTP) | e-mail do destinatário; código de login, link de convite ou texto discreto | **[DECIDIR]** (SES, Resend, Postmark…) | **[DECIDIR]** | | nunca conteúdo clínico (RN-NOT-002) |
| Web Push | endpoint do navegador; texto discreto **cifrado de ponta a ponta** (o serviço de push não lê o conteúdo) | Google (FCM/Chrome), Apple (APNs/Safari), Mozilla: definido pelo navegador do usuário | EUA e outras | termos do navegador | sem nome de paciente nem conteúdo clínico, verificado em `push.test.ts` |
| DNS, CDN, TLS do frontend | IP e cabeçalhos | **[DECIDIR]** | | | |
| Monitoramento de erros (opcional, Sentry) | stack traces | não usado no piloto | | | se usar: redação de PII antes do envio |
