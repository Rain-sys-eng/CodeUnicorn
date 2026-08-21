import { invoke } from "@tauri-apps/api/core";

/**
 * Qoder CLI 认证（浏览器 login + mossx 托管的 PAT）。
 *
 * 安全边界：完整 PAT 永不回传前端，status 只携带 mask 后的展示串。
 */

export type QoderAuthState = "configured" | "env" | "none";

export interface QoderAuthStatus {
  authFile: { path: string; exists: boolean };
  state: QoderAuthState;
  maskedKey?: string;
  envVar: string;
}

export async function qoderAuthStatus(): Promise<QoderAuthStatus> {
  return invoke<QoderAuthStatus>("qoder_auth_status");
}

export async function qoderAuthSetPat(key: string): Promise<void> {
  return invoke<void>("qoder_auth_set_pat", { key });
}

export async function qoderAuthDeletePat(): Promise<void> {
  return invoke<void>("qoder_auth_delete_pat");
}
