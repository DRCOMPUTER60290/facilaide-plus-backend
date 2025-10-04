import fs from "fs";
import path from "path";
import Ajv from "ajv";

// Charger le fichier meta (au cas où on en a besoin plus tard)
const filePath = path.resolve("openfiscaVariablesMeta.json");
let variablesMeta = {};
try {
  variablesMeta = JSON.parse(fs.readFileSync(filePath, "utf-8"));
} catch (e) {
  console.warn("⚠️ Impossible de charger openfiscaVariablesMeta.json, on utilisera des règles simplifiées.");
}

function allowNullInAdditionalProperties(schemaNode, insideAdditionalProps = false) {
  if (!schemaNode || typeof schemaNode !== "object") {
    return;
  }

  const ensureNullType = () => {
    if (Array.isArray(schemaNode.type)) {
      if (!schemaNode.type.includes("null")) {
        schemaNode.type = [...schemaNode.type, "null"];
      }
    } else if (schemaNode.type === "number") {
      schemaNode.type = ["number", "null"];
    }
  };

  if (insideAdditionalProps) {
    ensureNullType();
  }

  if (schemaNode.additionalProperties) {
    allowNullInAdditionalProperties(schemaNode.additionalProperties, true);
  }

  if (schemaNode.properties) {
    Object.values(schemaNode.properties).forEach((child) =>
      allowNullInAdditionalProperties(child, false)
    );
  }

  if (schemaNode.items) {
    allowNullInAdditionalProperties(schemaNode.items, false);
  }

  ["anyOf", "allOf", "oneOf"].forEach((keyword) => {
    if (Array.isArray(schemaNode[keyword])) {
      schemaNode[keyword].forEach((child) =>
        allowNullInAdditionalProperties(child, insideAdditionalProps)
      );
    }
  });
}

const specPath = path.resolve("specopenfisca.json");
let validateSituationInput = null;

try {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
  const schemas = spec?.components?.schemas || {};

  if (Object.keys(schemas).length > 0) {
    const ajv = new Ajv({ allErrors: true, strict: false });

    Object.entries(schemas).forEach(([name, schema]) => {
      const schemaCopy = { ...schema };
      allowNullInAdditionalProperties(schemaCopy, false);
      if (!schemaCopy.$id) {
        schemaCopy.$id = `#/components/schemas/${name}`;
      }
      ajv.addSchema(schemaCopy);
    });

    validateSituationInput =
      ajv.getSchema("#/components/schemas/SituationInput") ||
      ajv.compile({ $ref: "#/components/schemas/SituationInput" });
  }
} catch (error) {
  console.warn(
    "⚠️ Impossible de préparer la validation SituationInput depuis specopenfisca.json. La validation sera ignorée.",
    error
  );
}

/**
 * Génère une clé de période au bon format
 * - month → "2025-10"
 * - year → "2025"
 */
function formatPeriodicity(periodicity) {
  const now = new Date();
  if (periodicity === "month") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  if (periodicity === "year") {
    return `${now.getFullYear()}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, ".").trim();
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function getNestedValue(obj, path) {
  return path.reduce((acc, key) => {
    if (acc === undefined || acc === null) {
      return undefined;
    }
    return acc[key];
  }, obj);
}

function getValueByPaths(obj, paths) {
  for (const path of paths) {
    const value = getNestedValue(obj, path);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function extractChildAgesFromValue(value) {
  const ages = [];

  const pushAge = (candidate) => {
    const num = toNumber(candidate);
    if (num !== undefined) {
      ages.push(num);
    }
  };

  const inspectItem = (item) => {
    if (item === undefined || item === null) {
      return;
    }

    if (Array.isArray(item)) {
      item.forEach((child) => inspectItem(child));
      return;
    }

    if (typeof item === "number" || typeof item === "string") {
      pushAge(item);
      return;
    }

    if (typeof item === "object") {
      if (Object.prototype.hasOwnProperty.call(item, "age")) {
        pushAge(item.age);
      }
      if (Object.prototype.hasOwnProperty.call(item, "age_enfant")) {
        pushAge(item.age_enfant);
      }
      if (Object.prototype.hasOwnProperty.call(item, "valeur")) {
        pushAge(item.valeur);
      }
      if (Object.prototype.hasOwnProperty.call(item, "value")) {
        pushAge(item.value);
      }

      if (Array.isArray(item.enfants)) {
        item.enfants.forEach((child) => inspectItem(child));
      }

      if (Array.isArray(item.children)) {
        item.children.forEach((child) => inspectItem(child));
      }

      if (Array.isArray(item.details)) {
        item.details.forEach((child) => inspectItem(child));
      }

      Object.entries(item).forEach(([key, child]) => {
        if (/^enfant_\d+$/.test(key)) {
          inspectItem(child);
        }
      });
    }
  };

  inspectItem(value);
  return ages;
}

function normalizeUserInput(rawJson = {}) {
  const source = rawJson && typeof rawJson === "object" ? rawJson : {};

  const salaireDemandeur = toNumber(
    getValueByPaths(source, [
      ["salaire_de_base"],
      ["revenu", "salaire_de_base"],
      ["revenus", "salaire_de_base"],
      ["revenu", "demandeur", "salaire_de_base"],
      ["revenus", "demandeur", "salaire_de_base"],
      ["situation", "revenu", "demandeur", "salaire_de_base"],
      ["situation", "demandeur", "revenu", "salaire_de_base"],
      ["personnes", "demandeur", "revenu", "salaire_de_base"],
      ["demandeur", "revenu", "salaire_de_base"],
      ["demandeur", "salaire_de_base"]
    ])
  );

  const salaireConjoint = toNumber(
    getValueByPaths(source, [
      ["salaire_de_base_conjoint"],
      ["revenu", "salaire_de_base_conjoint"],
      ["revenu", "conjoint", "salaire_de_base"],
      ["revenus", "conjoint", "salaire_de_base"],
      ["situation", "revenu", "conjoint", "salaire_de_base"],
      ["situation", "conjoint", "revenu", "salaire_de_base"],
      ["personnes", "conjoint", "revenu", "salaire_de_base"],
      ["conjoint", "revenu", "salaire_de_base"],
      ["conjoint", "salaire_de_base"]
    ])
  );

  const ageDemandeur = toNumber(
    getValueByPaths(source, [
      ["age"],
      ["situation", "age"],
      ["situation", "demandeur", "age"],
      ["personnes", "demandeur", "age"],
      ["demandeur", "age"]
    ])
  );

  const ageConjoint = toNumber(
    getValueByPaths(source, [
      ["age_conjoint"],
      ["situation", "age_conjoint"],
      ["situation", "conjoint", "age"],
      ["personnes", "conjoint", "age"],
      ["conjoint", "age"]
    ])
  );

  const childPaths = [
    ["enfants"],
    ["situation", "enfants"],
    ["situation", "personnes", "enfants"],
    ["situation", "foyer", "enfants"],
    ["personnes", "enfants"],
    ["menage", "enfants"]
  ];

  const enfantsAges = [];
  const pushChildAge = (age) => {
    if (age !== undefined) {
      enfantsAges.push(age);
    }
  };

  const seenChildContainers = new WeakSet();
  childPaths.forEach((path) => {
    const value = getNestedValue(source, path);
    if (value && typeof value === "object") {
      if (seenChildContainers.has(value)) {
        return;
      }
      seenChildContainers.add(value);
    }
    extractChildAgesFromValue(value).forEach(pushChildAge);
  });

  const indexedChildEntries = Object.entries(source)
    .filter(([key]) => /^age_enfant_\d+$/.test(key))
    .sort(
      ([keyA], [keyB]) =>
        parseInt(keyA.split("_").pop(), 10) - parseInt(keyB.split("_").pop(), 10)
    );

  indexedChildEntries.forEach(([, value]) => {
    const age = toNumber(value);
    if (age !== undefined) {
      enfantsAges.push(age);
    }
  });

  const nombreEnfantsValeur = toNumber(
    getValueByPaths(source, [
      ["nombre_enfants"],
      ["situation", "nombre_enfants"],
      ["enfants", "nombre"],
      ["enfants", "count"],
      ["situation", "enfants", "nombre"],
      ["menage", "nombre_enfants"],
      ["personnes", "nombre_enfants"]
    ])
  );

  let nombreEnfants =
    nombreEnfantsValeur !== undefined ? Math.max(0, Math.round(nombreEnfantsValeur)) : undefined;

  if (nombreEnfants === undefined) {
    nombreEnfants = enfantsAges.length;
  }

  if (!Number.isFinite(nombreEnfants)) {
    nombreEnfants = 0;
  }

  if (enfantsAges.length > nombreEnfants) {
    nombreEnfants = enfantsAges.length;
  }

  while (enfantsAges.length < nombreEnfants) {
    enfantsAges.push(5);
  }

  return {
    salaire_de_base: salaireDemandeur ?? 0,
    salaire_de_base_conjoint: salaireConjoint ?? 0,
    age: ageDemandeur ?? 30,
    age_conjoint: ageConjoint ?? 30,
    nombre_enfants: nombreEnfants,
    enfants: enfantsAges
  };
}

/**
 * Construit un payload OpenFisca complet à partir d’un rawJson simplifié
 */
export function buildOpenFiscaPayload(rawJson) {
  const normalized = normalizeUserInput(rawJson);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentYear = `${now.getFullYear()}`;

  const monthVariables = new Set(
    Object.entries(variablesMeta)
      .filter(([, meta]) => meta?.periodicity === "month")
      .map(([name]) => name)
  );

  const createPeriodValues = (variableName, value) => {
    const periodicity = variablesMeta?.[variableName]?.periodicity;

    if (periodicity === "year") {
      return { [currentYear]: value };
    }

    return { [currentMonth]: value };
  };

  // Récupérer les données utilisateur
  const salaire1 = normalized.salaire_de_base;
  const salaire2 = normalized.salaire_de_base_conjoint;
  const age1 = normalized.age;
  const age2 = normalized.age_conjoint;
  const nbEnfants = normalized.nombre_enfants || 0;
  const enfantsAges = normalized.enfants || [];

  // Construire les individus
  const individus = {
    individu_1: {
      salaire_de_base: createPeriodValues("salaire_de_base", salaire1),
      age: createPeriodValues("age", age1),
      aah: createPeriodValues("aah", null)
    },
    individu_2: {
      salaire_de_base: createPeriodValues("salaire_de_base", salaire2),
      age: createPeriodValues("age", age2),
      aah: createPeriodValues("aah", null)
    }
  };

  // Ajouter les enfants
  for (let i = 1; i <= nbEnfants; i++) {
    const ageEnfant = enfantsAges[i - 1] ?? rawJson?.[`age_enfant_${i}`] ?? 5;
    individus[`enfant_${i}`] = {
      age: createPeriodValues("age", ageEnfant)
    };
  }

  if (monthVariables.size > 0) {
    Object.values(individus).forEach((individu) => {
      Object.entries(individu).forEach(([variableName, periodValues]) => {
        if (
          monthVariables.has(variableName) &&
          periodValues &&
          typeof periodValues === "object" &&
          Object.prototype.hasOwnProperty.call(periodValues, currentYear)
        ) {
          throw new Error(
            `La variable "${variableName}" est mensuelle et ne doit pas être indexée avec currentYear.`
          );
        }
      });
    });
  }

  // Construire familles, menages et foyers fiscaux
  const enfantsIds = Array.from({ length: nbEnfants }, (_, i) => `enfant_${i + 1}`);

  const familles = {
    famille_1: {
      parents: ["individu_1", "individu_2"],
      enfants: enfantsIds,
      rsa: createPeriodValues("rsa", null),
      aide_logement: createPeriodValues("aide_logement", null),
      af: createPeriodValues("af", null)
    }
  };

  const foyers_fiscaux = {
    foyer_fiscal_1: {
      declarants: ["individu_1", "individu_2"],
      personnes_a_charge: enfantsIds
    }
  };

  const menages = {
    menage_1: {
      personne_de_reference: ["individu_1"],
      conjoint: ["individu_2"],
      enfants: enfantsIds
    }
  };

  // Retourner le payload plat attendu par OpenFisca
  const payload = {
    individus,
    familles,
    foyers_fiscaux,
    menages
  };

  if (validateSituationInput && !validateSituationInput(payload)) {
    const errors = validateSituationInput.errors || [];
    const formattedErrors = errors
      .map((err) => {
        const pathMessage = err.instancePath ? `${err.instancePath} ` : "";
        return `${pathMessage}${err.message}`;
      })
      .join("; ");

    throw new Error(
      `Le payload généré ne respecte pas le schéma SituationInput d'OpenFisca: ${formattedErrors}`
    );
  }

  return payload;
}
