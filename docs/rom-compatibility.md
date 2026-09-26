# Compatibilité ROM

Le registre `emulator/profiles/rom-manifest.json` est volontairement vide : aucun dump officiel FR ou EN n’a été fourni pour validation, et le projet ne publie pas de ROM. L’infrastructure identifie déjà une ROM par SHA-256 et son en-tête GBA. Une empreinte inconnue produit « ROM non reconnue » et aucune lecture RAM.

| Version | Statut réel |
| --- | --- |
| Émeraude France | Infrastructure prête, profil mémoire non validé |
| Emerald USA | Infrastructure prête, profil mémoire non validé |
| Emerald Europe EN | Édition/révision à identifier |
| Révisions officielles | À identifier et tester individuellement |
| Hacks/randomizers | Non pris en charge |

L’en-tête seul n’autorise jamais un profil. Une entrée du manifeste exige une empreinte calculée localement, des fixtures anonymisées, des tests du décodage et une validation de toutes les lectures. Ne jamais publier l’empreinte comme une source de ROM ni commettre le fichier.
