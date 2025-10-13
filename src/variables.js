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

export function getVariablesMeta() {
  return variablesMeta;
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

const DEFAULT_DEPCOM = "60100";

const TENANT_HOUSING_STATUS_CODES = new Set([
  "locataire_vide",
  "locataire_meuble",
  "locataire_hlm",
  "locataire_foyer"
]);

function isTenantHousingStatus(value) {
  return TENANT_HOUSING_STATUS_CODES.has(value);
}

function normalizeDepcomCandidate(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const stringified = String(Math.trunc(Math.abs(value)));
    if (!stringified) {
      return null;
    }
    return stringified.padStart(5, "0").slice(-5);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const sanitized = trimmed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

    const primaryMatch = sanitized.match(/(\d{2}[A-Z]\d{2}|\d{5})/);
    if (primaryMatch) {
      return primaryMatch[1];
    }

    const digits = sanitized.replace(/[^0-9]/g, "");
    if (!digits) {
      return null;
    }

    if (digits.length >= 5) {
      return digits.slice(0, 5);
    }

    return digits.padStart(5, "0");
  }

  if (typeof value === "object") {
    const prioritizedKeys = [
      "depcom",
      "code_insee",
      "codeInsee",
      "code",
      "value",
      "valeur"
    ];

    for (const key of prioritizedKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const extracted = normalizeDepcomCandidate(value[key]);
        if (extracted) {
          return extracted;
        }
      }
    }
  }

  return null;
}

function extractDepcom(source, logementSection) {
  const candidatePaths = [
    ["depcom"],
    ["code_insee"],
    ["codeInsee"],
    ["logement", "depcom"],
    ["logement", "code_insee"],
    ["logement", "codeInsee"],
    ["menage", "depcom"],
    ["menage", "code_insee"],
    ["menage", "codeInsee"],
    ["situation", "depcom"],
    ["situation", "code_insee"],
    ["situation", "codeInsee"],
    ["situation", "logement", "depcom"],
    ["situation", "logement", "code_insee"],
    ["situation", "logement", "codeInsee"],
    ["adresse", "depcom"],
    ["adresse", "code_insee"],
    ["adresse", "codeInsee"],
    ["commune", "depcom"],
    ["commune", "code_insee"],
    ["commune", "codeInsee"]
  ];

  for (const path of candidatePaths) {
    const candidate = getValueByPaths(source, [path]);
    const normalized = normalizeDepcomCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  if (logementSection && typeof logementSection === "object") {
    const nested = normalizeDepcomCandidate(logementSection);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function extractRentAmount(candidate) {
  if (candidate === undefined || candidate === null) {
    return undefined;
  }

  if (typeof candidate === "number" || typeof candidate === "string") {
    return toNumber(candidate);
  }

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const amount = extractRentAmount(item);
      if (amount !== undefined) {
        return amount;
      }
    }
    return undefined;
  }

  if (typeof candidate === "object") {
    const directKeys = ["montant", "amount", "value", "valeur"];
    for (const key of directKeys) {
      if (Object.prototype.hasOwnProperty.call(candidate, key)) {
        const amount = extractRentAmount(candidate[key]);
        if (amount !== undefined) {
          return amount;
        }
      }
    }
  }

  return undefined;
}

function extractRent(source, logementSection) {
  const rentPaths = [
    ["loyer"],
    ["montant_loyer"],
    ["loyer_mensuel"],
    ["loyer", "montant"],
    ["loyer", "amount"],
    ["loyer", "value"],
    ["loyer", "valeur"],
    ["logement", "loyer"],
    ["logement", "montant_loyer"],
    ["logement", "loyer_mensuel"],
    ["logement", "loyer", "montant"],
    ["logement", "loyer", "amount"],
    ["logement", "loyer", "value"],
    ["logement", "loyer", "valeur"],
    ["menage", "loyer"],
    ["menage", "montant_loyer"],
    ["menage", "loyer_mensuel"],
    ["situation", "loyer"],
    ["situation", "montant_loyer"],
    ["situation", "loyer_mensuel"],
    ["situation", "logement", "loyer"],
    ["situation", "logement", "montant_loyer"],
    ["situation", "logement", "loyer_mensuel"],
    ["depenses", "logement", "loyer"],
    ["depenses", "logement", "montant_loyer"],
    ["depenses", "logement", "loyer_mensuel"],
    ["depenses_logement", "loyer"],
    ["depenses_logement", "montant_loyer"],
    ["depenses_logement", "loyer_mensuel"]
  ];

  for (const path of rentPaths) {
    const candidate = getValueByPaths(source, [path]);
    const amount = extractRentAmount(candidate);
    if (amount !== undefined) {
      return amount;
    }
  }

  if (logementSection && typeof logementSection === "object") {
    const amount = extractRentAmount(logementSection.loyer);
    if (amount !== undefined) {
      return amount;
    }
  }

  return undefined;
}

const HOUSING_STATUS_CODES = new Set([
  "non_renseigne",
  "primo_accedant",
  "proprietaire",
  "locataire_hlm",
  "locataire_vide",
  "locataire_meuble",
  "loge_gratuitement",
  "locataire_foyer",
  "sans_domicile"
]);

const HOUSING_STATUS_ALIASES = {
  proprietaire: "proprietaire",
  proprietaire_occupant: "proprietaire",
  proprietaire_occupante: "proprietaire",
  proprio: "proprietaire",
  proprietaire_residence_principale: "proprietaire",
  primo_accedant: "primo_accedant",
  primo_accedante: "primo_accedant",
  primo_accedente: "primo_accedant",
  locataire: "locataire_vide",
  locataire_vide: "locataire_vide",
  locataire_prive: "locataire_vide",
  locataire_privee: "locataire_vide",
  locataire_classique: "locataire_vide",
  locataire_standard: "locataire_vide",
  locataire_meuble: "locataire_meuble",
  locataire_meublee: "locataire_meuble",
  locataire_meuble_prive: "locataire_meuble",
  locataire_meuble_privee: "locataire_meuble",
  locataire_hlm: "locataire_hlm",
  logement_hlm: "locataire_hlm",
  locataire_logement_social: "locataire_hlm",
  locataire_social: "locataire_hlm",
  bailleur_social: "locataire_hlm",
  locataire_foyer: "locataire_foyer",
  foyer: "locataire_foyer",
  residence_sociale: "locataire_foyer",
  foyer_logement: "locataire_foyer",
  loge_gratuitement: "loge_gratuitement",
  loge_gratuit: "loge_gratuitement",
  heberge_gratuitement: "loge_gratuitement",
  heberge_gratuitement_chez_parents: "loge_gratuitement",
  heberge_chez_parents: "loge_gratuitement",
  heberge_chez_ses_parents: "loge_gratuitement",
  heberge_chez_un_ami: "loge_gratuitement",
  heberge_chez_un_proche: "loge_gratuitement",
  heberge: "loge_gratuitement",
  loge_chez_amis: "loge_gratuitement",
  loge_chez_parents: "loge_gratuitement",
  loge_chez_proches: "loge_gratuitement",
  sans_domicile: "sans_domicile",
  sans_abri: "sans_domicile",
  hebergement_urgence: "sans_domicile",
  hebergement_durgence: "sans_domicile",
  autre: "non_renseigne",
  non_renseigne: "non_renseigne"
};

function sanitizeHousingStatusCandidate(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeHousingStatus(value) {
  if (value === undefined || value === null) {
    return "non_renseigne";
  }

  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "statut")) {
      return normalizeHousingStatus(value.statut);
    }
    if (Object.prototype.hasOwnProperty.call(value, "status")) {
      return normalizeHousingStatus(value.status);
    }
    if (Object.prototype.hasOwnProperty.call(value, "statut_occupation")) {
      return normalizeHousingStatus(value.statut_occupation);
    }
    if (
      Object.prototype.hasOwnProperty.call(value, "statut_occupation_logement")
    ) {
      return normalizeHousingStatus(value.statut_occupation_logement);
    }
  }

  const sanitized = sanitizeHousingStatusCandidate(value);
  if (!sanitized) {
    return "non_renseigne";
  }

  if (HOUSING_STATUS_CODES.has(sanitized)) {
    return sanitized;
  }

  if (HOUSING_STATUS_ALIASES[sanitized]) {
    return HOUSING_STATUS_ALIASES[sanitized];
  }

  const heuristics = [
    {
      matches: (candidate) =>
        candidate.includes("heberge") && candidate.includes("gratuit"),
      value: "loge_gratuitement"
    },
    {
      matches: (candidate) =>
        candidate.includes("loge") && candidate.includes("gratuit"),
      value: "loge_gratuitement"
    },
    {
      matches: (candidate) =>
        candidate.includes("locataire") && candidate.includes("hlm"),
      value: "locataire_hlm"
    },
    {
      matches: (candidate) =>
        candidate.includes("locataire") && candidate.includes("meuble"),
      value: "locataire_meuble"
    },
    {
      matches: (candidate) =>
        candidate.includes("locataire") && candidate.includes("foyer"),
      value: "locataire_foyer"
    },
    {
      matches: (candidate) => candidate.includes("locataire"),
      value: "locataire_vide"
    },
    {
      matches: (candidate) => candidate.includes("proprietaire"),
      value: "proprietaire"
    },
    {
      matches: (candidate) =>
        candidate.includes("primo") && candidate.includes("acced"),
      value: "primo_accedant"
    },
    {
      matches: (candidate) =>
        candidate.includes("sans") &&
        (candidate.includes("domicile") || candidate.includes("abri")),
      value: "sans_domicile"
    }
  ];

  for (const { matches, value: mapped } of heuristics) {
    if (matches(sanitized)) {
      return mapped;
    }
  }

  return "non_renseigne";
}

function parseDate(value) {
  if (!value && value !== 0) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "number") {
    const dateFromNumber = new Date(value);
    return Number.isNaN(dateFromNumber.getTime()) ? null : dateFromNumber;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoMatch = trimmed.match(/^([0-9]{4})[-/.]([0-9]{2})[-/.]([0-9]{2})$/);
  if (isoMatch) {
    const [, yearStr, monthStr, dayStr] = isoMatch;
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10) - 1;
    const day = Number.parseInt(dayStr, 10);
    const candidate = new Date(Date.UTC(year, month, day));
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  }

  const frMatch = trimmed.match(/^([0-9]{2})[-/.]([0-9]{2})[-/.]([0-9]{4})$/);
  if (frMatch) {
    const [, dayStr, monthStr, yearStr] = frMatch;
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10) - 1;
    const day = Number.parseInt(dayStr, 10);
    const candidate = new Date(Date.UTC(year, month, day));
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
}

function formatDateToISO(date) {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeAgeFromBirthdate(birthdate, referenceDate = new Date()) {
  if (!birthdate || Number.isNaN(birthdate.getTime())) {
    return null;
  }

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();
  const endOfReferenceMonth = new Date(Date.UTC(refYear, refMonth + 1, 0));

  let age = endOfReferenceMonth.getUTCFullYear() - birthdate.getUTCFullYear();
  const monthDiff = endOfReferenceMonth.getUTCMonth() - birthdate.getUTCMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && endOfReferenceMonth.getUTCDate() < birthdate.getUTCDate())
  ) {
    age -= 1;
  }

  if (!Number.isFinite(age) || age < 0) {
    return null;
  }

  return age;
}

function isValidAge(value) {
  return Number.isFinite(value) && value >= 0;
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
  ],
  ars: [
    "allocation rentree scolaire",
    "allocation rentrée scolaire",
    "ars",
    "prime de rentree scolaire",
    "prime de rentrée scolaire"
  ],
  aspa: [
    "allocation solidarite personnes agees",
    "allocation solidarité personnes âgées",
    "allocation de solidarite aux personnes agees",
    "allocation de solidarité aux personnes âgées",
    "minimum vieillesse",
    "aspa"
  ],
  asi: [
    "allocation supplementaire invalidite",
    "allocation supplémentaire invalidité",
    "asi"
  ],
  paje_base: [
    "paje",
    "paje base",
    "allocation de base de la paje",
    "prestation accueil du jeune enfant",
    "prestation d'accueil du jeune enfant",
    "paje base allocation"
  ],
  ppa: [
    "prime d activite",
    "prime d'activité",
    "prime activite",
    "prime activité",
    "prime pour l activite",
    "prime pour l'activité",
    "ppa"
  ],
  cf: [
    "cf",
    "complement familial",
    "complément familial",
    "allocation complement familial",
    "allocation complément familial",
    "prestation complement familial",
    "prestation complément familial"
  ]
};

const TRACKED_BENEFIT_VARIABLES = [
  "rsa",
  "aide_logement",
  "af",
  "ars",
  "aspa",
  "asi",
  "paje_base",
  "ppa",
  "cf"
];

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
  const simulationReferenceDate = new Date();

  const extractFirstNameFromValue = (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    if (typeof value === "number") {
      const normalized = String(value).trim();
      return normalized || undefined;
    }

    if (typeof value === "object") {
      const nested =
        value.prenom ??
        value.prénom ??
        value.first_name ??
        value.firstname ??
        value.firstName ??
        undefined;

      if (nested !== undefined) {
        return extractFirstNameFromValue(nested);
      }
    }

    return undefined;
  };

  const extractChildBirthdateCandidate = (item) => {
    if (item === undefined || item === null) {
      return undefined;
    }

    if (item instanceof Date) {
      return item;
    }

    if (typeof item === "string" || typeof item === "number") {
      return item;
    }

    if (typeof item === "object") {
      return (
        item.date_naissance ??
        item.date_de_naissance ??
        item.birthdate ??
        item.dateNaissance ??
        item.naissance ??
        undefined
      );
    }

    return undefined;
  };

  const childBirthdatesByIndex = new Map();
  const childFirstNamesByIndex = new Map();
  const assignChildBirthdateAtIndex = (index, candidate) => {
    if (index === undefined || index === null || index < 0) {
      return;
    }

    if (candidate === undefined || candidate === null || candidate === "") {
      return;
    }

    if (childBirthdatesByIndex.has(index)) {
      return;
    }

    const parsedBirthdate = parseDate(candidate);
    if (!parsedBirthdate) {
      return;
    }

    const iso = formatDateToISO(parsedBirthdate);
    if (!iso) {
      return;
    }

    childBirthdatesByIndex.set(index, iso);
  };

  const assignChildFirstNameAtIndex = (index, candidate) => {
    if (index === undefined || index === null || index < 0) {
      return;
    }

    if (childFirstNamesByIndex.has(index)) {
      return;
    }

    const normalized = extractFirstNameFromValue(candidate);
    if (!normalized) {
      return;
    }

    childFirstNamesByIndex.set(index, normalized);
  };

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

  const logementStatutPaths = [
    ["logement", "statut"],
    ["logement", "status"],
    ["logement", "statut_occupation"],
    ["logement", "statutOccupation"],
    ["logement", "occupation"],
    ["logement", "type"],
    ["logement", "statut_occupation_logement"],
    ["logement_statut"],
    ["logementStatus"],
    ["statut_logement"],
    ["statut_occupation_logement"],
    ["menage", "statut_occupation_logement"],
    ["menage", "statut"],
    ["menage", "logement", "statut"],
    ["situation", "logement", "statut"],
    ["situation", "logement", "status"],
    ["habitation", "statut"],
    ["habitation", "status"],
    ["housing", "status"],
    ["housing", "statut"]
  ];

  const logementSection = getValueByPaths(source, [
    ["logement"],
    ["situation", "logement"],
    ["menage", "logement"],
    ["habitation"],
    ["housing"]
  ]);

  let logementStatutBrut = getValueByPaths(source, logementStatutPaths);

  if (logementStatutBrut === undefined) {
    if (
      typeof logementSection === "string" ||
      typeof logementSection === "number"
    ) {
      logementStatutBrut = logementSection;
    } else if (logementSection && typeof logementSection === "object") {
      logementStatutBrut = getValueByPaths(logementSection, [
        ["statut"],
        ["status"],
        ["statut_occupation"],
        ["statutOccupation"],
        ["occupation"],
        ["type"],
        ["statut_occupation_logement"]
      ]);
    }
  }

  const statutOccupationLogement = normalizeHousingStatus(logementStatutBrut);

  const depcom = extractDepcom(source, logementSection) ?? DEFAULT_DEPCOM;
  const rentAmount = extractRent(source, logementSection);

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

  let ageDemandeur = toNumber(
    getValueByPaths(source, [
      ["age"],
      ["situation", "age"],
      ["situation", "demandeur", "age"],
      ["personnes", "demandeur", "age"],
      ["demandeur", "age"]
    ])
  );
  if (!isValidAge(ageDemandeur)) {
    ageDemandeur = undefined;
  }

  let ageConjoint = toNumber(
    getValueByPaths(source, [
      ["age_conjoint"],
      ["situation", "age_conjoint"],
      ["situation", "conjoint", "age"],
      ["personnes", "conjoint", "age"],
      ["conjoint", "age"]
    ])
  );
  if (!isValidAge(ageConjoint)) {
    ageConjoint = undefined;
  }

  const rawDateNaissanceDemandeur = getValueByPaths(source, [
    ["date_naissance"],
    ["date_de_naissance"],
    ["situation", "date_naissance"],
    ["situation", "date_de_naissance"],
    ["situation", "demandeur", "date_naissance"],
    ["situation", "demandeur", "date_de_naissance"],
    ["demandeur", "date_naissance"],
    ["demandeur", "date_de_naissance"],
    ["personnes", "demandeur", "date_naissance"],
    ["personnes", "demandeur", "date_de_naissance"]
  ]);
  const birthdateDemandeur = parseDate(rawDateNaissanceDemandeur);
  const dateNaissanceDemandeurIso = formatDateToISO(birthdateDemandeur);
  const computedAgeDemandeur = computeAgeFromBirthdate(
    birthdateDemandeur,
    simulationReferenceDate
  );
  if (isValidAge(computedAgeDemandeur)) {
    ageDemandeur = computedAgeDemandeur;
  }

  const rawDateNaissanceConjoint = getValueByPaths(source, [
    ["date_naissance_conjoint"],
    ["date_de_naissance_conjoint"],
    ["situation", "date_naissance_conjoint"],
    ["situation", "date_de_naissance_conjoint"],
    ["situation", "conjoint", "date_naissance"],
    ["situation", "conjoint", "date_de_naissance"],
    ["conjoint", "date_naissance"],
    ["conjoint", "date_de_naissance"],
    ["personnes", "conjoint", "date_naissance"],
    ["personnes", "conjoint", "date_de_naissance"]
  ]);
  const birthdateConjoint = parseDate(rawDateNaissanceConjoint);
  const dateNaissanceConjointIso = formatDateToISO(birthdateConjoint);
  const computedAgeConjoint = computeAgeFromBirthdate(
    birthdateConjoint,
    simulationReferenceDate
  );
  if (isValidAge(computedAgeConjoint)) {
    ageConjoint = computedAgeConjoint;
  }

  const prenomDemandeur = extractFirstNameFromValue(
    getValueByPaths(source, [
      ["prenom_demandeur"],
      ["demandeur_prenom"],
      ["demandeur", "prenom"],
      ["demandeur", "prénom"],
      ["demandeur", "first_name"],
      ["demandeur", "firstname"],
      ["demandeur", "firstName"],
      ["personnes", "demandeur", "prenom"],
      ["personnes", "demandeur", "prénom"],
      ["personnes", "demandeur", "first_name"],
      ["personnes", "demandeur", "firstname"],
      ["personnes", "demandeur", "firstName"],
      ["situation", "demandeur", "prenom"],
      ["situation", "demandeur", "prénom"],
      ["situation", "demandeur", "first_name"],
      ["situation", "demandeur", "firstname"],
      ["situation", "demandeur", "firstName"],
      ["menage", "demandeur", "prenom"],
      ["menage", "demandeur", "first_name"],
      ["menage", "demandeur", "firstname"],
      ["menage", "demandeur", "firstName"]
    ])
  );

  const prenomConjoint = extractFirstNameFromValue(
    getValueByPaths(source, [
      ["prenom_conjoint"],
      ["conjoint_prenom"],
      ["conjoint", "prenom"],
      ["conjoint", "prénom"],
      ["conjoint", "first_name"],
      ["conjoint", "firstname"],
      ["conjoint", "firstName"],
      ["personnes", "conjoint", "prenom"],
      ["personnes", "conjoint", "prénom"],
      ["personnes", "conjoint", "first_name"],
      ["personnes", "conjoint", "firstname"],
      ["personnes", "conjoint", "firstName"],
      ["situation", "conjoint", "prenom"],
      ["situation", "conjoint", "prénom"],
      ["situation", "conjoint", "first_name"],
      ["situation", "conjoint", "firstname"],
      ["situation", "conjoint", "firstName"],
      ["menage", "conjoint", "prenom"],
      ["menage", "conjoint", "first_name"],
      ["menage", "conjoint", "firstname"],
      ["menage", "conjoint", "firstName"]
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

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const candidate = extractChildBirthdateCandidate(item);
        if (candidate !== undefined) {
          assignChildBirthdateAtIndex(index, candidate);
        }

        assignChildFirstNameAtIndex(index, item);
      });
    } else if (typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => {
        const match = key.match(/enfant(?:_|-)?([0-9]+)/i);
        if (!match) {
          return;
        }

        const childIndex = Number.parseInt(match[1], 10) - 1;
        if (childIndex < 0) {
          return;
        }

        const candidate = extractChildBirthdateCandidate(child);
        if (candidate !== undefined) {
          assignChildBirthdateAtIndex(childIndex, candidate);
        }

        assignChildFirstNameAtIndex(childIndex, child);
      });
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

  const indexedChildBirthdateEntries = Object.entries(source)
    .filter(([key]) => /^date_naissance_enfant_\d+$/i.test(key))
    .sort(
      ([keyA], [keyB]) =>
        parseInt(keyA.split("_").pop(), 10) - parseInt(keyB.split("_").pop(), 10)
    );

  indexedChildBirthdateEntries.forEach(([key, value]) => {
    const match = key.match(/(\d+)$/);
    if (!match) {
      return;
    }

    const index = Number.parseInt(match[1], 10) - 1;
    assignChildBirthdateAtIndex(index, value);
  });

  const indexedChildFirstNameEntries = Object.entries(source)
    .filter(([key]) => /^(?:prenom_enfant_\d+|enfant_\d+_prenom)$/i.test(key))
    .sort(
      ([keyA], [keyB]) =>
        parseInt(keyA.match(/(\d+)/)?.[0] ?? "0", 10) -
        parseInt(keyB.match(/(\d+)/)?.[0] ?? "0", 10)
    );

  indexedChildFirstNameEntries.forEach(([key, value]) => {
    const match = key.match(/(\d+)/);
    if (!match) {
      return;
    }

    const index = Number.parseInt(match[1], 10) - 1;
    assignChildFirstNameAtIndex(index, value);
  });

  let maxBirthdateIndex = -1;
  childBirthdatesByIndex.forEach((_, index) => {
    if (index > maxBirthdateIndex) {
      maxBirthdateIndex = index;
    }
  });
  const childCountFromBirthdates = maxBirthdateIndex >= 0 ? maxBirthdateIndex + 1 : 0;

  let maxFirstNameIndex = -1;
  childFirstNamesByIndex.forEach((_, index) => {
    if (index > maxFirstNameIndex) {
      maxFirstNameIndex = index;
    }
  });
  const childCountFromFirstNames = maxFirstNameIndex >= 0 ? maxFirstNameIndex + 1 : 0;

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
    nombreEnfants = Math.max(
      enfantsAges.length,
      childCountFromBirthdates,
      childCountFromFirstNames
    );
  }

  if (!Number.isFinite(nombreEnfants)) {
    nombreEnfants = 0;
  }

  if (enfantsAges.length > nombreEnfants) {
    enfantsAges.splice(nombreEnfants);
  }

  const enfantsDatesNaissance = Array.from(
    { length: nombreEnfants },
    (_, index) => childBirthdatesByIndex.get(index) ?? null
  );

  while (enfantsAges.length < nombreEnfants) {
    enfantsAges.push(undefined);
  }

  for (let i = 0; i < nombreEnfants; i += 1) {
    const birthdateIso = enfantsDatesNaissance[i];
    if (!birthdateIso) {
      continue;
    }

    const birthdate = parseDate(birthdateIso);
    const computedAge = computeAgeFromBirthdate(
      birthdate,
      simulationReferenceDate
    );
    if (isValidAge(computedAge)) {
      enfantsAges[i] = computedAge;
    }
  }

  for (let i = 0; i < nombreEnfants; i += 1) {
    if (!isValidAge(enfantsAges[i])) {
      enfantsAges[i] = 5;
    }
  }

  const enfantsPrenoms = Array.from(
    { length: nombreEnfants },
    (_, index) => childFirstNamesByIndex.get(index) ?? null
  );

  const enfantsDetails = Array.from({ length: nombreEnfants }, (_, index) => ({
    age: enfantsAges[index],
    date_naissance: enfantsDatesNaissance[index],
    prenom: enfantsPrenoms[index]
  }));

  return {
    salaire_de_base: salaireDemandeur ?? 0,
    salaire_de_base_conjoint: salaireConjoint ?? 0,
    aah: aahDemandeur ?? null,
    aah_conjoint: aahConjoint ?? null,
    age: ageDemandeur ?? 30,
    age_conjoint: ageConjoint ?? 30,
    date_naissance: dateNaissanceDemandeurIso ?? null,
    date_naissance_conjoint: dateNaissanceConjointIso ?? null,
    prenom_demandeur: prenomDemandeur ?? null,
    prenom_conjoint: prenomConjoint ?? null,
    nombre_enfants: nombreEnfants,
    enfants: enfantsAges,
    enfants_details: enfantsDetails,
    enfants_prenoms: enfantsPrenoms,
    prestations_recues: prestationsRecues,
    prestations_a_demander: prestationsADemander,
    statut_occupation_logement: statutOccupationLogement,
    depcom,
    loyer: rentAmount ?? null
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

  const wrapValueForPeriodicity = (variableName, value, { backfill = false } = {}) => {
    const periodicity = variablesMeta?.[variableName]?.periodicity;
    const safeValue = value === undefined ? null : value;

    if (periodicity === "year") {
      return { [currentYear]: safeValue };
    }

    const monthlyValues = { [currentMonth]: safeValue };

    if (backfill && (periodicity === "month" || periodicity === undefined)) {
      return backfillPreviousMonths(monthlyValues);
    }

    return monthlyValues;
  };

  const createPeriodValues = (variableName, value) =>
    wrapValueForPeriodicity(variableName, value);

  const createResourcePeriodValues = (variableName, value) =>
    wrapValueForPeriodicity(variableName, value, { backfill: true });

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
      salaire_de_base: createResourcePeriodValues("salaire_de_base", salaire1),
      age: createPeriodValues("age", age1),
      aah: createResourcePeriodValues("aah", aah1 ?? null)
    },
    individu_2: {
      salaire_de_base: createResourcePeriodValues("salaire_de_base", salaire2),
      age: createPeriodValues("age", age2),
      aah: createResourcePeriodValues("aah", aah2 ?? null)
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

  const statutOccupationLogement =
    normalized.statut_occupation_logement || "non_renseigne";

  const familles = {
    famille_1: {
      parents: ["individu_1", "individu_2"],
      enfants: enfantsIds
    }
  };

  const foyers_fiscaux = {
    foyer_fiscal_1: {
      declarants: ["individu_1", "individu_2"],
      personnes_a_charge: enfantsIds
    }
  };

  const depcomCode = normalized.depcom || DEFAULT_DEPCOM;
  const montantLoyer = normalized.loyer;

  const menages = {
    menage_1: {
      personne_de_reference: ["individu_1"],
      conjoint: ["individu_2"],
      enfants: enfantsIds,
      statut_occupation_logement: createPeriodValues(
        "statut_occupation_logement",
        statutOccupationLogement
      ),
      depcom: createPeriodValues("depcom", depcomCode)
    }
  };

  if (
    isTenantHousingStatus(statutOccupationLogement) &&
    typeof montantLoyer === "number" &&
    Number.isFinite(montantLoyer)
  ) {
    menages.menage_1.loyer = createPeriodValues("loyer", montantLoyer);
  }

  const applyBenefitValue = (target, variableName, entry) => {
    if (!target) {
      return;
    }

    const value = entry && entry.mentionnee ? getPrestationPayloadAmount(entry) : null;
    target[variableName] = createPeriodValues(variableName, value);
  };

  TRACKED_BENEFIT_VARIABLES.forEach((benefitId) => {
    const meta = variablesMeta?.[benefitId] || {};
    const entity = meta.entity || (benefitId === "asi" ? "individu" : "famille");

    if (entity === "famille") {
      const entry = getPrestationEntry(prestationsRecues, "menage", benefitId);
      applyBenefitValue(familles.famille_1, benefitId, entry);
      return;
    }

    if (entity === "menage") {
      const entry = getPrestationEntry(prestationsRecues, "menage", benefitId);
      applyBenefitValue(menages.menage_1, benefitId, entry);
      return;
    }

    if (entity === "individu") {
      const demandeurEntry = getPrestationEntry(prestationsRecues, "demandeur", benefitId);
      const conjointEntry = getPrestationEntry(prestationsRecues, "conjoint", benefitId);

      Object.entries(individus).forEach(([individuId, individuValues]) => {
        let entry;
        if (individuId === "individu_1") {
          entry = demandeurEntry;
        } else if (individuId === "individu_2") {
          entry = conjointEntry;
        } else {
          entry = undefined;
        }

        applyBenefitValue(individuValues, benefitId, entry);
      });
    }
  });

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
