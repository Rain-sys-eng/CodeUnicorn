import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { claudeCommandCreate, engineSendMessageSync } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { EngineType } from "../../../types";
import {
  classifyPromptEnhancerError,
  PromptEnhancerError,
} from "../../composer/components/ChatInputBox/hooks/usePromptEnhancer";
import { buildDistillInstruction } from "../utils/distillInstruction";
import { createId } from "@/utils/id";

const DISTILL_TIMEOUT_SECONDS = 60;
const DISTILL_AUTO_SESSION = {
  sessionPurpose: "prompt-distill",
  visibility: "hidden",
  ownerFeature: "prompt-distill",
  autoArchive: true,
  createdBy: "system",
} as const;

export const DISTILL_COMMAND_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export type DistillPhase = "idle" | "distilling" | "preview" | "saving";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function resolveDistillFailureCopy(
  t: TranslateFn,
  error: PromptEnhancerError,
  timeoutSeconds: number,
): string {
  switch (error.kind) {
    case "timeout":
      return t("promptDistill.failedTimeout", {
        seconds: timeoutSeconds,
        defaultValue: "Prompt distillation timed out after {{seconds}}s",
      });
    case "empty":
      return t("promptDistill.failedEmpty", {
        defaultValue: "The engine returned an empty distillation",
      });
    case "workspace":
    case "engine":
    default:
      return `${t("promptDistill.failedGeneric", { defaultValue: "Prompt distillation failed" })}: ${error.message}`;
  }
}

function buildIsolatedSessionId(): string {
  return createId("prompt-distill");
}

async function withTimeout<T>(
  request: Promise<T>,
  timeoutSeconds: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutRequest = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(
        new PromptEnhancerError(
          "timeout",
          `prompt distillation timed out after ${timeoutSeconds}s`,
          true,
        ),
      );
    }, timeoutSeconds * 1000);
  });
  try {
    return await Promise.race([request, timeoutRequest]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function requestDistillation(options: {
  workspaceId: string;
  sourceText: string;
  engine: EngineType;
  language: string | undefined;
}): Promise<string> {
  const response = await withTimeout(
    engineSendMessageSync(options.workspaceId, {
      text: buildDistillInstruction(options.sourceText, options.engine, options.language),
      engine: options.engine,
      model: null,
      accessMode: "read-only",
      continueSession: false,
      sessionId: buildIsolatedSessionId(),
      autoSession: DISTILL_AUTO_SESSION,
    }),
    DISTILL_TIMEOUT_SECONDS,
  );
  const distilled = typeof response.text === "string" ? response.text.trim() : "";
  if (!distilled) {
    throw new PromptEnhancerError("empty", "engine returned an empty distillation", true);
  }
  return distilled;
}

/** 默认命令名：从源文本首行取 ASCII slug，取不到则回退常量。 */
export function suggestDistillCommandName(sourceText: string): string {
  const firstLine =
    sourceText
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^([-_])/, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return DISTILL_COMMAND_NAME_RE.test(slug) ? slug : "distilled-prompt";
}

interface UsePromptDistillationOptions {
  workspaceId: string | null;
}

interface UsePromptDistillationReturn {
  isOpen: boolean;
  phase: DistillPhase;
  name: string;
  content: string;
  error: string | null;
  distillingEngine: EngineType;
  start: (sourceText: string) => void;
  setName: (name: string) => void;
  setContent: (content: string) => void;
  save: () => Promise<boolean>;
  close: () => void;
}

export function usePromptDistillation({
  workspaceId,
}: UsePromptDistillationOptions): UsePromptDistillationReturn {
  const { t, i18n } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const languageRef = useRef(i18n?.language as string | undefined);
  languageRef.current = i18n?.language as string | undefined;

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<DistillPhase>("idle");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [distillingEngine, setDistillingEngine] = useState<EngineType>("claude");
  const activeRequestIdRef = useRef(0);

  const close = useCallback(() => {
    activeRequestIdRef.current += 1;
    setIsOpen(false);
    setPhase("idle");
    setError(null);
  }, []);

  const start = useCallback(
    (sourceText: string) => {
      const trimmed = sourceText.trim();
      if (!trimmed) {
        return;
      }
      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;

      setIsOpen(true);
      setPhase("distilling");
      setDistillingEngine("claude");
      setName(suggestDistillCommandName(trimmed));
      setContent("");
      setError(null);

      if (!workspaceId || workspaceId.trim().length === 0) {
        setPhase("preview");
        setError(
          `${tRef.current("promptDistill.failedGeneric", { defaultValue: "Prompt distillation failed" })}: workspace is not ready`,
        );
        return;
      }

      void (async () => {
        try {
          const distilled = await requestDistillation({
            workspaceId,
            sourceText: trimmed,
            engine: "claude",
            language: languageRef.current,
          });
          if (activeRequestIdRef.current !== requestId) {
            return;
          }
          setContent(distilled);
          setPhase("preview");
        } catch (firstError: unknown) {
          if (activeRequestIdRef.current !== requestId) {
            return;
          }
          const classified = classifyPromptEnhancerError(firstError);
          if (classified.retryable) {
            try {
              setDistillingEngine("codex");
              const distilled = await requestDistillation({
                workspaceId,
                sourceText: trimmed,
                engine: "codex",
                language: languageRef.current,
              });
              if (activeRequestIdRef.current !== requestId) {
                return;
              }
              setContent(distilled);
              setPhase("preview");
              return;
            } catch (fallbackError: unknown) {
              if (activeRequestIdRef.current !== requestId) {
                return;
              }
              setError(
                `${resolveDistillFailureCopy(tRef.current, classified, DISTILL_TIMEOUT_SECONDS)} · ${resolveDistillFailureCopy(tRef.current, classifyPromptEnhancerError(fallbackError), DISTILL_TIMEOUT_SECONDS)}`,
              );
              setPhase("preview");
              return;
            }
          }
          setError(
            resolveDistillFailureCopy(tRef.current, classified, DISTILL_TIMEOUT_SECONDS),
          );
          setPhase("preview");
        }
      })();
    },
    [workspaceId],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const normalizedName = name.trim().toLowerCase();
    if (!DISTILL_COMMAND_NAME_RE.test(normalizedName)) {
      setError(
        tRef.current("promptDistill.nameInvalid", {
          defaultValue: "Use lowercase letters, digits, '-' or '_', starting with a letter or digit.",
        }),
      );
      return false;
    }
    if (!content.trim() || !workspaceId) {
      return false;
    }
    setPhase("saving");
    setError(null);
    try {
      await claudeCommandCreate({ workspaceId, name: normalizedName, content: content.trim() });
      pushErrorToast({
        id: "prompt-distill-saved",
        title: tRef.current("promptDistill.savedTitle", { defaultValue: "Prompt saved" }),
        message: tRef.current("promptDistill.savedMessage", {
          name: normalizedName,
          defaultValue: "/{{name}} is now available in slash commands.",
        }),
        variant: "success",
      });
      close();
      return true;
    } catch (saveError: unknown) {
      const message =
        saveError instanceof Error && saveError.message.trim().length > 0
          ? saveError.message
          : String(saveError);
      setError(
        `${tRef.current("promptDistill.failedGeneric", { defaultValue: "Prompt distillation failed" })}: ${message}`,
      );
      setPhase("preview");
      return false;
    }
  }, [close, content, name, workspaceId]);

  return {
    isOpen,
    phase,
    name,
    content,
    error,
    distillingEngine,
    start,
    setName,
    setContent,
    save,
    close,
  };
}
