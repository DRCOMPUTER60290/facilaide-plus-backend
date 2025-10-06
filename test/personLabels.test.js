import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonLabels, formatExplanation } from "../src/router.js";

test("buildPersonLabels utilise les prénoms fournis dans rawJson", () => {
  const rawJson = {
    prenom_demandeur: "Alice",
    prenom_conjoint: "Bob",
    enfants: [
      { prenom: "Chloé", age: 6 }
    ]
  };

  const payload = {
    individus: {
      individu_1: {},
      individu_2: {},
      enfant_1: {}
    }
  };

  const labels = buildPersonLabels(rawJson, payload);

  assert.strictEqual(labels.individu_1, "Alice");
  assert.strictEqual(labels.individu_2, "Bob");
  assert.strictEqual(labels.enfant_1, "Chloé");

  const explanation = "Individu_1 et individu_2 ont aidé enfant_1.";
  const formatted = formatExplanation(explanation, labels);

  assert.strictEqual(formatted, "Alice et Bob ont aidé Chloé.");
});
