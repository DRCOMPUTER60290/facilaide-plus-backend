import test from "node:test";
import assert from "node:assert/strict";

import { getNextQuestion } from "../src/questionnaire.js";

function baseAnswers() {
  return {
    demandeur_prenom: "Alice",
    demandeur_date_naissance: "1985-04-12",
    situation_familiale: "Célibataire"
  };
}

test("getNextQuestion retourne la première question quand aucune réponse n'est fournie", () => {
  const { question, completed } = getNextQuestion({});

  assert.equal(completed, false);
  assert.equal(question?.id, "demandeur_prenom");
  assert.equal(question?.label, "Quel est votre prénom ?");
});

test("le parcours suit la branche sans conjoint lorsque la personne est célibataire", () => {
  const answers = baseAnswers();

  const { question } = getNextQuestion(answers);

  assert.equal(question?.id, "enfants_ou_personnes_a_charge");
});

test("le parcours oriente vers les questions du conjoint lorsque la personne est mariée", () => {
  const answers = {
    ...baseAnswers(),
    situation_familiale: "Marié(e)"
  };

  const { question } = getNextQuestion(answers);

  assert.equal(question?.id, "conjoint_prenom");
});

test("les questions répétées pour les enfants sont générées avec un index", () => {
  const answers = {
    ...baseAnswers(),
    enfants_ou_personnes_a_charge: true,
    nombre_enfants: 2
  };

  const { question } = getNextQuestion(answers);

  assert.equal(question?.id, "enfant_prenom__1");
  assert.ok(question?.label.includes("1"));
});

test("les questions répétées avancent à la question suivante une fois la précédente renseignée", () => {
  const answers = {
    ...baseAnswers(),
    enfants_ou_personnes_a_charge: true,
    nombre_enfants: 1,
    enfant_prenom__1: "Léa"
  };

  const { question } = getNextQuestion(answers);

  assert.equal(question?.id, "enfant_date_naissance__1");
});
