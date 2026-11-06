# Implantação em produção: checklist do piloto

Este checklist cobre o ambiente de produção do backend (F3). As decisões de hospedagem estão nas QUESTION-023 e 025.

## 1. Banco (PostgreSQL 17 gerenciado, região **[DECIDIR]**)
- [ ] **PITR** ligado, com retenção de pelo menos 7 dias, e criptografia em repouso do provedor.
- [ ] **Papéis** criados com `backend/scripts/papeis.sql`, trocando as três senhas, guardadas no cofre:
  - `clinica_dono` (migrations);
  - `clinica_app` (aplicação: sem BYPASSRLS, não é dona de nada);
  - `clinica_backup` (só leitura e BYPASSRLS, usado apenas pelo backup).
- [ ] A aplicação conecta **só** como `clinica_app`. `DATABASE_URL_DONO` existe apenas no job de migração, nunca no contêiner da API.
- [ ] **Conexões:** `max` do pool (20) × número de instâncias + 1 conexão de LISTEN por instância, abaixo do limite do banco.
- [ ] **Ensaio de restauração** mensal, com o resultado registrado:
  `ADMIN_URL=... ORIGEM_URL=postgres://clinica_backup:...@host/clinica backend/scripts/ensaio-restauracao.sh`.
  Ele confere as linhas de todas as tabelas, o RLS forçado e as permissões no restaurado.

## 2. Segredos (cofre; nunca no repositório nem em variável de CI visível)
Gere com `pnpm --filter @clinica/backend chaves`:
- `CHAVE_JWT_PRIVADA`;
- `CHAVE_CIFRA` (cifra os segredos de MFA; **perder = toda a equipe refaz o MFA**);
- `SEGREDO_ASSINATURA`;
- `VAPID_CHAVE_PUBLICA` e `VAPID_CHAVE_PRIVADA` (**trocar = todos reinscrevem o push**).

O servidor **se recusa a subir** em `NODE_ENV=production` sem as chaves, com `MODO_TESTE_*`, ou com `EMAIL=arquivo`.

## 3. Contêiner (`backend/Dockerfile`)
- [ ] Build: `docker build -f backend/Dockerfile -t clinica-backend .` (da raiz do repositório).
- [ ] Antes de cada versão: `pnpm migrar` (job com `DATABASE_URL_DONO`), depois o deploy da API.
- [ ] **Variáveis:**
  - `NODE_ENV=production`;
  - `URL_PUBLICA=https://api...`: com https, o servidor envia HSTS;
  - `DATABASE_URL`;
  - `STORAGE=s3` com `S3_BUCKET`, `S3_REGIAO` e credenciais por papel IAM;
  - `EMAIL=smtp`, `SMTP_URL`, `EMAIL_REMETENTE`;
  - `VAPID_*`;
  - `LOG_LEVEL=info`.
- [ ] **Bucket S3** privado, sem listagem pública. CORS liberando `PUT` só das origens do frontend: o envio de foto vai direto do navegador para o S3.
- [ ] **Health check:** `GET /diretorio/v1/organizacoes?dominio=healthcheck.invalid` deve responder 404, nunca 5xx (já está no `HEALTHCHECK` da imagem).
- [ ] **Instâncias:** com 2 ou mais, o worker de jobs pode rodar em todas (é seguro), ou use `JOBS=0` nas de API e uma instância dedicada ao worker. O limite de requisições é por instância (ADR-0015).
- [ ] **TLS e proxy:** o proxy precisa repassar `X-Forwarded-For` (o servidor usa `trustProxy` para obter o IP real nos limites e na auditoria) e não pode bufferizar o SSE (`/v1/eventos/stream`, com `X-Accel-Buffering: no`).

## 4. Organização da clínica do piloto
- [ ] Arquivo da organização no formato dos cenários (sem pacientes de exemplo), com marca, módulos, termos, horário de atendimento, aviso de urgência e protocolos **revisados** (`docs/legal/textos-para-revisao.md`).
- [ ] `pnpm org:criar --arquivo clinica.json`, depois `org:atualizar` para mudanças. O primeiro gestor entra com senha provisória e passa por troca de senha, MFA e termos.
- [ ] Domínio do frontend em `dominios` da organização: só ele recebe CORS em produção.
- [ ] `links.termos` e `links.privacidade` apontando para os textos publicados; `termosVersao` igual à versão publicada.

## 5. Frontend
- [ ] Build de produção com `VITE_DIRETORIO_URL` do diretório real. O build de homologação (`?org=`) nunca vai para clientes.

## 6. Rotação de chaves (procedimento)
- **JWT** (sem derrubar ninguém):
  1. gerar a chave nova;
  2. publicar com `CHAVE_JWT_PRIVADA=<nova>` e `CHAVE_JWT_ANTERIOR=<antiga>`;
  3. depois de 15 min, remover `CHAVE_JWT_ANTERIOR`.
- **SEGREDO_ASSINATURA:** troca a qualquer hora. As URLs de arquivo duram 5 min.
- **CHAVE_CIFRA:** não há rotação automática. Trocar exige recifrar `usuarios.mfa_segredo_cifrado`, com script a escrever quando for necessário. Em caso de vazamento, desligue o MFA de todos e peça novo cadastro.

## 7. Antes de chamar a primeira clínica
- [ ] CI verde no commit implantado (conformidade completa nas 3 organizações, backend com S3 e E2E do frontend real).
- [ ] Simulado de incidente feito ([incidente.md](incidente.md)).
- [ ] Ensaio de restauração feito no ambiente de produção.
- [ ] Documentos de `docs/legal/` assinados.
