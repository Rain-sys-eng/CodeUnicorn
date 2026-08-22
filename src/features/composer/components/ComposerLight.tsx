/**
 * 轻量 Composer：只挂 ChatInputBoxAdapter（不跑完整 ComposerImpl 重 hooks）。
 *
 * UX：
 * - 必须有 sendReadiness，才能渲染 ReadinessBar（模型位所在行）
 * - 不传 onExecutionTargetChange，避免 atomic catalog 冷启重路径导致假死
 * - 模型未就绪：静态模型位只显示「加载中」；就绪后只替换为模型名（都不带 CLI）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ChatInputBoxAdapter } from "./ChatInputBox/ChatInputBoxAdapter";
import {
  accessModeToPermissionMode,
  permissionModeToAccessMode,
} from "./ChatInputBox/types";
import { useComposerDraft } from "../hooks/composerDraftStore";
import { getComposerEnginePrefForEngine } from "../hooks/composerEnginePrefsStore";
import { buildComposerSendReadiness } from "../utils/composerSendReadiness";
import { resolveDshComposerAgentPreset } from "./ChatInputBox/selectors/dshAgentPresets";
import type { ComposerProps } from "./Composer";

type Props = ComposerProps;

export function ComposerLight({
  onSend,
  onQueue,
  onStop,
  canStop,
  disabled = false,
  submitDisabled = false,
  isProcessing,
  selectedEngine,
  engines,
  models,
  providerModelCatalogs,
  providerProfileId,
  selectedModelId,
  onSelectModel: _onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  skills: _skills,
  prompts: _prompts,
  files: _files,
  accountRateLimits = null,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  queuedMessages = [],
  onDeleteQueued,
  onFuseQueued,
  canFuseQueuedMessages = false,
  fuseDisabledReasonKey = null,
  fusingQueuedMessageId = null,
  attachedImages = [],
  onPickImages,
  onAttachImages,
  onRemoveImage,
  onDraftChange,
  activeThreadId = null,
  isSharedSession = false,
  createSessionTargetPicker = false,
  textareaHeight = 80,
  onTextareaHeightChange,
  steerEnabled = false,
  onSelectEngine: _onSelectEngine,
  dshAgentPreset: sessionDshAgentPreset = null,
  items = [],
}: Props) {
  const { t } = useTranslation();
  const draftText = useComposerDraft(activeThreadId);
  const [text, setText] = useState(draftText);

  useEffect(() => {
    setText((prev) => (prev === draftText ? prev : draftText));
  }, [draftText]);

  const handleTextChange = useCallback(
    (next: string) => {
      setText(next);
      onDraftChange?.(next);
    },
    [onDraftChange],
  );

  const handleSend = useCallback(
    (submittedText?: string, submittedImages?: string[]) => {
      const content = (submittedText ?? text).trim();
      const images = submittedImages ?? attachedImages ?? [];
      if (!content && images.length === 0) {
        return;
      }
      const dshSendOptions =
        selectedEngine === "dsh"
          ? {
              dshAgentPreset: resolveDshComposerAgentPreset({
                threadId: activeThreadId,
                sessionHeader: sessionDshAgentPreset,
                draftOrPref:
                  getComposerEnginePrefForEngine("dsh").dshAgentPreset,
                hasUserMessages: items.some(
                  (item) => item.kind === "message" && item.role === "user",
                ),
              }).value,
            }
          : undefined;
      if (isProcessing && !steerEnabled) {
        void onQueue(content, images, dshSendOptions);
        return;
      }
      void onSend(content, images, dshSendOptions);
    },
    [
      activeThreadId,
      attachedImages,
      isProcessing,
      items,
      onQueue,
      onSend,
      selectedEngine,
      sessionDshAgentPreset,
      text,
      steerEnabled,
    ],
  );

  const handleModeSelect = useCallback(
    (
      mode: Parameters<
        NonNullable<ComponentProps<typeof ChatInputBoxAdapter>["onModeSelect"]>
      >[0],
    ) => {
      onSelectAccessMode(permissionModeToAccessMode(mode));
    },
    [onSelectAccessMode],
  );

  const selectedPermissionMode = accessModeToPermissionMode(accessMode);
  const selectedEngineInfo = engines?.find(
    (entry) => entry.type === selectedEngine,
  );
  const selectedModelOption = models?.find(
    (entry) => entry.id === selectedModelId,
  );
  const modelReady = Boolean(
    selectedModelId?.trim() ||
      selectedModelOption?.displayName ||
      selectedModelOption?.model,
  );

  // 驱动 ReadinessBar：模型位始终占位；未就绪显示「加载中」
  const sendReadiness = useMemo(
    () =>
      buildComposerSendReadiness({
        engine: selectedEngine ?? "claude",
        providerLabel:
          selectedEngineInfo?.shortName ||
          selectedEngineInfo?.displayName ||
          selectedEngine ||
          "Claude Code",
        modelLabel: modelReady
          ? selectedModelOption?.displayName ||
            selectedModelOption?.model ||
            selectedModelId ||
            ""
          : t("models.loading", { defaultValue: "加载中" }),
        modeLabel: t(
          selectedEngine === "dsh"
            ? `dshModes.${selectedPermissionMode}.label`
            : `modes.${selectedPermissionMode}.label`,
          {
            defaultValue: selectedPermissionMode,
          },
        ),
        modeImpactLabel: t(`composer.readinessModeImpact.${accessMode}`, {
          defaultValue: accessMode,
        }),
        accessMode,
        draftText: text,
        hasAttachments: attachedImages.length > 0,
        isProcessing,
        canQueue: Boolean(onQueue),
        canStop,
        configLoading: !modelReady,
      }),
    [
      accessMode,
      attachedImages.length,
      canStop,
      isProcessing,
      modelReady,
      onQueue,
      selectedEngine,
      selectedEngineInfo?.displayName,
      selectedEngineInfo?.shortName,
      selectedModelId,
      selectedModelOption?.displayName,
      selectedModelOption?.model,
      selectedPermissionMode,
      t,
      text,
    ],
  );

  // 必须与完整 Composer 同用 footer.composer，才能吃到 max-width:750px，避免先全宽再变窄
  return (
    <footer className="composer" data-testid="composer-light">
      <div className="composer-shell">
      <ChatInputBoxAdapter
        text={text}
        disabled={disabled}
        submitDisabled={submitDisabled}
        isProcessing={isProcessing}
        canStop={canStop}
        onSend={handleSend}
        onStop={onStop}
        onTextChange={handleTextChange}
        selectedModelId={selectedModelId}
        selectedEngine={selectedEngine}
        isSharedSession={isSharedSession}
        providerTargetPickerMode={
          isSharedSession && !createSessionTargetPicker
            ? "shared"
            : "create-session"
        }
        threadId={activeThreadId}
        engines={engines}
        models={models}
        providerModelCatalogs={providerModelCatalogs}
        providerProfileId={providerProfileId}
        // 故意不传 onExecutionTargetChange：避免 atomic catalog 冷启重路径假死。
        // 有 sendReadiness 时 ReadinessBar 用静态模型位（loading → 真名）。
        sendReadiness={sendReadiness}
        reasoningOptions={reasoningOptions}
        selectedEffort={selectedEffort}
        onSelectEffort={onSelectEffort}
        reasoningSupported={reasoningSupported}
        permissionMode={selectedPermissionMode}
        onModeSelect={handleModeSelect}
        attachments={attachedImages}
        onAddAttachment={onPickImages}
        onAttachImages={onAttachImages}
        onRemoveAttachment={onRemoveImage}
        textareaHeight={textareaHeight}
        onHeightChange={onTextareaHeightChange}
        accountRateLimits={accountRateLimits}
        usageShowRemaining={usageShowRemaining}
        onRefreshAccountRateLimits={onRefreshAccountRateLimits}
        queuedMessages={queuedMessages}
        onDeleteQueued={onDeleteQueued}
        onFuseQueued={onFuseQueued}
        canFuseQueuedMessages={canFuseQueuedMessages}
        fuseDisabledReasonKey={fuseDisabledReasonKey}
        fusingQueuedMessageId={fusingQueuedMessageId}
        isModelConfigRefreshing={!modelReady}
      />
      </div>
    </footer>
  );
}
