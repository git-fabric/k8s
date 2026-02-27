# @git-fabric/k8s — multi-stage build
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/
RUN npm run build

FROM node:22-alpine

LABEL org.opencontainers.image.title="@git-fabric/k8s"
LABEL org.opencontainers.image.description="Kubernetes fabric app — MCP layer for k3s cluster management"
LABEL org.opencontainers.image.source="https://github.com/git-fabric/k8s"

RUN addgroup -g 1001 -S fabric && adduser -u 1001 -S fabric -G fabric

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin

USER fabric
ENV NODE_ENV=production
# In-cluster by default — reads service account token automatically
ENV K8S_IN_CLUSTER=true

ENTRYPOINT ["node", "bin/cli.js"]
CMD ["start", "--stdio"]
