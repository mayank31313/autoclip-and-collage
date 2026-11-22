FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache ffmpeg
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
EXPOSE 3000
CMD ["node", "server.js"]

FROM dependencies AS worker
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY src ./src
COPY worker ./worker
COPY assets ./assets
COPY tsconfig.json ./
CMD ["npm", "run", "worker"]

FROM dependencies AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
