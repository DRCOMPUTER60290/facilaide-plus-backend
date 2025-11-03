import fs from "fs";
import path from "path";

const QUESTIONNAIRE_PATH = path.resolve("facilaide_questionnaire.json");

let cachedDefinition = null;

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);

  Object.getOwnPropertyNames(value).forEach((property) => {
    if (
      Object.prototype.hasOwnProperty.call(value, property) &&
      value[property] !== null &&
      (typeof value[property] === "object" || typeof value[property] === "function") &&
      !Object.isFrozen(value[property])
    ) {
      deepFreeze(value[property]);
    }
  });

  return value;
}

function readQuestionnaireFile() {
  const raw = fs.readFileSync(QUESTIONNAIRE_PATH, "utf-8");
  return JSON.parse(raw);
}

function buildQuestionIndex(sections = []) {
  const index = new Map();

  const walk = (question, sectionInfo, parentGroupIds = [], repeatGroupIds = []) => {
    if (!question || !question.id) {
      return;
    }

    const entry = {
      node: question,
      sectionId: sectionInfo.id,
      sectionTitle: sectionInfo.title ?? null,
      parentGroupIds,
      repeatGroupIds
    };

    if (!index.has(question.id)) {
      index.set(question.id, entry);
    }

    if (question.type === "group" && Array.isArray(question.questions)) {
      const nextParentGroupIds = [...parentGroupIds, question.id];
      const nextRepeatGroupIds = question.repeat
        ? [...repeatGroupIds, question.id]
        : repeatGroupIds;

      question.questions.forEach((child) =>
        walk(child, sectionInfo, nextParentGroupIds, nextRepeatGroupIds)
      );
    }
  };

  sections.forEach((section) => {
    if (!section || !Array.isArray(section.questions)) {
      return;
    }

    section.questions.forEach((question) => walk(question, section, [], []));
  });

  return index;
}

function getDefinition() {
  if (cachedDefinition) {
    return cachedDefinition;
  }

  const definition = readQuestionnaireFile();
  const { meta = {}, startQuestionId = null, sections = [] } = definition || {};
  const questionIndex = buildQuestionIndex(sections);

  cachedDefinition = deepFreeze({ meta, startQuestionId, sections, questionIndex });
  return cachedDefinition;
}

function duplicate(value) {
  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => duplicate(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, duplicate(val)])
    );
  }

  return value;
}

function applyTemplates(value, replacements = {}) {
  if (typeof value !== "string") {
    return value;
  }

  let output = value;
  Object.entries(replacements).forEach(([key, replacement]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    output = output.replace(pattern, String(replacement));
  });
  return output;
}

function resolveAnswerKey(entry, context) {
  const repeatStack = Array.isArray(context?.repeatStack)
    ? context.repeatStack
    : [];

  let key = entry.node.id;

  entry.repeatGroupIds.forEach((groupId) => {
    const stackEntry = repeatStack.find((item) => item.groupId === groupId);
    if (stackEntry) {
      key = `${key}__${stackEntry.index}`;
    }
  });

  return key;
}

function resolveAnswerValue(questionId, answers, context) {
  if (!questionId) {
    return undefined;
  }

  const { questionIndex } = getDefinition();
  const targetEntry = questionIndex.get(questionId);
  if (!targetEntry) {
    return undefined;
  }

  const answerKey = resolveAnswerKey(targetEntry, context);
  return answers ? answers[answerKey] : undefined;
}

function evaluateCondition(value, operator, expectedValues = []) {
  const normalizedExpected = Array.isArray(expectedValues)
    ? expectedValues
    : [expectedValues];

  if (operator === "equals") {
    return normalizedExpected.some((expected) => value === expected);
  }

  if (operator === "in") {
    return normalizedExpected.includes(value);
  }

  if (operator === "includes") {
    if (!Array.isArray(value)) {
      return false;
    }
    return normalizedExpected.every((expected) => value.includes(expected));
  }

  if (operator === "includesAny") {
    if (!Array.isArray(value)) {
      return false;
    }
    return normalizedExpected.some((expected) => value.includes(expected));
  }

  return false;
}

function isNodeVisible(entry, answers, context) {
  const rule = entry?.node?.visibleIf;
  if (!rule) {
    return true;
  }

  const targetValue = resolveAnswerValue(rule.questionId, answers, context);
  return evaluateCondition(targetValue, rule.operator, rule.values);
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function determineNextId(entry, answers, context, answerKey) {
  const node = entry.node || {};

  if (Array.isArray(node.nextIf)) {
    const key = answerKey ?? resolveAnswerKey(entry, context);
    const answer = answers ? answers[key] : undefined;

    if (answer !== undefined) {
      for (const condition of node.nextIf) {
        const operator =
          condition.ifValueIn !== undefined
            ? "in"
            : condition.operator || "equals";
        const expectedValues =
          condition.ifValueIn !== undefined
            ? condition.ifValueIn
            : condition.ifValueIs !== undefined
            ? [condition.ifValueIs]
            : condition.values;

        if (evaluateCondition(answer, operator, expectedValues)) {
          return condition.goTo ?? null;
        }
      }
    }

    if (node.next) {
      return node.next;
    }

    return null;
  }

  return node.next ?? null;
}

function buildRepeatReplacements(entry, context) {
  if (!entry.repeatGroupIds.length) {
    return {};
  }

  const replacements = {};
  const repeatStack = Array.isArray(context?.repeatStack)
    ? context.repeatStack
    : [];

  const lastRepeatGroupId = entry.repeatGroupIds[entry.repeatGroupIds.length - 1];
  const stackEntry = repeatStack.find((item) => item.groupId === lastRepeatGroupId);
  if (stackEntry) {
    replacements.index = stackEntry.index;
  }

  return replacements;
}

function instantiateQuestion(entry, context) {
  const { node } = entry;
  const answerKey = resolveAnswerKey(entry, context);
  const replacements = buildRepeatReplacements(entry, context);

  const internalKey = applyTemplates(node.internalKey, replacements);

  const question = {
    id: answerKey,
    baseId: node.id,
    type: node.type,
    label: applyTemplates(node.label, replacements),
    required: Boolean(node.required),
    options: duplicate(node.options),
    unit: node.unit ?? null,
    validation: duplicate(node.validation),
    metadata: {
      internalKey: internalKey ?? null,
      openfisca: duplicate(node.openfisca)
    },
    section: {
      id: entry.sectionId,
      title: entry.sectionTitle
    },
    parentGroupIds: [...entry.parentGroupIds],
    repeatContext: entry.repeatGroupIds.length
      ? entry.repeatGroupIds.reduce((acc, groupId) => {
          const stackEntry = context?.repeatStack?.find(
            (item) => item.groupId === groupId
          );
          if (stackEntry) {
            acc[groupId] = stackEntry.index;
          }
          return acc;
        }, {})
      : {}
  };

  return question;
}

function createBaseContext() {
  return { repeatStack: [] };
}

function findNextQuestionInEntry(entry, answers, context, options = {}) {
  const visible = isNodeVisible(entry, answers, context);
  if (!visible) {
    return { nextQuestion: null, nextId: determineNextId(entry, answers, context) };
  }

  if (entry.node.type === "group") {
    const nextContext = {
      repeatStack: Array.isArray(context?.repeatStack)
        ? [...context.repeatStack]
        : []
    };

    const groupNode = entry.node;
    const questions = Array.isArray(groupNode.questions)
      ? groupNode.questions
      : [];

    if (groupNode.repeat && groupNode.repeat.fromQuestionId) {
      const rawCount = resolveAnswerValue(
        groupNode.repeat.fromQuestionId,
        answers,
        context
      );
      const count = toNumber(rawCount);
      const iterations = count && count > 0 ? Math.floor(count) : 0;

      for (let index = 1; index <= iterations; index += 1) {
        const childContext = {
          repeatStack: [...nextContext.repeatStack, { groupId: groupNode.id, index }]
        };

        for (const question of questions) {
          const { questionIndex } = getDefinition();
          const childEntry = questionIndex.get(question.id);
          if (!childEntry) {
            continue;
          }

          const childResult = findNextQuestionInEntry(
            childEntry,
            answers,
            childContext,
            { inline: true }
          );

          if (childResult.nextQuestion) {
            return childResult;
          }
        }
      }
    } else {
      const childContext = {
        repeatStack: nextContext.repeatStack
      };

      for (const question of questions) {
        const { questionIndex } = getDefinition();
        const childEntry = questionIndex.get(question.id);
        if (!childEntry) {
          continue;
        }

        const childResult = findNextQuestionInEntry(
          childEntry,
          answers,
          childContext,
          { inline: true }
        );

        if (childResult.nextQuestion) {
          return childResult;
        }
      }
    }

    if (options.inline) {
      return { nextQuestion: null, nextId: null };
    }

    return { nextQuestion: null, nextId: determineNextId(entry, answers, context) };
  }

  const answerKey = resolveAnswerKey(entry, context);
  const answer = answers ? answers[answerKey] : undefined;

  if (answer === undefined) {
    return { nextQuestion: instantiateQuestion(entry, context), nextId: null };
  }

  if (options.inline) {
    return { nextQuestion: null, nextId: null };
  }

  return {
    nextQuestion: null,
    nextId: determineNextId(entry, answers, context, answerKey)
  };
}

export function getQuestionnaire() {
  const { meta, sections, startQuestionId } = getDefinition();
  return { meta, sections, startQuestionId };
}

export function getNextQuestion(answers = {}) {
  const normalizedAnswers =
    answers && typeof answers === "object" ? answers : {};

  const { startQuestionId, questionIndex } = getDefinition();
  if (!startQuestionId) {
    return { question: null, completed: true };
  }

  const visited = new Set();
  let currentId = startQuestionId;
  let context = createBaseContext();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const entry = questionIndex.get(currentId);
    if (!entry) {
      break;
    }

    const { nextQuestion, nextId } = findNextQuestionInEntry(
      entry,
      normalizedAnswers,
      context
    );

    if (nextQuestion) {
      return { question: nextQuestion, completed: false };
    }

    currentId = nextId;
  }

  return { question: null, completed: true };
}

function collectQuestions(entry, answers, context) {
  if (!isNodeVisible(entry, answers, context)) {
    return [];
  }

  if (entry.node.type !== "group") {
    return [instantiateQuestion(entry, context)];
  }

  const results = [];
  const groupNode = entry.node;
  const questions = Array.isArray(groupNode.questions)
    ? groupNode.questions
    : [];

  const { questionIndex } = getDefinition();

  if (groupNode.repeat && groupNode.repeat.fromQuestionId) {
    const rawCount = resolveAnswerValue(
      groupNode.repeat.fromQuestionId,
      answers,
      context
    );
    const count = toNumber(rawCount);
    const iterations = count && count > 0 ? Math.floor(count) : 0;

    for (let index = 1; index <= iterations; index += 1) {
      const childContext = {
        repeatStack: [
          ...(Array.isArray(context?.repeatStack) ? context.repeatStack : []),
          { groupId: groupNode.id, index }
        ]
      };

      for (const question of questions) {
        const childEntry = questionIndex.get(question.id);
        if (!childEntry) {
          continue;
        }

        results.push(...collectQuestions(childEntry, answers, childContext));
      }
    }
    return results;
  }

  const childContext = {
    repeatStack: Array.isArray(context?.repeatStack) ? [...context.repeatStack] : []
  };

  for (const question of questions) {
    const childEntry = questionIndex.get(question.id);
    if (!childEntry) {
      continue;
    }

    results.push(...collectQuestions(childEntry, answers, childContext));
  }

  return results;
}

export function getQuestionFlow(answers = {}) {
  const normalizedAnswers =
    answers && typeof answers === "object" ? answers : {};

  const { startQuestionId, questionIndex } = getDefinition();
  if (!startQuestionId) {
    return [];
  }

  const visited = new Set();
  const flow = [];
  let currentId = startQuestionId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const entry = questionIndex.get(currentId);
    if (!entry) {
      break;
    }

    flow.push(...collectQuestions(entry, normalizedAnswers, createBaseContext()));

    currentId = determineNextId(entry, normalizedAnswers, createBaseContext());
  }

  return flow;
}
