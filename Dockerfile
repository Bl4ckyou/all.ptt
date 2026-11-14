FROM node:22-alpine AS build
WORKDIR /app

COPY package.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN npm install
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY config.example.json ./config.json

EXPOSE 4750
CMD ["node", "dist/server.js"]
