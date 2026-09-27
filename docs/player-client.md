# Client Windows et état de validation

Double-cliquer sur `player.cmd`, ou le lancer depuis CMD. Python 3.12 avec le lanceur `py` doit être installé. Au premier lancement, le script crée `.venv-player` et installe les dépendances. Le client demande l’adresse du serveur (localhost:8080 par défaut), ton pseudo et le code de salon commun (`123` dans la configuration initiale). Ces réponses sont enregistrées dans `deploy/player/player.env` ; l’identifiant technique est créé automatiquement. Aucun jeton joueur n’est à créer ni à copier. Pour changer de pseudo, serveur ou salon : `player.cmd --configure`. `MGBA_PATH` reste modifiable dans le fichier si mGBA est installé ailleurs.

Le client recherche les fichiers `.gba`, `.gb` et `.gbc` dans `C:\Users`, affiche leur nom et leur chemin complet, puis demande un numéro. Les dossiers inaccessibles sont signalés et ignorés, ainsi que les jonctions, liens et caches. Les archives ZIP doivent être décompressées au préalable. Une recherche peut être ciblée :

```cmd
player.cmd --list --root "C:\Users\benja\Documents\ROM"
player.cmd --rom "C:\Jeux\Pokemon Emeraude.gba"
```

Le client lance une nouvelle instance de mGBA pour la ROM sélectionnée et charge Lua directement avec `--script`. Il n'utilise plus les menus, la souris ni les contrôles d'accessibilité. mGBA 0.10.5 ne propose pas ce paramètre : exécuter `scripts/setup-mgba-windows.ps1` pour installer une copie portable officielle de développement dans `.player-runtime` et configurer `MGBA_PATH`. Cette copie conserve ses réglages séparément ; l'installation existante n'est pas remplacée. Le script conserve les licences fournies dans l'archive et enregistre la version, l'URL et le SHA-256 dans `installed.json`.
+
+Version vérifiée par `--help` et `--version` : 0.11-9140-1d201b22a (24 septembre 2026). Aucun jeu n'a été lancé lors de cette vérification. Le client attend toujours une confirmation de la session Lua avant d'annoncer la connexion active. Source des versions portables : https://mgba.io/downloads.html.

Le port est choisi dynamiquement sur localhost. Le client arrête son agent à la fermeture de mGBA et conserve les sauvegardes sous le contrôle de l'émulateur. En cas d'erreur, mGBA reste ouvert pour permettre de sauvegarder normalement. Ne pas changer de ROM dans cette instance : fermer mGBA et sélectionner la nouvelle ROM dans le client.

## Compatibilité réelle

L'identification utilise le SHA-256 complet du fichier. L'en-tête seul n'active jamais un profil. Le registre `rom-manifest.json` reconnaît la ROM française testée en lecture sur un état mGBA réel ; voir `rom-compatibility.md` pour la portée de cette validation. Une ROM inconnue peut être lancée pour jouer ; le Lua envoie seulement le diagnostic, sans accès RAM ni insertion.

Deux profils candidats existent : `emerald-fr-bpef-v0` et `emerald-en-bpee-v0`. Ils ne constituent pas une annonce de compatibilité validée. La ROM française locale a été identifiée, mais aucune sauvegarde de test ni ROM anglaise n'a été trouvée dans le dossier ROM indiqué. Il reste à comparer la lecture à plusieurs états de jeu réels, y compris transitions, six emplacements et sauvegarde/rechargement après insertion, puis à consigner les résultats avant d'ajouter une empreinte avec `validated: true`.

Les tables locales contiennent les 386 noms FR/EN, les conversions exactes des identifiants internes et les identifiants des cartes de référence. Les lieux principaux sont traduits ; certains sous-lieux gardent un libellé technique anglais. La correspondance des cartes françaises reste à comparer en jeu. Les sources figurent dans `game-data.json`.

## Vérifications automatiques

```powershell
npm ci
npm run build
npm test
npm run typecheck
.venv-player\Scripts\python.exe -m pip install -r tests\requirements.txt
.venv-player\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Les tests Lua exécutent le vrai extracteur avec une mémoire simulée : interdiction des accès pour ROM inconnue, 24 permutations dans les deux langues, checksum incorrect, caractères accentués et insertion/relecture des 386 espèces avec nature et chromatique. Ils ne remplacent pas une validation dans mGBA avec une ROM réelle.

L'API attend maintenant le résultat de Lua après insertion et vérification du Pokémon écrit. Une erreur ou un délai dépassé ne signifie pas que le jeu n'a pas été modifié : vérifier l'équipe avant de réessayer. L'API refuse les commandes lorsqu'un même identifiant joueur a plusieurs connexions.
