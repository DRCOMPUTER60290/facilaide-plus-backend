import express from "express";
import { callOpenAI } from "./openai.js";
import { callOpenFisca } from "./openfisca.js";
import { buildOpenFiscaPayload } from "./variables.js";

const router = express.Router();

/**
 * Test simple
 */
router.get("/", (req, res) => {
  res.json({ message: "API FacilAide+ OK" });
});

/**
 * Étape 1 : Génération du JSON brut à partir du texte utilisateur
 */
router.post("/generate-json", async (req, res) => {
  try {
    const { message } = req.body;
    const jsonResult = await callOpenAI(message);

    res.json({ json: jsonResult });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Étape 2 : Transformation + envoi à OpenFisca
 */
router.post("/simulate", async (req, res) => {
  try {
    const { rawJson } = req.body;

    // Transformer avec openfiscaVariablesMeta.json
    const payload = buildOpenFiscaPayload(rawJson);

    // Envoi à OpenFisca
    const result = await callOpenFisca(payload);
    res.json({ payload, result });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
