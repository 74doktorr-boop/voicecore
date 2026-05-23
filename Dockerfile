FROM node:22-slim
WORKDIR /app

# Deps layer — cached unless package.json changes
COPY package*.json ./
# --max-old-space-size limits npm's RAM; --jobs=2 caps CPU during install
RUN node --max-old-space-size=512 $(which npm) ci --omit=dev --jobs=2

COPY . .
EXPOSE 3001
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Limit Node.js heap so the container stays under VPS RAM limits
CMD ["node", "--max-old-space-size=768", "server.js"]
