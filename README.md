# Decks 🌿✦

PWA de flashcards gamifiée — répétition espacée, quiz et sprint chrono. Vert tendre & lilas, mode sombre par défaut, 100 % statique et hors-ligne.

**Démo une fois déployée :** `https://ouaisfieu.github.io/decks/`

## Fonctionnalités

- **Révision** — cartes recto/verso avec système de Leitner (5 boîtes, intervalles 0/1/3/7/16 jours). Seules les cartes dues du jour sont proposées ; s'il n'y en a pas, révision libre en avance.
- **Quiz** — 10 QCM générés automatiquement (les distracteurs sont piochés dans les autres réponses du deck).
- **Sprint** — 60 secondes pour enchaîner un maximum de bonnes réponses.
- **Gamification** — XP, niveaux, combos (jusqu'à ×3), série quotidienne 🔥, records par deck, confettis.
- **Import** — glissez n'importe quel CSV `question,réponse` dans la bibliothèque (stocké localement).
- **PWA** — installable, fonctionne hors-ligne, données sauvegardées dans le navigateur.

## Déploiement (GitHub Pages)

1. Poussez le contenu de ce dossier à la racine du dépôt `ouaisfieu/decks`.
2. Sur GitHub : **Settings → Pages → Source : Deploy from a branch → `main` / `(root)`**.
3. C'est tout — l'app utilise des chemins relatifs, elle fonctionne sous `/decks/` sans configuration.

## Ajouter un deck à la bibliothèque

1. Déposez votre CSV dans `cartes/`. Format : deux colonnes `question,réponse`, sans en-tête obligatoire, guillemets RFC 4180 acceptés. Le pseudo-LaTeX simple (`$R_0$`, `$\sigma$`, `$5\%$`) est joliment nettoyé à l'affichage.
2. Déclarez-le dans `cartes/index.json` :

```json
{
  "decks": [
    {
      "id": "guerre-cognitive-moyen",
      "fichier": "guerre-cognitive-moyen.csv",
      "titre": "Guerre cognitive",
      "description": "Doctrines, concepts et acteurs de la guerre cognitive.",
      "niveau": "Moyen",
      "emoji": "🧠"
    }
  ]
}
```

3. Commit, push — le deck apparaît dans la bibliothèque (le service worker récupère les decks en « réseau d'abord », donc les mises à jour arrivent sans vider le cache).

## Structure

```
decks/
├── index.html          # coquille de l'app (design system complet)
├── app.js              # logique : parsing CSV, Leitner, XP, modes de jeu
├── sw.js               # service worker (hors-ligne)
├── manifest.webmanifest
├── icons/
└── cartes/             # la bibliothèque de decks
    ├── index.json
    └── guerre-cognitive-moyen.csv
```

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Espace` | retourner la carte |
| `1` / `2` | « À revoir » / « Je savais » |
| `1`–`4` | choisir une réponse au QCM |

Les données (progression, XP, decks importés) vivent dans le `localStorage` du navigateur — rien ne quitte l'appareil.
