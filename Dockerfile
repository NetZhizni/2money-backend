FROM node:24-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chmod +x docker-entrypoint.sh

EXPOSE 3100
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/cluster.js"]
