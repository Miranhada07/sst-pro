# Dockerfile para SST PRO - Execução 24/7/365
FROM node:20-alpine

# Instalar dependências nativas para compilação do SQLite3 e Git
RUN apk add --no-cache python3 make g++ sqlite git

WORKDIR /app

# Instalar dependências
COPY package*.json ./
RUN npm ci --only=production

# Copiar código-fonte da aplicação
COPY server/ ./server/
COPY public/ ./public/

# Criar pasta persistente para o banco SQLite
RUN mkdir -p /app/data && chown -R node:node /app

# Definir variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000
ENV GITHUB_REPO=Miranhada07/sst-pro

# Porta exposta
EXPOSE 3000

# Trocar para usuário não-root
USER node

# Health check automático de 30 em 30 segundos
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Inicialização
CMD ["npm", "start"]
