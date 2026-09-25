# Fingerly first-party proxy container, version 1.0.0.
# No dependencies to install: the image is Node and one file, run as the
# image's unprivileged `node` user. Numeric, so Kubernetes' runAsNonRoot can
# check it.
FROM node:24-alpine
WORKDIR /app
COPY server.mjs ./
ENV NODE_ENV=production PORT=8080
USER 1000:1000
EXPOSE 8080
CMD ["node", "server.mjs"]
