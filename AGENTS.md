# AGENTS.md

- Rédiger toute l’interface utilisateur en français.
- Pour chaque comportement, suivre TDD : test rouge ciblé, implémentation minimale, test vert, puis suite complète.
- Ne jamais exposer de secret dans une variable `VITE_*` ni dans le code client.
- Ne jamais versionner une transcription brute ou préparée ; elles restent sous `.cache/`.
- Présenter le site comme un projet indépendant, sans affiliation avec Thinkerview.
- Laisser React échapper tous les textes YouTube et ne jamais employer `dangerouslySetInnerHTML`.
- Toute modification de schéma exige un changement explicite de version ainsi qu’un test de migration ou de rejet.
