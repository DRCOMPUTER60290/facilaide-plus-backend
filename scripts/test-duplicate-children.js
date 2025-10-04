import { buildOpenFiscaPayload } from "../src/variables.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const duplicatedChildData = { age: 7, autre_champ: "ignored" };

const rawInput = {
  enfants: [duplicatedChildData],
  situation: {
    enfants: [{ age: 7, autre_champ: "ignored" }],
    personnes: {
      enfants: [{ age: 7, autre_champ: "ignored" }]
    }
  },
  menage: {
    enfants: [
      {
        age: 7,
        details: [
          {
            age: 7
          }
        ]
      }
    ]
  },
  nombre_enfants: 1
};

const payload = buildOpenFiscaPayload(rawInput);

const enfantKeys = Object.keys(payload.individus).filter((key) => key.startsWith("enfant_"));

assert(
  enfantKeys.length === 1,
  `Expected a single child in payload.individus but found ${enfantKeys.length}: ${enfantKeys.join(", ")}`
);

assert(
  enfantKeys[0] === "enfant_1",
  `Expected the lone child to be "enfant_1" but received "${enfantKeys[0]}"`
);

const enfant1AgeEntry = payload.individus.enfant_1?.age;

assert(
  enfant1AgeEntry && typeof enfant1AgeEntry === "object" && Object.keys(enfant1AgeEntry).length === 1,
  "Expected enfant_1 to have exactly one age entry"
);

console.log("✅ Duplicate child sources are ignored. enfant_1 is the only child created.");
