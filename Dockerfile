# Imagen única: construye el cliente (Vite) y el servidor (esbuild) y sirve ambos desde un proceso Node.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 STATIC_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist/server.mjs ./server.mjs
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
