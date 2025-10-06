## Scénario manuel : distinction prestations reçues / à demander

Ce scénario vérifie qu’une prestation mentionnée comme déjà perçue est bien
injectée dans le payload OpenFisca, alors qu’une prestation simplement envisagée
reste à `null`.

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
  ]
}
```

`availableBenefits` liste les aides monétaires calculées par OpenFisca pour la
période en cours (mois ou année selon la variable). Seuls les montants
strictement positifs sont conservés.
