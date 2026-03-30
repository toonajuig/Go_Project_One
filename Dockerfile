FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APPIMAGE_EXTRACT_AND_RUN=1

ARG INSTALL_KATAGO=0
ARG KATAGO_DOWNLOAD_URL=https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigen-linux-x64.zip
ARG KATAGO_MODEL_URL=https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-zhizi-b28c512nbt-muonfd2.bin.gz

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN mkdir -p /app/tools/katago/config /app/tools/katago/engine /app/tools/katago/models
COPY tools/katago/config/analysis_example.cfg ./tools/katago/config/analysis_example.cfg
RUN if [ "$INSTALL_KATAGO" = "1" ]; then \
    curl -fsSL "$KATAGO_DOWNLOAD_URL" -o /tmp/katago-linux.zip \
    && unzip -q /tmp/katago-linux.zip -d /app/tools/katago/engine \
    && rm -f /tmp/katago-linux.zip \
    && chmod +x /app/tools/katago/engine/katago \
    && curl -fsSL "$KATAGO_MODEL_URL" -o "/app/tools/katago/models/$(basename "$KATAGO_MODEL_URL")"; \
  fi

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "const port = process.env.PORT || 3000; fetch('http://127.0.0.1:' + port + '/healthz').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1));"]

CMD ["npm", "start"]
