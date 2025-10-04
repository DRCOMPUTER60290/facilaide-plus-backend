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
  "age": number | null,
  "age_conjoint": number | null,
  "nombre_enfants": number | null,
  "enfants": [
    { "age": number | null }
  ],
  "revenu": {
    "demandeur": { "salaire_de_base": number | null },
    "conjoint": { "salaire_de_base": number | null }
  },
  "situation": {
    "demandeur": { "age": number | null },
    "conjoint": { "age": number | null },
    "enfants": [ { "age": number | null } ]
  }
}
- Chaque champ doit être présent, même si sa valeur est null.
- Utilise null si l'information n'est pas fournie par l'utilisateur.
- Ne mets pas de texte explicatif.
- Ne mets pas de balises Markdown (\`\`\`json).
- Ne renvoie que du JSON brut (objet { ... }).
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


