# devsecops-tp — Rends ce repo prêt pour la prod

Petite API Node.js (Express) sécurisée de bout en bout : secrets, dépendances,
code, pipeline CI durci, image Docker optimisée et coûts AWS.

> ⚠️ Le code de départ est volontairement vulnérable (3 failles). Ne jamais le
> lancer sur un serveur exposé à Internet. La version corrigée est dans ce repo.

## Badges

[![CI](https://github.com/okaridiamilu/devsecops-tp/actions/workflows/ci.yml/badge.svg)](https://github.com/okaridiamilu/devsecops-tp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/okaridiamilu/devsecops-tp/actions/workflows/codeql.yml/badge.svg)](https://github.com/okaridiamilu/devsecops-tp/actions/workflows/codeql.yml)

*(remplace `okaridiamilu` par ton identifiant GitHub)*

## Lancer en local

```bash
npm ci
npm test        # 2 tests fonctionnels + 5 tests de régression sécurité
npm start       # http://localhost:3000/health
```

## 🔐 Sécurité & coûts

### 1. Secrets

- **Push protection / Secret scanning** activés (Settings → Code security).
- `.gitignore` : `node_modules/`, `.env`, `coverage/`, `*.log`.
- `.env.example` avec `PORT=3000` — aucune valeur secrète.

**À vous — la clé qui a fuité :** ton collègue a poussé une vraie clé AWS il y a
3 jours puis l'a supprimée. Mauvaise nouvelle : **supprimer le fichier ne suffit
pas**, la clé reste dans l'historique Git (le commit d'il y a 3 jours existe
toujours) et les robots scannent GitHub en continu. Elle est donc **compromise**.
Dans l'ordre :

1. **Révoquer** la clé immédiatement dans AWS IAM (elle ne sert plus à rien) ;
2. **Remplacer** par une nouvelle clé, stockée dans GitHub Secrets / Secrets Manager ;
3. **Vérifier l'usage** : CloudTrail / logs d'accès AWS pour voir si elle a été utilisée ;
4. **Nettoyer l'historique** (`git filter-repo` ou BFG) et **prévenir la sécu**.

> Règle d'entreprise : une clé publiée se **révoque**, elle ne se supprime pas.

### 2. Dépendances — `npm audit` avant / après

| | Critical | High | Moderate | Low |
|---|---|---|---|---|
| **Avant** (express 4.17.1, lodash 4.17.15) | 0 | **5** | 16 | 7 |
| **Après** (express 4.22.3, lodash 4.18.1) | 0 | **0** | 16 | 4 |

Les 5 failles HIGH venaient de `express` (via `body-parser`, `qs`,
`path-to-regexp`, `cookie`, `send`, `serve-static`) et de `lodash`.
Mesuré en local avec `npm audit` (le job `deps-audit` du CI bloque sur
`npm audit --audit-level=high`).

- Dependabot activé (alerts + security updates) et `.github/dependabot.yml`
  pour **3 écosystèmes** : `npm`, `github-actions`, `docker`.

### 3. Code — les 3 failles et leur correction

| Route | Nom de la faille | URL d'attaque | Correction |
|---|---|---|---|
| `/hello` | **XSS réfléchi** (injection de HTML/JS dans la page) | `/hello?name=<script>alert(1)</script>` | Échapper le HTML (`escapeHtml`) avant d'insérer le nom |
| `/ping` | **Injection de commande** (le paramètre est collé dans un shell) | `/ping?host=google.com;cat /etc/passwd` | Regex stricte sur l'hôte (400 sinon) + `execFile('ping', ['-c','1',host])` **sans shell** |
| `/prefs` | **Prototype pollution** / fuite de clés (`_.merge` avec `req.query`) | `/prefs?__proto__[admin]=true` ou `/prefs?admin=true` | Whitelist : `_.pick(req.query, ['theme','lang'])` |

Chaque faille a un **test de régression** dans `tests/security.test.js`
(il échoue sur l'ancien code, passe sur le nouveau) : vérifié en local —
4 tests rouges avant correction, 7/7 verts après.

### 4. Pipeline durci (`.github/workflows/ci.yml`)

- Déclencheurs : `push` sur `main` + `pull_request` uniquement
- `permissions: contents: read` (moindre privilège)
- `timeout-minutes` sur chaque job
- `npm ci` + `cache: npm` (reproductible, jamais `npm install` en CI)
- `concurrency` + `cancel-in-progress: true`
- Action tierce **épinglée par SHA** : `aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8 # v0.36.0`
- Branche `main` protégée : PR obligatoire, jobs `test`, `deps-audit`, `image` (Trivy bloquant) requis

**À vous — l'incident trivy-action de mars 2026 :** 76 des 77 tags ont été
redirigés vers du code malveillant. Un workflow qui utilisait `@v0.34.0` était
**touché** si ce tag faisait partie des 76 : un tag est un pointeur **mobile**,
quand il est déplacé, le workflow exécute le nouveau code malveillant.
Un workflow **épinglé par SHA** n'est **pas touché** : un SHA est immuable,
il pointe toujours vers le commit légitime d'origine, même si le tag bouge.

### 5. Image Docker — avant / après

Mesuré en local (`docker images`, `docker history`, Trivy 0.74.0) :

| Image | Taille | Nb de couches | CVE CRITICAL | CVE HIGH |
|---|---|---|---|---|
| **Naïve** (`Dockerfile.naif`, `node:22` Debian + `COPY . .` + `npm install`) | **1,84 Go** | 16 | **20** | **532** |
| **Optimisée** (multi-stage `node:22-alpine`, `npm ci --omit=dev`, npm retiré, `USER node`) | **250 Mo** | 17 | **0** | **0** |

(Trivy 0.74.0, `--severity HIGH,CRITICAL --ignore-unfixed`, mesuré en local :
`trivy image --exit-code 1` renvoie 0. Pour arriver à 0 HIGH, `npm`/`npx` sont
retirés de l'image finale — ils ne servent pas en prod puisque le conteneur
lance `node` directement — ce qui élimine les CVE internes à npm embarqué
(brace-expansion, ip-address, pacote, picomatch, sigstore…). Le job CI `image`
bloque sur toute HIGH/CRITICAL corrigeable grâce à `ignore-unfixed: true` +
`exit-code: '1'`.)

Réponses aux questions :

- **Couche la plus lourde** de l'image naïve : la base `node:22` (Debian
  complet, ~1 Go) + la couche `RUN npm install` (182 Mo, dont jest/supertest
  inutiles en prod).
- **Un `.env` serait-il dans l'image naïve ?** Oui — vérifié : `docker run --rm
  devsecops-tp:naif sh -c "cat /app/.env"` affiche la fausse clé
  `AKIAIOSFODNN7EXAMPLE`. Le `.git` y est aussi. `.dockerignore` + multi-stage
  les excluent de l'image optimisée.

Le Dockerfile optimisé : base `node:22-alpine` (version épinglée), `package*.json`
copiés avant le code (cache des couches), `npm ci --omit=dev`, multi-stage,
`USER node`, `CMD ["node", "src/index.js"]` (pas `npm start`). L'app tourne :
`docker run -p 3000:3000 devsecops-tp:optim` → `curl localhost:3000/health` = `{"status":"ok"}`,
`id` dans le conteneur = `uid=1000(node)`.

Le job `image` du CI construit l'image (cache GHA) et la scanne avec Trivy
(épinglé par SHA, `exit-code: '1'` sur HIGH/CRITICAL).

### 6. AWS et coûts

#### 6.1 Schéma de l'architecture cible

```mermaid
flowchart LR
    Dev --> GH[GitHub Actions]
    GH -->|OIDC, aucune clé stockée| IAM[Rôle IAM OIDC]
    GH -->|build + scan Trivy| IMG[Image taguée par SHA]
    IMG --> ECR[Amazon ECR]
    ECR --> ECS[ECS Fargate]
    ECS --> ALB[Application Load Balancer]
    ALB --> User[Utilisateur]
    ECS --> SM[AWS Secrets Manager]
    ECS --> CW[CloudWatch Logs]
```

#### 6.2 Combien ça coûte ? (ECS Fargate, 1 tâche 0,25 vCPU / 0,5 Go, us-east-1)

Prix : x86 = 0,04048 $/vCPU-h et 0,004445 $/Go-h · ARM = 0,03238 $/vCPU-h et
0,003556 $/Go-h · 730 h/mois.

| Scénario | Heures / mois | Calcul | Coût / mois |
|---|---|---|---|
| A. x86, 24h/24 | 730 | (0,25 × 0,04048 + 0,5 × 0,004445) × 730 = 0,0123425 × 730 | **≈ 9,01 $** |
| B. ARM, 24h/24 | 730 | (0,25 × 0,03238 + 0,5 × 0,003556) × 730 = 0,009873 × 730 | **≈ 7,21 $** |
| C. x86, 12 h × 5 j | 260 (60 h/sem × 52/12) | 0,0123425 × 260 | **≈ 3,21 $** |

**À vous — la NAT Gateway :** 0,045 $/h × 730 h = **32,85 $/mois**, même sans
aucun trafic. C'est **~3,6× le coût du scénario A** (9,01 $) : sur une petite
archi, la NAT coûte plus cher que la prod elle-même. Conclusion : ne la
déployer que si elle est vraiment nécessaire (VPC endpoints, sous-réseau
public, ou suppression pure et simple).

#### 6.3 Lifecycle ECR

`aws/ecr-lifecycle.json` : règle qui **expire toutes les images sauf les 10 plus
récentes** (`countType: imageCountMoreThan`, `countNumber: 10`) — le stockage
ECR (0,10 $/Go/mois) ne grossit pas indéfiniment.

### 7. Bonus — déploiement par OIDC

`.github/workflows/deploy-aws.yml` : sur `main` (après CI verte), obtient des
droits AWS **par OIDC** (`permissions: id-token: write`, aucune clé nulle part),
pousse l'image **taguée par `github.sha`** sur ECR, puis met à jour le service
ECS. `if: vars.AWS_ENABLED == 'true'` + `environment: production` +
`concurrency` : sans compte AWS le job ne se lance pas (échec OIDC normal).

---

*Rendu TP : URL de ce repo GitHub public — workflows, `dependabot.yml`,
`Dockerfile`, `.dockerignore`, `aws/`, tests et README.*
