## Scénario manuel : distinction prestations reçues / à demander

Ce scénario vérifie qu’une prestation mentionnée comme déjà perçue est bien
injectée dans le payload OpenFisca, alors qu’une prestation simplement envisagée
reste à `null`.

## Utilisation d'OpenFisca en local

Le backend n’appelle plus l’API publique `https://api.fr.openfisca.org`. À la
place, il exécute le simulateur Python localement via le script
`scripts/run_openfisca_local.py`. Pour que l’appel fonctionne, il faut :

1. Disposer de Python 3.9 ou plus.
2. Installer les dépendances Python dans le dossier `openfisca-france` (par
   exemple avec `uv sync` ou `pip install -e .` dans ce dossier, ce qui installe
   également `openfisca-core[web-api]`).

Au démarrage, l’application Node lance automatiquement le script Python en
passant le payload JSON. Quelques variables d’environnement permettent de
personnaliser le comportement :

| Variable | Description |
| --- | --- |
| `OPENFISCA_USE_LOCAL` | Activée par défaut (`true`). Mettre à `false` pour forcer l’usage d’une API distante (il faut alors définir `OPENFISCA_BASE_URL`). |
| `OPENFISCA_BASE_URL` | URL d’une instance OpenFisca accessible en HTTP. Utilisée uniquement si `OPENFISCA_USE_LOCAL=false` **ou** si l’exécution locale échoue. |
| `OPENFISCA_PYTHON_PATH` | Binaire Python à utiliser (par défaut `python3`). |
| `OPENFISCA_LOCAL_EXTRA_VARIABLES` | Liste séparée par des virgules des variables supplémentaires à calculer en plus de celles présentes dans le payload et des prestations par défaut. |

Le script produit une réponse structurée comme l’API publique (avec la clé
`entities`). En cas d’erreur (module Python manquant, calcul impossible…), le
backend logue le message d’erreur et, si `OPENFISCA_BASE_URL` est défini,
tente automatiquement un appel HTTP de repli.

1. Exécuter la commande suivante :

   ```bash
   node --input-type=module -e "import { buildOpenFiscaPayload } from './src/variables.js'; const payload = buildOpenFiscaPayload({ prestations_recues: [{ beneficiaire: 'demandeur', nom: 'aah', montant: 860 }], prestations_a_demander: [{ beneficiaire: 'menage', nom: 'rsa' }] }); console.log('AAH individu_1:', payload.individus.individu_1.aah); console.log('RSA famille_1:', payload.familles.famille_1.rsa);"
   ```

2. Vérifier que la sortie contient un montant pour `AAH individu_1` (la valeur
   est renseignée car l’aide est déclarée comme reçue) tandis que
   `RSA famille_1` affiche `{... : null}` : la demande est simplement envisagée
   et n’est donc pas envoyée à OpenFisca.

## Champ `availableBenefits` dans la réponse `/simulate`

L’appel `POST /simulate` renvoie désormais un objet contenant :

```json
{
  "payload": { "…" },
  "result": { "…" },
  "availableBenefits": [
    {
      "id": "rsa",
      "label": "Revenu de solidarité active",
      "entity": "famille",
      "period": "2024-05",
      "amount": 532.42
    }
  ],
  "explanation": "Le foyer peut prétendre au RSA pour un montant estimé à 532,42 € par mois…"
}
```

`availableBenefits` liste les aides monétaires calculées par OpenFisca pour la
période en cours (mois ou année selon la variable). Seuls les montants
strictement positifs sont conservés. Le champ `explanation` fournit un résumé en
français clair généré automatiquement (ou `null` si la génération échoue).

## Déploiement sur Render

Pour une exécution 100 % locale d’OpenFisca sur Render, assurez-vous que :

1. Le build installe les dépendances Python dans `openfisca-france`, par
   exemple en ajoutant la commande suivante dans le script de build Render
   (avant `npm install`) :

   ```bash
   pip install -e ./openfisca-france
   ```

2. Les variables d’environnement suivantes sont définies dans l’onglet
   **Environment** du service Render :

   | Variable | Valeur recommandée | Commentaire |
   | --- | --- | --- |
   | `OPENAI_API_KEY` | `<votre clé OpenAI>` | Obligatoire pour la génération du JSON et des explications. |
   | `OPENFISCA_USE_LOCAL` | `true` | Force l’usage du simulateur Python embarqué (valeur par défaut si la variable est absente). |
   | `OPENFISCA_BASE_URL` | *(optionnelle)* | Laisser vide, sauf si vous souhaitez garder une URL de secours vers une instance OpenFisca distante. |
   | `OPENFISCA_PYTHON_PATH` | *(optionnelle)* | À définir uniquement si le binaire Python n’est pas accessible via `python3`. |
   | `PORT` | `10000` (ou valeur fournie par Render) | Render impose cette variable pour exposer le service HTTP. |

Avec cette configuration, Render exécutera le script Python local, sans appeler
l’API publique OpenFisca.

## Tests Postman

L’API Express est exposée sous `/api`. Les deux points de terminaison principaux
peuvent être testés dans Postman avec l’en-tête `Content-Type: application/json` :

1. **Génération du JSON brut**

   - Méthode : `POST`
   - URL : `https://<votre-service>.onrender.com/api/generate-json`
   - Corps (`raw` / JSON) :

     ```json
     {
       "message": "Couple avec deux enfants, revenus de 1 500 € par mois, locataires à Lyon."
     }
     ```

   - Réponse : `{ "json": { ... } }` contenant la structure interprétée par OpenAI.

2. **Simulation OpenFisca**

   - Méthode : `POST`
   - URL : `https://<votre-service>.onrender.com/api/simulate`
   - Corps (`raw` / JSON) :

     ```json
     {
       "rawJson": {
         "situation": {
           "demandeur": {
             "prenom": "Alice",
             "statut_professionnel": "salarie",
             "revenu_net_mensuel": 1500
           }
         }
       }
     }
     ```

   - Réponse : `{ "payload": { ... }, "result": { ... }, "availableBenefits": [ ... ], "explanation": "..." }`.

Adaptez les URL si vous testez en local (`http://localhost:3001/api/...`).
