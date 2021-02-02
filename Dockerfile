FROM node:14 as builder
RUN npm install -g typescript ts-node

COPY package.json yarn.lock ./
RUN yarn --pure-lockfile

COPY . .

RUN yarn

CMD yarn start