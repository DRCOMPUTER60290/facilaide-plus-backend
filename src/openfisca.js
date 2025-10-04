import fetch from "node-fetch";

/**
 * Envoie un payload JSON à OpenFisca
 */
export async function callOpenFisca(payload) {
  try {
    const response = await fetch(
      process.env.OPENFISCA_BASE_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`OpenFisca API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error("Erreur OpenFisca:", error.message);
    throw error;
  }
}
