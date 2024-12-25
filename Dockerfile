FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm i

COPY . .

EXPOSE 8666

CMD ["npm", "run", "dev"]