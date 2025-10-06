import { getVariablesMeta } from "./variables.js";

const ENTITY_COLLECTION_KEYS = {
  individu: "individus",
  famille: "familles",
  menage: "menages"
};

const DEFAULT_BENEFIT_VARIABLE_IDS = [
  "aah",
  "af",
  "aide_logement",
  "ars",
  "aspa",
  "asi",
  "paje_base",
  "rsa"
];

function buildBenefitDefinitions(meta) {
  return DEFAULT_BENEFIT_VARIABLE_IDS.map((candidate) => {
    const id = typeof candidate === "string" ? candidate : candidate.id;
    const overrides =
      candidate && typeof candidate === "object" && candidate.id
        ? candidate
        : { id };

    const metaEntry = (meta && meta[id]) || {};

    const entity = overrides.entity || metaEntry.entity;
    const periodicity = overrides.periodicity || metaEntry.periodicity || "month";
    const label = overrides.label || metaEntry.description || id;

    return { id, entity, periodicity, label };
  }).filter((definition) => definition.entity && ENTITY_COLLECTION_KEYS[definition.entity]);
}

function toFiniteNumber(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, ".").trim();
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function extractAmountForPeriod(variableValues, periodKey) {
  if (variableValues === undefined || variableValues === null) {
    return undefined;
  }

  if (typeof variableValues === "number" || typeof variableValues === "string") {
    return toFiniteNumber(variableValues);
  }

  if (typeof variableValues !== "object") {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(variableValues, periodKey)) {
    const entry = variableValues[periodKey];
    if (entry && typeof entry === "object" && "value" in entry) {
      return toFiniteNumber(entry.value);
    }
    return toFiniteNumber(entry);
  }

  if ("value" in variableValues) {
    return toFiniteNumber(variableValues.value);
  }

  const periodKeys = Object.keys(variableValues);
  for (const key of periodKeys) {
    const entry = variableValues[key];
    if (entry && typeof entry === "object" && "value" in entry) {
      const normalized = toFiniteNumber(entry.value);
      if (normalized !== undefined) {
        return normalized;
      }
    } else {
      const normalized = toFiniteNumber(entry);
      if (normalized !== undefined) {
        return normalized;
      }
    }
  }

  return undefined;
}

function resolvePeriodKey(periodicity, currentMonth, currentYear) {
  if (periodicity === "year") {
    return currentYear;
  }
  return currentMonth;
}

export function extractAvailableBenefits(result, options = {}) {
  if (!result || typeof result !== "object") {
    return [];
  }

  const now = options?.now instanceof Date ? options.now : new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentYear = `${now.getFullYear()}`;

  const meta = getVariablesMeta();
  const benefitDefinitions = buildBenefitDefinitions(meta);

  const relevantCollectionKeys = Object.values(ENTITY_COLLECTION_KEYS);

  const rootObject = result && typeof result === "object" ? result : {};
  const entitiesFromResult =
    rootObject.entities && typeof rootObject.entities === "object" ? rootObject.entities : {};

  const entities = {};

  for (const key of relevantCollectionKeys) {
    const fromRoot = rootObject[key];
    const fromEntities = entitiesFromResult[key];

    const normalizedRoot = fromRoot && typeof fromRoot === "object" ? fromRoot : undefined;
    const normalizedEntities =
      fromEntities && typeof fromEntities === "object" ? fromEntities : undefined;

    if (!normalizedRoot && !normalizedEntities) {
      continue;
    }

    entities[key] = {
      ...(normalizedRoot || {}),
      ...(normalizedEntities || {})
    };
  }
  const availableBenefits = [];

  for (const benefit of benefitDefinitions) {
    const containerKey = ENTITY_COLLECTION_KEYS[benefit.entity];
    const collection = entities?.[containerKey];
    if (!collection || typeof collection !== "object") {
      continue;
    }

    const periodKey = resolvePeriodKey(benefit.periodicity, currentMonth, currentYear);

    let totalAmount = 0;
    let hasPositiveAmount = false;

    for (const entityValues of Object.values(collection)) {
      if (!entityValues || typeof entityValues !== "object") {
        continue;
      }

      const amount = extractAmountForPeriod(entityValues[benefit.id], periodKey);
      if (typeof amount === "number" && amount > 0) {
        totalAmount += amount;
        hasPositiveAmount = true;
      }
    }

    if (hasPositiveAmount && Number.isFinite(totalAmount) && totalAmount > 0) {
      availableBenefits.push({
        id: benefit.id,
        label: benefit.label,
        entity: benefit.entity,
        period: periodKey,
        amount: totalAmount
      });
    }
  }

  return availableBenefits;
}

export default extractAvailableBenefits;
