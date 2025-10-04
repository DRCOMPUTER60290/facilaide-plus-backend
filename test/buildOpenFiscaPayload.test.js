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
