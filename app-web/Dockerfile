FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# npm ci падает на lock-файле из Windows (нет linux-бинарников rolldown) — ставим по lock через install
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
