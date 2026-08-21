import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const artifactPath = path.join(
  root,
  "src/features/models/generatedModelCatalog.json",
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const failures = [];

// DSH catalog is host-runtime (`llm.models`). A static fallback roster would
// lie about models the user has not configured. Empty / absent is the decision.
const STATIC_FALLBACK_ENGINES = ["codex", "gemini", "grok", "kimi", "opencode"];
// Qoder catalog is ACP runtime (models.availableModels via qodercli --acp), not static.
const RUNTIME_ONLY_ENGINES = ["dsh", "qoder"];

for (const engine of STATIC_FALLBACK_ENGINES) {
  const entries = artifact.engines?.[engine];
  if (!Array.isArray(entries) || entries.length === 0) {
    failures.push(`${engine} fallback roster is empty`);
    continue;
  }
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.id || !entry.provider || !entry.protocol || !entry.lifecycle) {
      failures.push(`${engine} entry has incomplete provenance: ${entry.id ?? "missing"}`);
    }
    if (ids.has(entry.id)) {
      failures.push(`${engine} duplicate fallback id: ${entry.id}`);
    }
    ids.add(entry.id);
  }
}

const codexOwner = fs.readFileSync(
  path.join(root, "src/features/models/codexModelCatalog.ts"),
  "utf8",
);
if (!codexOwner.includes('from "./generatedModelCatalog.json"')) {
  failures.push("frontend Codex fallback does not consume generated artifact");
}
const rustOwner = fs.readFileSync(
  path.join(root, "src-tauri/src/engine/status.rs"),
  "utf8",
);
if (!rustOwner.includes("GENERATED_MODEL_CATALOG_JSON")) {
  failures.push("Rust fallback does not consume generated artifact");
}
const rustDto = fs.readFileSync(
  path.join(root, "src-tauri/src/engine/mod.rs"),
  "utf8",
);
if (/#\[serde\(skip_serializing\)\]\s*pub provider/.test(rustDto)) {
  failures.push("Rust ModelInfo still suppresses provider metadata");
}

for (const engine of RUNTIME_ONLY_ENGINES) {
  const entries = artifact.engines?.[engine];
  if (entries != null && !Array.isArray(entries)) {
    failures.push(`${engine} runtime-only catalog must be an array or omitted`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `model provider catalog valid: codex=${artifact.engines.codex.length}, gemini=${artifact.engines.gemini.length}, grok=${artifact.engines.grok.length}, kimi=${artifact.engines.kimi.length}, opencode=${artifact.engines.opencode.length}, dsh=runtime-only`,
);
