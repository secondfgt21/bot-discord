FROM node:22-alpine

WORKDIR /app

# Copy package manifests and install dependencies
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps && npm install --no-save --legacy-peer-deps @rolldown/binding-linux-x64-musl

# Copy application source & build Vite frontend
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["npm", "run", "start"]
