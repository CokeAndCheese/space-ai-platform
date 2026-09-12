# syntax=docker/dockerfile:1

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app

ARG VITE_LLM_ENABLED=false
ARG VITE_APP_BASE=/space-ai-platform/
ENV VITE_LLM_ENABLED=${VITE_LLM_ENABLED}
ENV VITE_APP_BASE=${VITE_APP_BASE}

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS static-runtime
COPY deploy/nginx.static.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1

FROM static-runtime AS ai-runtime
COPY deploy/nginx.ai.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER="^LLM_PROXY_TOKEN$"

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS llm-runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/llm-proxy.mjs ./server/llm-proxy.mjs
COPY server/llm-quota.mjs ./server/llm-quota.mjs
USER node

EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/llm-proxy.mjs"]
