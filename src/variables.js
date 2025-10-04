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

function backfillPreviousMonths(periodValues, monthsToBackfill = 3) {
  if (!periodValues || typeof periodValues !== "object") {
    return periodValues;
  }

  const periodKeys = Object.keys(periodValues);
  if (periodKeys.length === 0) {
    return periodValues;
  }

  const referenceMonth = periodKeys[0];
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
    return periodValues;
  }

  const referenceDate = new Date(`${referenceMonth}-01T00:00:00Z`);
  if (Number.isNaN(referenceDate.getTime())) {
    return periodValues;
  }

  const referenceValue = periodValues[referenceMonth];
  const filledPeriods = {};

  for (let offset = monthsToBackfill; offset >= 1; offset -= 1) {
    const date = new Date(referenceDate);
    date.setUTCMonth(date.getUTCMonth() - offset);
    const periodKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (Object.prototype.hasOwnProperty.call(periodValues, periodKey)) {
      filledPeriods[periodKey] = periodValues[periodKey];
    } else {
      filledPeriods[periodKey] = referenceValue;
    }
  }

  periodKeys.forEach((key) => {
    filledPeriods[key] = periodValues[key];
  });

  return filledPeriods;
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

function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedItems = value.map((item) => stableStringify(item));
    return `[${serializedItems.join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const serializedEntries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`
  );
  return `{${serializedEntries.join(",")}}`;
}

const BENEFIT_NAME_ALIASES = {
  aah: [
    "aah",
    "allocation adulte handicapee",
    "allocation adulte handicapée",
    "allocation aux adultes handicapes",
    "allocation aux adultes handicapés"
  ],
  rsa: [
    "rsa",
    "revenu de solidarite active",
    "revenu de solidarité active"
  ],
  aide_logement: [
    "aide au logement",
    "aide logement",
    "allocation logement",
    "apl",
    "aide_logement",
    "aides au logement"
  ],
  af: [
    "allocations familiales",
    "allocation familiale",
    "af"
  ]
};

const BENEFICIARY_ALIASES = {
  demandeur: [
    "demandeur",
    "demandeuse",
    "applicant",
    "individu 1",
    "individu1",
    "titulaire",
    "moi",
    "adulte 1",
    "personne 1",
    "beneficiaire principal",
    "bénéficiaire principal"
  ],
  conjoint: [
    "conjoint",
    "conjointe",
    "epoux",
    "époux",
    "epouse",
    "épouse",
    "partenaire",
    "individu 2",
    "individu2",
    "adulte 2",
    "personne 2",
    "compagnon",
    "compagne"
  ],
  menage: [
    "menage",
    "ménage",
    "household",
    "famille",
    "famille 1",
    "foyer",
    "foyer familial",
    "couple",
    "nous",
    "menage 1",
    "ménage 1"
  ]
};

function normalizeTextForMatching(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchAlias(aliases, value) {
  const normalized = normalizeTextForMatching(value);
  if (!normalized) {
    return null;
  }

  for (const [canonical, variants] of Object.entries(aliases)) {
    if (normalized === canonical) {
      return canonical;
    }
    if (variants.includes(normalized)) {
      return canonical;
    }
  }

  return null;
}

function normalizeBeneficiary(value) {
  return matchAlias(BENEFICIARY_ALIASES, value);
}

function normalizeBenefitName(value) {
  return matchAlias(BENEFIT_NAME_ALIASES, value);
}

function looksLikePrestationItem(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const keys = Object.keys(value);
  return ["nom", "name", "prestation", "type", "benefit"].some((key) =>
    keys.includes(key)
  ) ||
    [
      "beneficiaire",
      "beneficiary",
      "personne",
      "personne_concernee",
      "cible",
      "beneficiaire_principal"
    ].some((key) => keys.includes(key)) ||
    ["montant", "amount", "valeur", "value", "quantite", "somme", "montants"].some(
      (key) => keys.includes(key)
    );
}

function createEmptyPrestationsContainer() {
  return {
    demandeur: {},
    conjoint: {},
    menage: {}
  };
}

function registerPrestation(container, beneficiary, benefit, amount) {
  if (!beneficiary || !benefit) {
    return;
  }

  if (!container[beneficiary]) {
    container[beneficiary] = {};
  }

  container[beneficiary][benefit] = {
    mentionnee: true,
    montant: amount === undefined ? null : amount
  };
}

function buildPrestationEntryFromObject(item, context) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const rawBeneficiary =
    item.beneficiaire ??
    item.beneficiary ??
    item.personne ??
    item.personne_concernee ??
    item.cible ??
    item.beneficiaire_principal ??
    context.beneficiary;
  const beneficiary = normalizeBeneficiary(rawBeneficiary);

  const rawBenefit =
    item.nom ??
    item.name ??
    item.prestation ??
    item.prestation_nom ??
    item.type ??
    item.benefit ??
    context.benefit;
  const benefit = normalizeBenefitName(rawBenefit);

  if (!beneficiary || !benefit) {
    return null;
  }

  const rawAmount =
    item.montant ??
    item.amount ??
    item.valeur ??
    item.value ??
    item.quantite ??
    item.somme ??
    item.montants;
  const amount = toNumber(rawAmount);

  return {
    beneficiary,
    benefit,
    amount: amount ?? null
  };
}

function traversePrestationsValue(value, context, entries) {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => traversePrestationsValue(item, context, entries));
    return;
  }

  if (typeof value === "object") {
    if (looksLikePrestationItem(value)) {
      const entry = buildPrestationEntryFromObject(value, context);
      if (entry) {
        entries.push(entry);
      }
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      const beneficiaryCandidate = normalizeBeneficiary(key);
      const benefitCandidate = normalizeBenefitName(key);
      const nextContext = { ...context };
      if (beneficiaryCandidate && !nextContext.beneficiary) {
        nextContext.beneficiary = beneficiaryCandidate;
      } else if (benefitCandidate && !nextContext.benefit) {
        nextContext.benefit = benefitCandidate;
      }
      traversePrestationsValue(child, nextContext, entries);
    });
    return;
  }

  if (
    (typeof value === "number" || typeof value === "string") &&
    context.beneficiary &&
    context.benefit
  ) {
    const amount = toNumber(value);
    entries.push({
      beneficiary: context.beneficiary,
      benefit: context.benefit,
      amount: amount ?? null
    });
  }
}

function collectPrestations(value) {
  const entries = [];
  traversePrestationsValue(value, {}, entries);
  return entries;
}

function extractPrestations(source, paths) {
  const entries = [];
  const seenKeys = new Set();

  paths.forEach((path) => {
    const value = getNestedValue(source, path);
    if (value !== undefined && value !== null) {
      collectPrestations(value).forEach((entry) => {
        const key = `${entry.beneficiary}::${entry.benefit}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          entries.push(entry);
        }
      });
    }
  });

  return entries;
}

function buildPrestationsContainerFromEntries(entries) {
  const container = createEmptyPrestationsContainer();
  entries.forEach(({ beneficiary, benefit, amount }) => {
    registerPrestation(container, beneficiary, benefit, amount);
  });
  return container;
}

function getPrestationEntry(container, beneficiary, benefit) {
  if (!container || !beneficiary || !benefit) {
    return undefined;
  }

  const data = container[beneficiary]?.[benefit];
  if (data === undefined) {
    return undefined;
  }

  if (data && typeof data === "object") {
    const montant = Object.prototype.hasOwnProperty.call(data, "montant")
      ? data.montant
      : undefined;
    const mentionnee = Object.prototype.hasOwnProperty.call(data, "mentionnee")
      ? data.mentionnee
      : true;
    return {
      mentionnee,
      montant: montant === undefined ? null : montant
    };
  }

  if (typeof data === "number" || data === null) {
    return {
      mentionnee: true,
      montant: data
    };
  }

  return undefined;
}

function getPrestationPayloadAmount(entry) {
  if (!entry) {
    return null;
  }

  return entry.montant === undefined || entry.montant === null
    ? 0
    : entry.montant;
}

function normalizeUserInput(rawJson = {}) {
  const source = rawJson && typeof rawJson === "object" ? rawJson : {};

  const prestationsRecuesEntries = extractPrestations(source, [
    ["prestations_recues"],
    ["prestations", "recues"],
    ["prestations", "perçues"],
    ["prestations", "percues"],
    ["aides", "recues"]
  ]);

  const prestationsRecues = buildPrestationsContainerFromEntries(
    prestationsRecuesEntries
  );

  const prestationsADemanderEntries = extractPrestations(source, [
    ["prestations_a_demander"],
    ["prestations", "a_demander"],
    ["prestations", "souhaitees"],
    ["prestations", "souhaitées"],
    ["aides", "a_demander"]
  ]);

  const prestationsADemander = buildPrestationsContainerFromEntries(
    prestationsADemanderEntries
  );

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

  const rawAahDemandeur = getValueByPaths(source, [
    ["aah"],
    ["prestations", "aah"],
    ["prestations", "demandeur", "aah"],
    ["prestations", "demandeur", "montant_aah"],
    ["prestations", "demandeur", "allocation_adulte_handicapee"],
    ["prestations", "demandeur", "allocation_aux_adultes_handicapes"],
    ["prestations_demandeur", "aah"],
    ["prestations_demandeur", "allocation_adulte_handicapee"],
    ["revenu", "demandeur", "aah"],
    ["revenus", "demandeur", "aah"],
    ["demandeur", "prestations", "aah"],
    ["demandeur", "aah"],
    ["personnes", "demandeur", "aah"]
  ]);

  const rawAahConjoint = getValueByPaths(source, [
    ["aah_conjoint"],
    ["prestations", "aah_conjoint"],
    ["prestations", "conjoint", "aah"],
    ["prestations", "conjoint", "montant_aah"],
    ["prestations", "conjoint", "allocation_adulte_handicapee"],
    ["prestations", "conjoint", "allocation_aux_adultes_handicapes"],
    ["prestations_conjoint", "aah"],
    ["prestations_conjoint", "allocation_adulte_handicapee"],
    ["revenu", "conjoint", "aah"],
    ["revenus", "conjoint", "aah"],
    ["conjoint", "prestations", "aah"],
    ["conjoint", "aah"],
    ["personnes", "conjoint", "aah"]
  ]);

  let aahDemandeur = null;
  const recuAahDemandeurEntry = getPrestationEntry(
    prestationsRecues,
    "demandeur",
    "aah"
  );
  if (recuAahDemandeurEntry) {
    aahDemandeur = getPrestationPayloadAmount(recuAahDemandeurEntry);
  } else {
    const parsedAahDemandeur = toNumber(rawAahDemandeur);
    if (parsedAahDemandeur !== undefined) {
      aahDemandeur = parsedAahDemandeur;
      registerPrestation(
        prestationsRecues,
        "demandeur",
        "aah",
        parsedAahDemandeur
      );
    }
  }

  let aahConjoint = null;
  const recuAahConjointEntry = getPrestationEntry(
    prestationsRecues,
    "conjoint",
    "aah"
  );
  if (recuAahConjointEntry) {
    aahConjoint = getPrestationPayloadAmount(recuAahConjointEntry);
  } else {
    const parsedAahConjoint = toNumber(rawAahConjoint);
    if (parsedAahConjoint !== undefined) {
      aahConjoint = parsedAahConjoint;
      registerPrestation(
        prestationsRecues,
        "conjoint",
        "aah",
        parsedAahConjoint
      );
    }
  }

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
  const seenChildSignatures = new Set();
  childPaths.forEach((path) => {
    const value = getNestedValue(source, path);
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === "object") {
      if (seenChildContainers.has(value)) {
        return;
      }
      seenChildContainers.add(value);
    }

    let signature = null;
    try {
      signature = stableStringify(value);
    } catch (error) {
      signature = null;
    }

    if (signature && seenChildSignatures.has(signature)) {
      return;
    }

    if (signature) {
      seenChildSignatures.add(signature);
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

  let nombreEnfants;
  if (
    nombreEnfantsValeur !== undefined &&
    Number.isFinite(nombreEnfantsValeur) &&
    !Number.isNaN(nombreEnfantsValeur)
  ) {
    nombreEnfants = Math.max(0, Math.round(nombreEnfantsValeur));
  }

  if (nombreEnfants === undefined) {
    nombreEnfants = enfantsAges.length;
  }

  if (!Number.isFinite(nombreEnfants)) {
    nombreEnfants = 0;
  }

  if (enfantsAges.length > nombreEnfants) {
    enfantsAges.splice(nombreEnfants);
  }

  while (enfantsAges.length < nombreEnfants) {
    enfantsAges.push(5);
  }

  return {
    salaire_de_base: salaireDemandeur ?? 0,
    salaire_de_base_conjoint: salaireConjoint ?? 0,
    aah: aahDemandeur ?? null,
    aah_conjoint: aahConjoint ?? null,
    age: ageDemandeur ?? 30,
    age_conjoint: ageConjoint ?? 30,
    nombre_enfants: nombreEnfants,
    enfants: enfantsAges,
    prestations_recues: prestationsRecues,
    prestations_a_demander: prestationsADemander
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
    const safeValue = value === undefined ? null : value;

    if (periodicity === "year") {
      return { [currentYear]: safeValue };
    }

    const monthlyValues = { [currentMonth]: safeValue };

    if (periodicity === "month") {
      return backfillPreviousMonths(monthlyValues);
    }

    return monthlyValues;
  };

  const prestationsRecues =
    normalized.prestations_recues || createEmptyPrestationsContainer();

  // Récupérer les données utilisateur
  const salaire1 = normalized.salaire_de_base;
  const salaire2 = normalized.salaire_de_base_conjoint;
  const recuAah1 = getPrestationEntry(prestationsRecues, "demandeur", "aah");
  const recuAah2 = getPrestationEntry(prestationsRecues, "conjoint", "aah");
  const aah1 =
    recuAah1 && recuAah1.mentionnee
      ? getPrestationPayloadAmount(recuAah1)
      : normalized.aah;
  const aah2 =
    recuAah2 && recuAah2.mentionnee
      ? getPrestationPayloadAmount(recuAah2)
      : normalized.aah_conjoint;
  const age1 = normalized.age;
  const age2 = normalized.age_conjoint;
  const nbEnfants = normalized.nombre_enfants || 0;
  const enfantsAges = normalized.enfants || [];

  // Construire les individus
  const individus = {
    individu_1: {
      salaire_de_base: createPeriodValues("salaire_de_base", salaire1),
      age: createPeriodValues("age", age1),
      aah: createPeriodValues("aah", aah1 ?? null)
    },
    individu_2: {
      salaire_de_base: createPeriodValues("salaire_de_base", salaire2),
      age: createPeriodValues("age", age2),
      aah: createPeriodValues("aah", aah2 ?? null)
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

  const rsaEntry = getPrestationEntry(prestationsRecues, "menage", "rsa");
  const aideLogementEntry = getPrestationEntry(
    prestationsRecues,
    "menage",
    "aide_logement"
  );
  const afEntry = getPrestationEntry(prestationsRecues, "menage", "af");

  const familles = {
    famille_1: {
      parents: ["individu_1", "individu_2"],
      enfants: enfantsIds,
      rsa: createPeriodValues(
        "rsa",
        rsaEntry && rsaEntry.mentionnee
          ? getPrestationPayloadAmount(rsaEntry)
          : null
      ),
      aide_logement: createPeriodValues(
        "aide_logement",
        aideLogementEntry && aideLogementEntry.mentionnee
          ? getPrestationPayloadAmount(aideLogementEntry)
          : null
      ),
      af: createPeriodValues(
        "af",
        afEntry && afEntry.mentionnee ? getPrestationPayloadAmount(afEntry) : null
      )
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
