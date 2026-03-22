FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    espeak \
    git \
    bash \
    curl

COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 18790

ENV NODE_ENV=production
ENV AQUACLAW_CONFIG=/config/aquaclaw.json

VOLUME ["/config", "/workspace"]

CMD ["node", "packages/cli/bin/aquaclaw.mjs", "gateway", "--bind", "all"]
