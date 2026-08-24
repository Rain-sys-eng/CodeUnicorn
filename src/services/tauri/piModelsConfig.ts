import { invoke } from "@tauri-apps/api/core";

/**
 * PI CLI 自定义供应商（`~/.pi/agent/models.json`）。
 * OpenSpec: openspec/changes/add-pi-models-json-config
 *
 * 安全边界（与 piAuth.ts 不同）：models.json 的 apiKey 属用户自有配置
 * （明文 / $ENV / !command），原文回显供编辑是预期行为。
 */

export interface PiCustomProviderSummary {
  id: string;
  name: string | null;
  baseUrl: string | null;
  api: string | null;
  modelCount: number;
  hasApiKey: boolean;
}

export interface PiModelsConfigReadResult {
  file: { path: string; exists: boolean };
  /** 文件原文（含注释）；文件不存在为 null */
  text: string | null;
  /** 空文件时供编辑器预填的默认示例 */
  template: string;
  providers: PiCustomProviderSummary[];
  /** JSON 损坏时的可读错误；此时 providers 为空但 text 仍可编辑修复 */
  parseError: string | null;
}

export async function piModelsConfigRead(): Promise<PiModelsConfigReadResult> {
  return invoke<PiModelsConfigReadResult>("pi_models_config_read");
}

export async function piModelsConfigWrite(text: string): Promise<void> {
  return invoke<void>("pi_models_config_write", { text });
}
