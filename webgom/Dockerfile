FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Next.js build args for process.env.NEXT_PUBLIC_*
ARG NEXT_PUBLIC_API_URL=https://api.gomdaithanh.com/api
ARG NEXT_PUBLIC_SITE_CODE=GSDT
ARG NEXT_PUBLIC_STORAGE_URL=https://api.gomdaithanh.com/storage
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_CODE=$NEXT_PUBLIC_SITE_CODE
ENV NEXT_PUBLIC_STORAGE_URL=$NEXT_PUBLIC_STORAGE_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/next.config.mjs ./

RUN npm install --production

EXPOSE 3000
CMD ["npm", "start"]
