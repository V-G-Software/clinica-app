# Backend de referência: API + worker de jobs num contêiner (14.1). Build a partir da RAIZ do monorepo:
#   docker build -f backend/Dockerfile -t clinica-backend .
# Migrations rodam à parte, com o papel dono:  docker run --rm -e DATABASE_URL_DONO=... clinica-backend pnpm migrar
FROM node:22-bookworm-slim
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY pacotes ./pacotes
COPY contrato ./contrato
COPY backend ./backend
# Só o backend e os pacotes do workspace de que ele depende; sharp traz o binário (libvips) pré-compilado.
RUN pnpm install --frozen-lockfile --prod --filter @clinica/backend... \
 && mkdir -p /app/backend/.dados && chown -R node:node /app/backend/.dados
USER node
WORKDIR /app/backend
EXPOSE 4020
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4020)+'/diretorio/v1/organizacoes?dominio=healthcheck.invalid').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
