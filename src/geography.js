const CITY_POSTAL_CODE_KNOWLEDGE = [
  {
    postalCode: "60290",
    names: ["laigneville", "laigne-ville"]
  }
];

function removeDiacritics(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value = "") {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildRegexFromName(name) {
  const normalized = normalizeText(name);
  if (!normalized) {
    return null;
  }

  const pattern = `(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`;
  return new RegExp(pattern, "i");
}

function getNormalizedHints(rawJson = {}, userMessage = "") {
  const hints = [];

  if (typeof userMessage === "string" && userMessage.trim()) {
    hints.push(userMessage);
  }

  const potentialFields = [
    rawJson?.logement?.commentaire,
    rawJson?.logement?.ville,
    rawJson?.ville,
    rawJson?.commune,
    rawJson?.municipalite,
    rawJson?.situation?.commentaire,
    rawJson?.situation?.demandeur?.ville,
    rawJson?.situation?.demandeur?.commune,
    rawJson?.situation?.logement?.ville
  ];

  potentialFields.forEach((value) => {
    if (typeof value === "string" && value.trim()) {
      hints.push(value);
    }
  });

  return normalizeText(hints.join(" "));
}

function isSamePostalCode(current, expected) {
  if (current === null || current === undefined) {
    return false;
  }

  const normalizedCurrent = String(current).trim();
  if (!/^[0-9]{4,5}$/.test(normalizedCurrent)) {
    return normalizedCurrent === expected;
  }

  return normalizedCurrent.padStart(5, "0") === expected;
}

export function normalizePostalCode(rawJson = {}, userMessage = "") {
  if (!rawJson || typeof rawJson !== "object") {
    return rawJson;
  }

  const searchSpace = getNormalizedHints(rawJson, userMessage);
  if (!searchSpace) {
    return rawJson;
  }

  for (const entry of CITY_POSTAL_CODE_KNOWLEDGE) {
    const regexes = entry.names
      .map((name) => buildRegexFromName(name))
      .filter(Boolean);

    const hasMatch = regexes.some((regex) => regex.test(searchSpace));
    if (!hasMatch) {
      continue;
    }

    if (isSamePostalCode(rawJson.code_postal, entry.postalCode)) {
      return rawJson;
    }

    return {
      ...rawJson,
      code_postal: entry.postalCode
    };
  }

  return rawJson;
}

export default normalizePostalCode;
