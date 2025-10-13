import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenFiscaPayload } from "../src/variables.js";

function getCurrentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function computeBackfilledMonthKeys(currentMonth, monthsToBackfill = 3) {
  const [year, month] = currentMonth.split("-").map((part) => Number.parseInt(part, 10));
  const referenceDate = new Date(Date.UTC(year, month - 1, 1));
  const keys = [];

  for (let offset = monthsToBackfill; offset >= 1; offset -= 1) {
    const date = new Date(referenceDate);
    date.setUTCMonth(date.getUTCMonth() - offset);
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  keys.push(currentMonth);
  return keys;
}

function isoBirthdateForAge(age, now = new Date()) {
  const year = now.getUTCFullYear() - age;
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = "01";
  return `${year}-${month}-${day}`;
}

function computeAgeAtSimulationMonth(birthdateIso, now = new Date()) {
  const [yearStr, monthStr, dayStr] = birthdateIso.split("-");
  const birthdate = new Date(
    Date.UTC(
      Number.parseInt(yearStr, 10),
      Number.parseInt(monthStr, 10) - 1,
      Number.parseInt(dayStr, 10)
    )
  );
  const endOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  );

  let age = endOfMonth.getUTCFullYear() - birthdate.getUTCFullYear();
  const monthDiff = endOfMonth.getUTCMonth() - birthdate.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && endOfMonth.getUTCDate() < birthdate.getUTCDate())
  ) {
    age -= 1;
  }

  return age;
}

test("monthly non-resource variables stay on current month while resources backfill three months", () => {
  const payload = buildOpenFiscaPayload({
    salaire_de_base: 1500,
    aah: 300,
    age: 42
  });

  const individu = payload?.individus?.individu_1;
  assert.ok(individu, "individu_1 should be present in the payload");

  const currentMonth = getCurrentMonthKey();
  const expectedMonths = computeBackfilledMonthKeys(currentMonth);
  const salaireMonths = Object.keys(individu.salaire_de_base).sort();
  const aahMonths = Object.keys(individu.aah).sort();

  assert.deepEqual(salaireMonths, [...expectedMonths].sort());
  assert.deepEqual(aahMonths, [...expectedMonths].sort());

  expectedMonths.forEach((monthKey) => {
    assert.strictEqual(individu.salaire_de_base[monthKey], 1500);
    assert.strictEqual(individu.aah[monthKey], 300);
  });

  const ageEntries = Object.entries(individu.age);
  assert.strictEqual(ageEntries.length, 1);
  assert.strictEqual(ageEntries[0][0], currentMonth);
  assert.strictEqual(ageEntries[0][1], 42);
});

test("birthdates override inconsistent or missing ages", () => {
  const now = new Date();
  const demandeurBirthdate = isoBirthdateForAge(30, now);
  const conjointBirthdate = isoBirthdateForAge(32, now);
  const child1Birthdate = isoBirthdateForAge(5, now);
  const child2Birthdate = isoBirthdateForAge(8, now);

  const payload = buildOpenFiscaPayload({
    age: 99,
    date_naissance: demandeurBirthdate,
    age_conjoint: 1,
    date_naissance_conjoint: conjointBirthdate,
    nombre_enfants: 2,
    enfants: [
      { age: 2, date_naissance: child1Birthdate },
      { age: null, date_naissance: child2Birthdate }
    ]
  });

  const currentMonth = getCurrentMonthKey(now);
  const individu1 = payload?.individus?.individu_1;
  const individu2 = payload?.individus?.individu_2;
  const enfant1 = payload?.individus?.enfant_1;
  const enfant2 = payload?.individus?.enfant_2;

  assert.ok(individu1, "individu_1 should exist in the payload");
  assert.ok(individu2, "individu_2 should exist in the payload");
  assert.ok(enfant1, "enfant_1 should exist in the payload");
  assert.ok(enfant2, "enfant_2 should exist in the payload");

  const expectedDemandeurAge = computeAgeAtSimulationMonth(
    demandeurBirthdate,
    now
  );
  const expectedConjointAge = computeAgeAtSimulationMonth(
    conjointBirthdate,
    now
  );
  const expectedChild1Age = computeAgeAtSimulationMonth(child1Birthdate, now);
  const expectedChild2Age = computeAgeAtSimulationMonth(child2Birthdate, now);

  assert.strictEqual(
    individu1.age[currentMonth],
    expectedDemandeurAge,
    "demandeur age should be derived from birthdate"
  );
  assert.strictEqual(
    individu2.age[currentMonth],
    expectedConjointAge,
    "conjoint age should be derived from birthdate"
  );
  assert.strictEqual(
    enfant1.age[currentMonth],
    expectedChild1Age,
    "first child age should be derived from birthdate"
  );
  assert.strictEqual(
    enfant2.age[currentMonth],
    expectedChild2Age,
    "second child age should be derived from birthdate"
  );
});

test("housing status from user message populates menage payload", () => {
  const now = new Date();
  const currentMonth = getCurrentMonthKey(now);

  const ownerPayload = buildOpenFiscaPayload({
    logement: { statut: "proprietaire" }
  });

  const hostedPayload = buildOpenFiscaPayload({
    logement: { statut: "hébergé gratuitement chez mes parents" }
  });

  const tenantPayload = buildOpenFiscaPayload({
    logement: { statut: "locataire" }
  });

  assert.strictEqual(
    ownerPayload?.menages?.menage_1?.statut_occupation_logement?.[currentMonth],
    "proprietaire"
  );
  assert.strictEqual(
    hostedPayload?.menages?.menage_1?.statut_occupation_logement?.[currentMonth],
    "loge_gratuitement"
  );
  assert.strictEqual(
    tenantPayload?.menages?.menage_1?.statut_occupation_logement?.[currentMonth],
    "locataire_vide"
  );
});

test("housing status defaults to non_renseigne when not provided", () => {
  const now = new Date();
  const currentMonth = getCurrentMonthKey(now);

  const payload = buildOpenFiscaPayload({});

  assert.strictEqual(
    payload?.menages?.menage_1?.statut_occupation_logement?.[currentMonth],
    "non_renseigne"
  );
});

test("tenant households expose rent in menage payload", () => {
  const now = new Date();
  const currentMonth = getCurrentMonthKey(now);

  const tenantPayload = buildOpenFiscaPayload({
    loyer: 780,
    logement: { statut: "locataire" }
  });

  assert.strictEqual(
    tenantPayload?.menages?.menage_1?.loyer?.[currentMonth],
    780
  );

  const nestedTenantPayload = buildOpenFiscaPayload({
    logement: { statut: "locataire_hlm", loyer: { montant: "910" } }
  });

  assert.strictEqual(
    nestedTenantPayload?.menages?.menage_1?.loyer?.[currentMonth],
    910
  );

  const ownerPayload = buildOpenFiscaPayload({
    loyer: 650,
    logement: { statut: "proprietaire" }
  });

  assert.strictEqual(
    ownerPayload?.menages?.menage_1?.loyer,
    undefined
  );
});
