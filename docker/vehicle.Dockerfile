# Vehicle service image. Runs the Node/TS control service (tsx, no build step).
# Hardware drivers (M3) will add native deps; for sim this is enough.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/vehicle/package.json packages/vehicle/package.json
RUN npm install --omit=dev --workspace @yonderrc/vehicle || npm install --workspace @yonderrc/vehicle

COPY packages/protocol packages/protocol
COPY packages/vehicle packages/vehicle

ENV YRC_HOST=0.0.0.0
ENV YRC_PORT=8080
CMD ["npm", "run", "start", "-w", "@yonderrc/vehicle"]
