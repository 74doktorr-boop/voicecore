FROM node:22-slim
WORKDIR /app

# Deps layer — cached unless package.json changes
COPY package*.json ./
# --max-old-space-size limits npm's RAM; --jobs=2 caps CPU during install
RUN node --max-old-space-size=512 $(which npm) ci --omit=dev --jobs=2

COPY . .
# SHA del commit → visible en /health para saber QUÉ versión corre (2026-07-16).
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
EXPOSE 3001
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Limit Node.js heap so the container stays under VPS RAM limits
CMD ["node", "--max-old-space-size=768", "server.js"]
