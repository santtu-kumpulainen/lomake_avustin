# Development image: source is bind-mounted by docker-compose.yml.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]
