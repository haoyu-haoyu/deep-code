# syntax=docker/dockerfile:1
FROM node:22-slim AS builder

WORKDIR /build

# Copy package files for npm ci with better layer caching.
COPY package.json package-lock.json ./
COPY packages/deep-code/package.json ./packages/deep-code/

RUN npm ci

# Copy source and build the full CLI bundle.
COPY packages/deep-code/ ./packages/deep-code/

RUN npm install -g bun@latest
RUN cd packages/deep-code && bun run build:full-cli

FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=builder /build/packages/deep-code/dist /app/dist
# deepcode.js imports runtime modules from src/deepcode.
COPY --from=builder /build/packages/deep-code/src /app/src
COPY --from=builder /build/packages/deep-code/deepcode.js /app/deepcode.js
COPY --from=builder /build/packages/deep-code/package.json /app/package.json

VOLUME ["/workspace"]
WORKDIR /workspace

ENTRYPOINT ["node", "/app/deepcode.js"]
CMD ["--help"]
