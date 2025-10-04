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
        { role: "system", content: "Tu es un assistant social. Analyse le texte et génère uniquement un JSON brut de variables (clé = nom OpenFisca, valeur = nombre ou texte). Ne donne jamais d’explications." },
        { role: "user", content: userMessage }
      ]
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Erreur OpenAI:", error.message);
    throw error;
  }
}
