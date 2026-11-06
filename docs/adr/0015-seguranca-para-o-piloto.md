#  ADR-0015: Segurança mínima para o piloto (F3)

- **Status:** proposto (F3) · **Data:** 2026-11-06 · Complementa as ADR-0013 e ADR-0014

## Contexto
A seção 14.4 lista o mínimo de segurança para colocar pacientes reais no sistema. Depois da F2, as lacunas eram:
- imagem sem recodificação (QUESTION-022);
- limite de requisições só no login;
- sem cabeçalhos de segurança;
- uma única chave de JWT, sem rotação;
- caminho S3 sem teste;
- nenhuma ferramenta para responder a incidente;
- restauração de backup nunca testada.

## Decisões

**Recodificação completa das imagens (sharp/libvips).**
- **O que acontece:** o arquivo é decodificado e gerado de novo a partir dos pixels.
- **O que é eliminado:** EXIF (inclusive GPS), XMP/IPTC, comentários, chunks desconhecidos e conteúdo anexado ao fim do arquivo (poliglotas JPEG+HTML/ZIP).
- **Ajustes da imagem:**
  - a orientação é aplicada antes de descartar o EXIF;
  - o lado maior fica em no máximo 2560 px;
  - entradas acima de 50 Mpx são recusadas (bomba de descompressão).
- **Miniatura real** de 320 px para `urlMiniatura`. Antes era a mesma URL da imagem inteira.
- **Quarentena:** o original sai da quarentena depois do processamento. Só a versão limpa fica guardada.
- **Imagem que não decodifica** é REJEITADA, com uma mensagem que orienta a tirar outra foto.
- **Custo:** dependência nativa, mas com binário pré-compilado (`@img/sharp-*`). Na instalação, o pnpm avisa "Ignored build scripts: sharp", e isso é esperado: o binário vem pronto.

**Limite de requisições por IP, por conta e por organização** (`servicos/limites.ts`).
- **Tetos padrão:** IP 1200/min, conta 600/min, organização 6000/min, todos configuráveis por ambiente. Acima do teto: 429 `MUITAS_TENTATIVAS` com `Retry-After`.
- **Janela fixa em memória, por instância:**
  - não há escrita no banco por requisição;
  - com N instâncias, o teto efetivo é N×;
  - para 1–2 instâncias no piloto basta; com escala, vai para Redis ou para o balanceador ou WAF.
- **Força bruta de login** continua com o limite próprio, persistido no banco (ADR-0013).

**Cabeçalhos de segurança em toda resposta.**
- **Sempre:**
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: no-referrer`;
  - `X-Frame-Options: DENY`;
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox` (a API só serve JSON e imagens);
  - `Cross-Origin-Opener-Policy: same-origin`.
- **HSTS** (1 ano, includeSubDomains) quando `URL_PUBLICA` é https.
- **Banco fora do ar:** antes saía um 500 cru do framework. Agora sai 503 `INDISPONIVEL_TEMPORARIAMENTE` no formato do contrato, com `Retry-After`.

**Rotação da chave do JWT sem derrubar sessões.**
- O token sai com `kid`, derivado da chave pública.
- `CHAVE_JWT_ANTERIOR` (PEM pública ou privada) continua aceita só na verificação.
- **Procedimento** (em `docs/operacao/implantacao.md`):
  1. gerar a chave nova;
  2. publicar com a antiga em `CHAVE_JWT_ANTERIOR`;
  3. depois de 15 min (validade do token de acesso), remover a antiga.
- As sessões continuam, porque o token de renovação é opaco e fica no banco.
- **Testes:** cobrem `alg: none` e `kid` adulterado.

**Ferramentas de incidente** (`pnpm incidente`, rodam como dono e com o contexto de uma organização):
- `revogar-sessoes`: por organização ou por usuário, com efeito imediato. A sessão é conferida no banco a cada requisição, e os apps abertos recebem `sessao.encerrada`.
- `suspender` e `--reativar`: a organização inteira.
- `acessos --paciente`: quem leu ou alterou dados do paciente e de tudo ligado a ele, em CSV. Serve tanto para o pedido do titular quanto para a análise de um vazamento.
- Toda ação vai para a trilha de auditoria, com `request_id = incidente:{operador}`.

**Backup lógico exige papel próprio.**
- Com RLS forçado, **nem o dono consegue `pg_dump`**: o `COPY` é recusado. Isso é o isolamento funcionando.
- Por isso existe `clinica_backup`: `BYPASSRLS` e só leitura (`pg_read_all_data`), com senha em cofre separado.
- `scripts/ensaio-restauracao.sh`:
  1. faz o dump e restaura num banco temporário;
  2. compara as linhas de todas as tabelas;
  3. confere que RLS, `FORCE` e as permissões do papel da aplicação voltaram;
  4. falha se algo divergir.
- O PITR em si é do provedor (QUESTION-025).

**Implantação.**
- **Imagem:** `backend/Dockerfile` gera uma imagem só com as dependências de produção, rodando como usuário sem privilégio, com healthcheck. O `tsx` passou a ser dependência de runtime: o Node 22 sozinho não remove toda a sintaxe TypeScript do código.
- **Ambiente local completo:** `docker-compose.yml` com Postgres 17, MinIO, Mailpit e o backend.

**S3 testado no CI:** o job `backend-s3` roda o backend com `STORAGE=s3` contra um S3 local (moto) e passa nas partes de arquivos, check-in com foto e chat da conformidade. No fim confere que a quarentena ficou vazia.

## Consequências
- Testes do backend: 35 (eram 24). Novos:
  - imagem: GPS removido, poliglota descartado, orientação aplicada, arquivo corrompido recusado;
  - rotação de JWT;
  - cabeçalhos de segurança e limite de requisições.
- **Fica para depois:**
  - antivírus (ClamAV), mais relevante quando houver PDF;
  - criptografia por campo com chave por organização (decisão 8: depois do piloto);
  - OpenTelemetry e Sentry;
  - WAF.
- **Fora do código:** os requisitos legais da F3 estão em `docs/legal/` como rascunhos estruturados. Precisam de advogado, do encarregado e da clínica: este repositório não substitui parecer jurídico.
