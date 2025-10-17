import test from "node:test";
import assert from "node:assert/strict";

import { extractRawJsonInput } from "../src/router.js";
import { buildOpenFiscaPayload } from "../src/variables.js";

test("extractRawJsonInput returns rawJson property when present", () => {
  const raw = { foo: "bar" };
  const result = extractRawJsonInput({ rawJson: raw });

  assert.strictEqual(result, raw);
});

test("extractRawJsonInput falls back to json property", () => {
  const raw = { baz: 42 };
  const result = extractRawJsonInput({ json: raw });

  assert.strictEqual(result, raw);
});

test("extractRawJsonInput defaults to the body when no wrapper keys are provided", () => {
  const raw = { hello: "world" };
  const result = extractRawJsonInput(raw);

  assert.strictEqual(result, raw);
});

test("children remain attached when the incoming body uses the json wrapper", () => {
  const body = {
    json: {
      salaire_de_base: 400,
      nombre_enfants: 3,
      enfants: [
        { age: 15, prenom: "Léa" },
        { age: 10, prenom: "Hugo" },
        { age: 5, prenom: "Mila" }
      ]
    }
  };

  const rawJson = extractRawJsonInput(body);
  const payload = buildOpenFiscaPayload(rawJson);

  assert.deepEqual(payload?.familles?.famille_1?.enfants, [
    "enfant_1",
    "enfant_2",
    "enfant_3"
  ]);
  assert.deepEqual(Object.keys(payload?.individus || {}), [
    "individu_1",
    "enfant_1",
    "enfant_2",
    "enfant_3"
  ]);
});
