import fs from "fs";
import path from "path";

// Charger le fichier meta
const filePath = path.resolve("openfiscaVariablesMeta.json");
const variablesMeta = JSON.parse(fs.readFileSync(filePath, "utf-8"));

/**
 * Retourne les infos d'une variable (entité + periodicity)
 */
export function getVariableInfo(varName) {
  return variablesMeta[varName] || null;
}

/**
 * Génère une clé de période au bon format selon periodicity
 * - month → "2025-01"
 * - year → "2025"
 * - eternity → null
 */
export function formatPeriodicity(periodicity) {
  const now = new Date();
  if (periodicity === "month") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  if (periodicity === "year") {
    return `${now.getFullYear()}`;
  }
  return null;
}

/**
 * Construit un payload OpenFisca à partir d’un JSON brut venant d’OpenAI
 */
export function buildOpenFiscaPayload(rawJson) {
  const payload = {
    individus: {},
    menages: {},
    familles: {},
    foyers_fiscaux: {}
  };

  for (const [varName, value] of Object.entries(rawJson)) {
    const info = getVariableInfo(varName);
    if (!info) continue;

    const entity = info.entity; // ex: individu, famille, menage, foyer_fiscal
    const period = formatPeriodicity(info.periodicity);

    // Exemple simplifié : on met tout dans "individu_1", "famille_1", etc.
    const entityId = `${entity}_1`;

    if (!payload[entity + "s"][entityId]) {
      payload[entity + "s"][entityId] = {};
    }

    if (period) {
      payload[entity + "s"][entityId][varName] = { [period]: value };
    } else {
      payload[entity + "s"][entityId][varName] = value;
    }
  }

  return payload;
}
