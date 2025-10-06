import express from "express";
import { callOpenAI, describeOpenFiscaResult } from "./openai.js";
import { callOpenFisca } from "./openfisca.js";
import { buildOpenFiscaPayload } from "./variables.js";
import extractAvailableBenefits from "./benefits.js";

const DEFAULT_PERSON_LABELS = {
  individu_1: "le demandeur",
  individu_2: "le conjoint"
};

const NAME_KEY_REGEXES = [
  /prenom/i,
  /prénom/i,
  /first[_-]?name/i,
  /given[_-]?name/i
];

const SECONDARY_NAME_KEY_REGEXES = [/nom/i, /name/i];

function getNestedValue(source, path = []) {
  let current = source;

  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof key === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[key];
      continue;
    }

    if (Array.isArray(current) && /^\d+$/.test(String(key))) {
      const index = Number.parseInt(key, 10);
      current = current[index];
      continue;
    }

    current = current[key];
  }

  return current;
}

function extractNameCandidate(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function findNameInObject(objectLike, regexes = NAME_KEY_REGEXES) {
  if (!objectLike || typeof objectLike !== "object") {
    return undefined;
  }

  for (const regex of regexes) {
    for (const [key, value] of Object.entries(objectLike)) {
      if (regex.test(key)) {
        const candidate = extractNameCandidate(value);
        if (candidate) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function findRoleName(rawJson = {}, role) {
  if (!role) {
    return undefined;
  }

  const candidatePaths = [
    [`${role}_prenom`],
    [`${role}_prénom`],
    [`${role}_first_name`],
    [`${role}_firstname`],
    [`${role}_firstName`],
    [`${role}Prenom`],
    [`${role}FirstName`],
    [`prenom_${role}`],
    [`first_name_${role}`],
    [`firstname_${role}`],
    [role, "prenom"],
    [role, "prénom"],
    [role, "first_name"],
    [role, "firstname"],
    [role, "firstName"],
    ["personnes", role, "prenom"],
    ["personnes", role, "prénom"],
    ["personnes", role, "first_name"],
    ["personnes", role, "firstname"],
    ["personnes", role, "firstName"],
    ["situation", role, "prenom"],
    ["situation", role, "first_name"],
    ["situation", role, "firstname"],
    ["situation", role, "firstName"],
    ["situation", "personnes", role, "prenom"],
    ["situation", "personnes", role, "first_name"],
    ["situation", "personnes", role, "firstname"],
    ["situation", "personnes", role, "firstName"],
    ["menage", role, "prenom"],
    ["menage", role, "first_name"],
    ["menage", role, "firstname"],
    ["menage", role, "firstName"],
    ["menage", "personnes", role, "prenom"],
    ["menage", "personnes", role, "first_name"],
    ["menage", "personnes", role, "firstname"],
    ["menage", "personnes", role, "firstName"]
  ];

  for (const path of candidatePaths) {
    const candidate = extractNameCandidate(getNestedValue(rawJson, path));
    if (candidate) {
      return candidate;
    }
  }

  const containers = [
    rawJson?.[role],
    rawJson?.personnes?.[role],
    rawJson?.situation?.[role],
    rawJson?.situation?.personnes?.[role],
    rawJson?.menage?.[role],
    rawJson?.menage?.personnes?.[role]
  ];

  for (const container of containers) {
    const candidate = findNameInObject(container, NAME_KEY_REGEXES);
    if (candidate) {
      return candidate;
    }
  }

  for (const container of containers) {
    const candidate = findNameInObject(container, SECONDARY_NAME_KEY_REGEXES);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function findChildName(rawJson = {}, index) {
  if (index === undefined || index === null) {
    return undefined;
  }

  const childNumber = index + 1;
  const candidatePaths = [
    [`enfant_${childNumber}_prenom`],
    [`enfant${childNumber}_prenom`],
    [`prenom_enfant_${childNumber}`],
    [`first_name_enfant_${childNumber}`],
    [`enfant_${childNumber}`, "prenom"],
    [`enfant_${childNumber}`, "first_name"],
    [`enfant_${childNumber}`, "firstname"],
    ["enfant", childNumber - 1, "prenom"],
    ["enfant", childNumber - 1, "first_name"],
    ["enfant", childNumber - 1, "firstname"],
    ["enfants", childNumber - 1],
    ["enfants", childNumber - 1, "prenom"],
    ["enfants", childNumber - 1, "first_name"],
    ["enfants", childNumber - 1, "firstname"],
    ["situation", "enfants", childNumber - 1],
    ["situation", "enfants", childNumber - 1, "prenom"],
    ["situation", "enfants", childNumber - 1, "first_name"],
    ["situation", "enfants", childNumber - 1, "firstname"],
    ["personnes", "enfants", childNumber - 1, "prenom"],
    ["personnes", "enfants", childNumber - 1, "first_name"],
    ["personnes", "enfants", childNumber - 1, "firstname"],
    ["menage", "enfants", childNumber - 1, "prenom"],
    ["menage", "enfants", childNumber - 1, "first_name"],
    ["menage", "enfants", childNumber - 1, "firstname"]
  ];

  for (const path of candidatePaths) {
    const candidate = extractNameCandidate(getNestedValue(rawJson, path));
    if (candidate) {
      return candidate;
    }
  }

  const arraysToInspect = [
    rawJson?.enfants,
    rawJson?.situation?.enfants,
    rawJson?.personnes?.enfants,
    rawJson?.menage?.enfants
  ];

  for (const arrayLike of arraysToInspect) {
    if (!Array.isArray(arrayLike)) {
      continue;
    }

    const item = arrayLike[index];
    if (!item) {
      continue;
    }

    if (typeof item === "string") {
      const candidate = extractNameCandidate(item);
      if (candidate) {
        return candidate;
      }
    }

    if (typeof item === "object") {
      const candidate =
        findNameInObject(item, NAME_KEY_REGEXES) ||
        findNameInObject(item, SECONDARY_NAME_KEY_REGEXES);
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

function buildPersonLabels(rawJson = {}, payload = {}) {
  const labels = { ...DEFAULT_PERSON_LABELS };

  const individu1Name = findRoleName(rawJson, "demandeur");
  if (individu1Name) {
    labels.individu_1 = individu1Name;
  }

  const individu2Name = findRoleName(rawJson, "conjoint");
  if (individu2Name) {
    labels.individu_2 = individu2Name;
  }

  const individus = payload?.individus || {};
  const childKeys = Object.keys(individus).filter((key) => /^enfant_\d+$/.test(key));

  childKeys.forEach((key) => {
    const match = key.match(/_(\d+)$/);
    const childIndex = match ? Number.parseInt(match[1], 10) - 1 : undefined;
    const childName = childIndex !== undefined ? findChildName(rawJson, childIndex) : undefined;

    if (childName) {
      labels[key] = childName;
    } else {
      labels[key] = `enfant ${match ? match[1] : ""}`.trim();
    }
  });

  return labels;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalizeFirst(value) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildTokenVariants(token) {
  const variants = new Set([token]);
  const spaceVariant = token.replace(/_/g, " ");
  const hyphenVariant = token.replace(/_/g, "-");
  const compactVariant = token.replace(/_/g, "");

  variants.add(spaceVariant);
  variants.add(hyphenVariant);
  variants.add(compactVariant);

  const match = token.match(/^(.*)_(\d+)$/);
  if (match) {
    const [, base, number] = match;
    variants.add(`${base} ${number}`);
    variants.add(`${base} n° ${number}`);
    variants.add(`${base} nº ${number}`);
    variants.add(`${base} no ${number}`);
    variants.add(`${base} numero ${number}`);
    variants.add(`${base} numéro ${number}`);
  }

  return Array.from(variants).filter(Boolean);
}

function formatExplanation(explanation, personLabels = {}) {
  if (typeof explanation !== "string") {
    return explanation;
  }

  let formatted = explanation.replace(/\\n/g, " ");
  formatted = formatted.replace(/\r?\n/g, " ");
  formatted = formatted.replace(/\s+/g, " ").trim();

  Object.entries(personLabels).forEach(([token, label]) => {
    if (!label) {
      return;
    }

    const variants = buildTokenVariants(token);

    variants.forEach((variant) => {
      const pattern = new RegExp(escapeRegExp(variant), "gi");
      formatted = formatted.replace(pattern, (match) => {
        const trimmedMatch = match.trim();
        if (/^[A-ZÀ-Ý]/.test(trimmedMatch)) {
          return capitalizeFirst(label);
        }
        return label;
      });
    });
  });

  return formatted;
}

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
    const { individus, familles, foyers_fiscaux, menages } = buildOpenFiscaPayload(rawJson);

    const payload = {
      individus,
      familles,
      foyers_fiscaux,
      menages
    };

    const personLabels = buildPersonLabels(rawJson, payload);

    // Envoi à OpenFisca
    const result = await callOpenFisca(payload);
    const availableBenefits = extractAvailableBenefits(result, payload);

    let explanation = null;
    try {
      explanation = await describeOpenFiscaResult(result, availableBenefits, {
        personLabels
      });
      if (explanation) {
        explanation = formatExplanation(explanation, personLabels);
      }
    } catch (error) {
      console.error("Impossible de générer l'explication en langage naturel:", error.message);
      explanation = null;
    }

    res.json({ payload, result, availableBenefits, explanation });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
