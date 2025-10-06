import test from "node:test";
import assert from "node:assert/strict";
import { extractAvailableBenefits } from "../src/benefits.js";

function getCurrentMonthKey(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

test("extractAvailableBenefits agrège les montants mensuels positifs et ignore les zéros", () => {
  const now = new Date("2024-05-15T12:00:00Z");
  const currentMonth = getCurrentMonthKey(now);

  const result = {
    entities: {
      familles: {
        famille_1: {
          rsa: {
            [currentMonth]: 500,
            "2024-04": 480
          },
          aide_logement: {
            [currentMonth]: { value: 210.5 }
          },
          paje_base: {
            [currentMonth]: { value: "102.30" }
          },
          af: {
            [currentMonth]: 0
          }
        },
        famille_2: {
          rsa: {
            [currentMonth]: { value: 200 }
          },
          aide_logement: {
            [currentMonth]: 0
          }
        }
      },
      individus: {
        individu_1: {
          aah: {
            [currentMonth]: { value: 800 }
          },
          asi: {
            [currentMonth]: null
          }
        },
        individu_2: {
          aah: {
            [currentMonth]: { value: 120 }
          }
        }
      }
    }
  };

  const benefits = extractAvailableBenefits(result, { now });

  assert.deepEqual(benefits, [
    {
      id: "aah",
      label: "Allocation adulte handicapé mensualisée",
      entity: "individu",
      period: currentMonth,
      amount: 920
    },
    {
      id: "aide_logement",
      label: "Aide au logement (tout type)",
      entity: "famille",
      period: currentMonth,
      amount: 210.5
    },
    {
      id: "paje_base",
      label: "Allocation de base de la PAJE",
      entity: "famille",
      period: currentMonth,
      amount: 102.3
    },
    {
      id: "rsa",
      label: "Revenu de solidarité active",
      entity: "famille",
      period: currentMonth,
      amount: 700
    }
  ]);
});

test("extractAvailableBenefits gère les variables annuelles", () => {
  const now = new Date("2024-09-01T08:00:00Z");
  const currentYear = `${now.getFullYear()}`;

  const result = {
    entities: {
      familles: {
        famille_1: {
          ars: {
            [currentYear]: { value: 320 }
          }
        },
        famille_2: {
          ars: {
            [currentYear]: 150
          }
        }
      }
    }
  };

  const benefits = extractAvailableBenefits(result, { now });

  assert.deepEqual(benefits, [
    {
      id: "ars",
      label: "Allocation de rentrée scolaire",
      entity: "famille",
      period: currentYear,
      amount: 470
    }
  ]);
});
