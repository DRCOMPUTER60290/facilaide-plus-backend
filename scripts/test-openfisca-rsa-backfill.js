import assert from "node:assert/strict";
import { buildOpenFiscaPayload } from "../src/variables.js";
import { callOpenFisca } from "../src/openfisca.js";

const baseUrl =
  process.env.OPENFISCA_BASE_URL || "https://api.fr.openfisca.org/latest/calculate";
process.env.OPENFISCA_BASE_URL = baseUrl;

const userScenario = {
  age: 35,
  salaire_de_base: 800,
  salaire_de_base_conjoint: 0,
  nombre_enfants: 0,
  situation: {
    statut_marital: "celibataire"
  }
};

try {
  const payload = buildOpenFiscaPayload(userScenario);

  const result = await callOpenFisca(payload);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rsaPeriods = result?.entities?.familles?.famille_1?.rsa;
  assert(rsaPeriods, "Expected OpenFisca response to include famille_1.rsa values");

  const rsaEntry = rsaPeriods[currentMonth];
  assert.notStrictEqual(
    rsaEntry,
    undefined,
    `Expected an RSA value for period ${currentMonth} but received ${JSON.stringify(rsaPeriods)}`
  );

  const rsaValue =
    rsaEntry && typeof rsaEntry === "object" && "value" in rsaEntry
      ? rsaEntry.value
      : rsaEntry;

  assert.strictEqual(
    rsaValue,
    0,
    `Expected RSA to be zero after backfilling monthly incomes, but received ${rsaValue}`
  );

  console.log(
    "✅ RSA drops to zero when previous salary months are populated in the OpenFisca payload."
  );
} catch (error) {
  console.error("❌ RSA regression test failed:", error);
  process.exit(1);
}
