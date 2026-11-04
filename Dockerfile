# syntax=docker/dockerfile:1
# ============================================================
# Image optimisée — multi-stage, base légère épinglée, non-root
# ============================================================

# --- Étape 1 : "build" — on installe UNIQUEMENT ce qu'il faut pour la prod
FROM node:26-alpine AS deps
WORKDIR /app
# package*.json copiés AVANT le code : cette couche est mise en cache
# tant que les dépendances ne changent pas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Étape 2 : image finale propre — on ne garde que le strict nécessaire
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
# npm/npx ne servent pas en prod (CMD appelle node directement) :
# on les retire pour reduire la surface d'attaque (CVE internes a npm)
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# On ne recopie que les node_modules de prod depuis l'étape deps
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
# Jamais root dans le conteneur
USER node
EXPOSE 3000
# node directement, pas npm start (npm rajoute un process et des signaux parasites)
CMD ["node", "src/index.js"]
