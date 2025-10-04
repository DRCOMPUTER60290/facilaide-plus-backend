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
