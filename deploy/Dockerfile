# Self-hosted option: a small nginx image serving the built app.
#   docker build -f deploy/Dockerfile -t medunited-crm .
#   docker run -p 8080:8080 -e CRM_API_URL="https://script.google.com/macros/s/XXXX/exec" medunited-crm
# Put it behind your HTTPS reverse proxy / load balancer.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run test:backend && npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/docker-entrypoint.sh /docker-entrypoint.d/40-crm-config.sh
USER root
RUN chmod +x /docker-entrypoint.d/40-crm-config.sh && chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
