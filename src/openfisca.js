import fetch from "node-fetch";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BENEFIT_VARIABLE_IDS } from "./benefits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const LOCAL_SCRIPT_PATH = path.resolve(REPO_ROOT, "scripts", "run_openfisca_local.py");

function collectVariableNamesFromPayload(payload) {
  const names = new Set(DEFAULT_BENEFIT_VARIABLE_IDS);

  const collectFromCollection = (collection) => {
    if (!collection || typeof collection !== "object") {
      return;
    }

    Object.values(collection).forEach((entityValues) => {
      if (!entityValues || typeof entityValues !== "object") {
        return;
      }

      Object.entries(entityValues).forEach(([variableName, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return;
        }

        names.add(variableName);
      });
    });
  };

  collectFromCollection(payload?.individus);
  collectFromCollection(payload?.familles);
  collectFromCollection(payload?.menages);
  collectFromCollection(payload?.foyers_fiscaux);

  const envExtraVariables = process.env.OPENFISCA_LOCAL_EXTRA_VARIABLES;
  if (envExtraVariables) {
    envExtraVariables
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((variableName) => names.add(variableName));
  }

  return Array.from(names);
}

function buildLocalSimulationRequest(payload) {
  const now = new Date();
  const normalizedPayload =
    payload && typeof payload === "object"
      ? JSON.parse(JSON.stringify(payload))
      : {};
  const request = {
    payload: normalizedPayload,
    variables: collectVariableNamesFromPayload(payload),
    currentMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    currentYear: `${now.getFullYear()}`
  };

  return request;
}

async function callLocalOpenFisca(payload) {
  const requestPayload = buildLocalSimulationRequest(payload);

  return new Promise((resolve, reject) => {
    const pythonExecutable = process.env.OPENFISCA_PYTHON_PATH || "python3";

    const pythonPathParts = [path.resolve(REPO_ROOT, "openfisca-france")];
    if (process.env.PYTHONPATH) {
      pythonPathParts.push(process.env.PYTHONPATH);
    }

    const child = spawn(pythonExecutable, [LOCAL_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONPATH: pythonPathParts.join(path.delimiter)
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error(
          `Local OpenFisca process exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      try {
        const normalizedStdout = stdout.trim();
        const result = JSON.parse(normalizedStdout || "{}");
        resolve(result);
      } catch (parseError) {
        parseError.stdout = stdout;
        parseError.stderr = stderr;
        reject(parseError);
      }
    });

    child.stdin.write(JSON.stringify(requestPayload));
    child.stdin.end();
  });
}

async function callRemoteOpenFisca(payload) {
  const response = await fetch(process.env.OPENFISCA_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`OpenFisca API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Envoie un payload JSON à OpenFisca
 */
export async function callOpenFisca(payload) {
  const preferLocal = process.env.OPENFISCA_USE_LOCAL !== "false";
  const remoteUrl = process.env.OPENFISCA_BASE_URL;

  if (preferLocal) {
    try {
      return await callLocalOpenFisca(payload);
    } catch (error) {
      if (!remoteUrl) {
        console.error("Erreur OpenFisca locale:", error.message);
        throw error;
      }

      console.warn(
        "Échec de l'exécution locale d'OpenFisca, bascule vers l'API distante:",
        error.message
      );
    }
  }

  if (!remoteUrl) {
    throw new Error(
      "Aucune URL OpenFisca distante définie et l'exécution locale est désactivée ou a échoué."
    );
  }

  try {
    return await callRemoteOpenFisca(payload);
  } catch (error) {
    console.error("Erreur OpenFisca distante:", error.message);
    throw error;
  }
}
