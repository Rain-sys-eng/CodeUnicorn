/**
 * Provider model-id / custom-model 校验的单一事实源。
 *
 * Provider 配置类型（ProviderConfig / CodexProviderConfig / *ProviderPreset 等）
 * 的单一事实源在 `src/features/vendors/types.ts`，请勿在此重复定义。
 */

export const STORAGE_KEYS = {
  CODEX_CUSTOM_MODELS: 'codex-custom-models',
  CLAUDE_MODEL_MAPPING: 'claude-model-mapping',
  CLAUDE_CUSTOM_MODELS: 'claude-custom-models',
  GEMINI_CUSTOM_MODELS: 'gemini-custom-models',
} as const;

export const MODEL_ID_PATTERN = /^[a-zA-Z0-9._/:[\]-]+$/;

export function isValidModelId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return false;
  return MODEL_ID_PATTERN.test(trimmed);
}

export interface CodexCustomModel {
  id: string;
  label: string;
  description?: string;
  providerProfileId?: string;
}

/** Shape-only 校验（不校验 model id 字符集；Claude 自定义模型 id 可含空格等 vendor 语法）。 */
export function isValidShapeOnlyCustomModel(
  model: unknown,
): model is CodexCustomModel {
  if (!model || typeof model !== 'object') return false;
  const obj = model as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.trim().length === 0) return false;
  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) return false;
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    return false;
  }
  if (
    obj.providerProfileId !== undefined &&
    typeof obj.providerProfileId !== 'string'
  ) {
    return false;
  }
  return true;
}

export function isValidCodexCustomModel(model: unknown): model is CodexCustomModel {
  if (!isValidShapeOnlyCustomModel(model)) return false;
  return isValidModelId(model.id);
}

export function validateCodexCustomModels(models: unknown): CodexCustomModel[] {
  if (!Array.isArray(models)) return [];
  return models.filter(isValidCodexCustomModel);
}

/** Claude custom models: shape-only (ids may include spaces / vendor syntax). */
export function validateShapeOnlyCustomModels(models: unknown): CodexCustomModel[] {
  if (!Array.isArray(models)) return [];
  return models.filter(isValidShapeOnlyCustomModel);
}
