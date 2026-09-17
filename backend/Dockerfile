FROM node:18-alpine AS builder

WORKDIR /app

# Copy shared definitions
COPY shared ./shared

# Build backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install

COPY backend ./
RUN npm run build

FROM node:18-alpine AS runner

WORKDIR /app

COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/dist ./backend/dist

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/backend/src/server.js"]
