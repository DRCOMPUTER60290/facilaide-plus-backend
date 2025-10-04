import fs from "fs";
import path from "path";

// Charger le fichier meta (au cas où on en a besoin plus tard)
const filePath = path.resolve("openfiscaVariablesMeta.json");
let variablesMeta = {};
try {
  variablesMeta = JSON.parse(fs.readFileSync(filePath, "utf-8"));
} catch (e) {
  console.warn("⚠️ Impossible de charger openfiscaVariablesMeta.json, on utilisera des règles simplifiées.");
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

/**
 * Construit un payload OpenFisca complet à partir d’un rawJson simplifié
 */
export function buildOpenFiscaPayload(rawJson) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentYear = `${now.getFullYear()}`;

  // Récupérer les données utilisateur
  const salaire1 = rawJson.salaire_de_base || 0;
  const salaire2 = rawJson.salaire_de_base_conjoint || 0;
  const age1 = rawJson.age || 30;
  const age2 = rawJson.age_conjoint || 30;
  const nbEnfants = rawJson.nombre_enfants || 0;

  // Construire les individus
  const individus = {
    individu_1: {
      salaire_de_base: { [currentYear]: salaire1 },
      age: { [currentMonth]: age1 }
    },
    individu_2: {
      salaire_de_base: { [currentYear]: salaire2 },
      age: { [currentMonth]: age2 }
    }
  };

  // Ajouter les enfants
  for (let i = 1; i <= nbEnfants; i++) {
    const ageEnfant = rawJson[`age_enfant_${i}`] || 5;
    individus[`enfant_${i}`] = {
      age: { [currentMonth]: ageEnfant }
    };
  }

  // Construire familles, menages et foyers fiscaux
  const enfantsIds = Array.from({ length: nbEnfants }, (_, i) => `enfant_${i + 1}`);

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

  const menages = {
    menage_1: {
      personne_de_reference: ["individu_1"],
      conjoint: ["individu_2"],
      enfants: enfantsIds
    }
  };

  // Assemble le payload final
  const payload = {
    individus,
    familles,
    foyers_fiscaux,
    menages,
    simulateur: {
      familles: ["rsa", "aide_logement", "af"],
      individus: ["aah"],
      menages: []
    }
  };

  return payload;
}
