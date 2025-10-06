import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Génère un JSON brut avec OpenAI à partir d’un message utilisateur
 */
export async function callOpenAI(userMessage) {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Tu es un assistant social.
Analyse le texte utilisateur et génère uniquement un objet JSON **valide** qui respecte strictement le schéma ci-dessous :
{
  "salaire_de_base": number | null,
  "salaire_de_base_conjoint": number | null,
  "aah": number | null, // Allocation aux adultes handicapés du demandeur (prestation sociale, distincte d'un salaire)
  "aah_conjoint": number | null, // Allocation aux adultes handicapés du conjoint (prestation sociale, distincte d'un salaire)
  "age": number | null,
  "age_conjoint": number | null,
  "date_naissance": string | null, // Format ISO AAAA-MM-JJ si connu
  "date_naissance_conjoint": string | null,
  "prenom_demandeur": string | null,
  "prenom_conjoint": string | null,
  "nombre_enfants": number | null,
  "enfants": [
    { "age": number | null, "date_naissance": string | null, "prenom": string | null }
  ],
  "prestations_recues": [
    {
      "beneficiaire": "demandeur" | "conjoint" | "menage", // Qui perçoit déjà l'aide
      "nom": string, // Exemples : "aah", "rsa", "aide_logement", "af"
      "montant": number | null, // Montant versé si précisé
      "commentaire": string | null // Informations complémentaires éventuelles
    }
  ],
  "prestations_a_demander": [
    {
      "beneficiaire": "demandeur" | "conjoint" | "menage", // Qui souhaite déposer une demande
      "nom": string,
      "montant": number | null,
      "commentaire": string | null
    }
  ],
  "logement": {
    "statut":
      "proprietaire" |
      "primo_accedant" |
      "locataire" |
      "locataire_hlm" |
      "locataire_meuble" |
      "locataire_foyer" |
      "heberge_gratuitement" |
      "sans_domicile" |
      "autre" | null,
    "commentaire": string | null // Détails textuels éventuels (ex: "locataire dans le privé")
  },
  "revenu": {
    "demandeur": { "salaire_de_base": number | null },
    "conjoint": { "salaire_de_base": number | null }
  },
  "situation": {
    "demandeur": { "age": number | null, "date_naissance": string | null, "prenom": string | null },
    "conjoint": { "age": number | null, "date_naissance": string | null, "prenom": string | null },
    "enfants": [ { "age": number | null, "date_naissance": string | null, "prenom": string | null } ]
  }
}
- Utilise impérativement "prestations_recues" pour les aides déjà perçues et "prestations_a_demander" pour celles seulement envisagées.
- Chaque champ doit être présent, même si sa valeur est null.
- Utilise null si l'information n'est pas fournie par l'utilisateur.
- Ne mets pas de texte explicatif.
- Ne mets pas de balises Markdown (\`\`\`json).
- Ne renvoie que du JSON brut (objet { ... }).
- Les dates de naissance doivent être exprimées au format ISO AAAA-MM-JJ lorsqu'elles sont connues.
- Utilise le champ "logement.statut" pour indiquer le statut d'occupation, en choisissant la valeur la plus précise disponible dans la liste proposée (utilise "autre" uniquement si aucune des valeurs ne correspond clairement).
- Renseigne "logement.statut" à null si l'information n'est pas fournie.
`
        },
        { role: "user", content: userMessage }
      ]
    });

    // Nettoyer la sortie si jamais il reste des backticks
    let output = response.choices[0].message.content.trim();
    output = output.replace(/```json|```/g, "").trim();

    return JSON.parse(output);

  } catch (error) {
    console.error("Erreur OpenAI:", error.message);
    throw error;
  }
}

/**
 * Résume en français un résultat OpenFisca pour l’utilisateur final.
 * Retourne null si la génération échoue ou si aucun texte n’est produit.
 */
export async function describeOpenFiscaResult(
  result,
  availableBenefits = [],
  options = {}
) {
  const stringify = (data) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error("Erreur de sérialisation pour describeOpenFiscaResult:", error.message);
      return "";
    }
  };

  const { personLabels = {} } = options || {};

  const personMappings = Object.entries(personLabels).map(([identifier, label]) => ({
    identifiant: identifier,
    libelle: label
  }));

  const additionalContext =
    personMappings.length > 0
      ? `\nCorrespondances entre identifiants techniques et prénoms ou libellés lisibles :\n${stringify(
          personMappings
        )}\nUtilise uniquement ces prénoms ou libellés dans ta réponse (par exemple remplace \"individu_1\" par le libellé associé) et n'utilise jamais les identifiants techniques.\n`
      : "";

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant social. Tu aides un conseiller à expliquer en français simple les résultats d'une simulation OpenFisca."
        },
        {
          role: "user",
          content: `Résume en français clair le résultat OpenFisca ci-dessous pour une personne qui ne connaît pas les termes techniques. Mentionne les aides pertinentes et les montants importants.
- Distingue explicitement les aides déjà perçues (dans "result") des aides potentielles (dans "availableBenefits").
- Si une aide majeure (RSA, allocations familiales, aide au logement/APL) est absente de "availableBenefits" ou vaut zéro dans "result", explique précisément pourquoi elle n'est pas accessible en t'appuyant sur les données du foyer (revenus y compris AAH, composition familiale, statut de logement, etc.).
- Appuie chaque explication d'inéligibilité sur les informations chiffrées ou catégorielles du foyer présentes dans les données fournies.
- Lorsque tu abordes les allocations familiales, rappelle qu'elles dépendent du nombre d'enfants à charge et signale explicitement l'absence d'éligibilité lorsqu'il n'y a qu'un seul enfant, sans invoquer les revenus ou le logement pour cette explication.
- N'émet aucune hypothèse lorsque les données ne permettent pas de justifier une inéligibilité : indique clairement que l'information manque plutôt que de spéculer.
- Si la liste "availableBenefits" est vide, indique explicitement qu'aucune aide supplémentaire n'est disponible pour cette situation sans laisser penser que les aides déjà perçues disparaissent.

Résultat complet:
${stringify(result)}

Aides disponibles:
${stringify(availableBenefits)}${additionalContext}
`
        }
      ],
      temperature: 0.7
    });

    const explanation = response?.choices?.[0]?.message?.content?.trim();
    return explanation || null;
  } catch (error) {
    console.error("Erreur OpenAI (describeOpenFiscaResult):", error.message);
    return null;
  }
}


