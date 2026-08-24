import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import type { QueuedMessage } from './types';

const MESSAGE_QUEUE_PREVIEW_LIMIT = 120;

function buildMessageQueuePreview(content: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  if (normalizedContent.length <= MESSAGE_QUEUE_PREVIEW_LIMIT) {
    return normalizedContent;
  }
  return `${normalizedContent.slice(0, MESSAGE_QUEUE_PREVIEW_LIMIT - 1)}…`;
}

function isFuseEligibleQueuedContent(content: string): boolean {
  const normalizedContent = content.trim();
  return normalizedContent.length > 0 && !normalizedContent.startsWith('/');
}

function resolveQueueItemStatus({
  canFuse,
  fullContent,
  isFusing,
  isPendingAck,
}: {
  canFuse: boolean;
  fullContent: string;
  isFusing: boolean;
  isPendingAck?: boolean;
}) {
  if (isFusing) {
    return 'composer.queueStatusFusing';
  }
  // Shared 已发出、等 commit ACK（防双发）：优先于「排队到下一轮」
  if (isPendingAck) {
    return 'composer.queueStatusPendingAck';
  }
  if (canFuse && isFuseEligibleQueuedContent(fullContent)) {
    return 'composer.queueStatusFuseReady';
  }
  if (fullContent.trim().startsWith('/')) {
    return 'composer.queueStatusCommand';
  }
  return 'composer.queueStatusWaiting';
}

export interface MessageQueueProps {
  /** Queue items */
  queue: QueuedMessage[];
  /** Remove item callback */
  onRemove: (
    id: string,
    options?: { confirmedPendingAck?: boolean },
  ) => void | Promise<boolean | void>;
  /** Fuse item callback */
  onFuse?: (id: string) => void;
  /** Whether fuse is available */
  canFuse?: boolean;
  /**
   * 全局融合不可用时的 i18n key（如 chat.fuseDisabledNoActiveTurn）。
   * 仅在 canFuse=false 时用于按钮 title，避免“点了没反应”。
   */
  fuseDisabledReasonKey?: string | null;
  /** Message id currently being fused */
  fusingMessageId?: string | null;
}

/**
 * MessageQueue - Displays queued messages above input box
 * Shows numbered list with message preview and close button
 */
export function MessageQueue({
  queue,
  onRemove,
  onFuse,
  canFuse = false,
  fuseDisabledReasonKey = null,
  fusingMessageId = null,
}: MessageQueueProps) {
  const { t } = useTranslation();
  const [pendingAckRemovalId, setPendingAckRemovalId] = useState<string | null>(
    null,
  );
  const [isAbandoningPendingAck, setIsAbandoningPendingAck] = useState(false);

  const confirmPendingAckRemoval = async () => {
    if (!pendingAckRemovalId || isAbandoningPendingAck) {
      return;
    }
    setIsAbandoningPendingAck(true);
    try {
      const removed = await onRemove(pendingAckRemovalId, {
        confirmedPendingAck: true,
      });
      if (removed !== false) {
        setPendingAckRemovalId(null);
      }
    } finally {
      setIsAbandoningPendingAck(false);
    }
  };

  if (queue.length === 0) {
    return null;
  }

  return (
    <>
      <div className="message-queue">
      {/* Render in reverse order so newest is at bottom (closest to input) */}
      {[...queue].reverse().map((item, reversedIndex) => {
        // Calculate actual queue position (1-based, from bottom)
        const queuePosition = queue.length - reversedIndex;
        const fullContent = item.fullContent ?? item.content;
        const previewContent = buildMessageQueuePreview(item.content);
        const isFusing = item.isFusing || item.id === fusingMessageId;
        const isPendingAck = Boolean(item.isPendingAck);
        // pending-ack 不允许融合（与 useQueuedSend isQueuedMessageFuseEligible 一致）
        const canFuseItem =
          canFuse &&
          !isPendingAck &&
          isFuseEligibleQueuedContent(fullContent);
        const statusKey = resolveQueueItemStatus({
          canFuse,
          fullContent,
          isFusing,
          isPendingAck,
        });
        return (
          <div
            key={item.id}
            className={
              isPendingAck
                ? 'message-queue-item is-pending-ack'
                : 'message-queue-item'
            }
          >
            <span className="message-queue-number">{queuePosition}</span>
            <span
              className="message-queue-content"
              title={fullContent}
              aria-label={fullContent}
            >
              {previewContent}
            </span>
            <span
              className={
                isPendingAck
                  ? 'message-queue-status is-pending-ack'
                  : 'message-queue-status'
              }
              title={t(statusKey)}
            >
              {t(statusKey)}
            </span>
            <div className="message-queue-actions">
              <button
                type="button"
                className="message-queue-action message-queue-fuse"
                onClick={() => onFuse?.(item.id)}
                disabled={!canFuseItem || isFusing}
                aria-disabled={!canFuseItem || isFusing}
                title={
                  isFusing
                    ? t('chat.fusingQueuedMessage')
                    : !canFuseItem
                      ? t(
                          fuseDisabledReasonKey ||
                            (isPendingAck
                              ? 'chat.fuseDisabledPendingAck'
                              : !isFuseEligibleQueuedContent(fullContent)
                                ? 'chat.fuseDisabledCommand'
                                : 'chat.fuseDisabledUnavailable'),
                        )
                      : t(statusKey)
                }
              >
                {isFusing ? t('chat.fusingQueuedMessage') : t('chat.fuseFromQueue')}
              </button>
              <button
                type="button"
                className="message-queue-action message-queue-remove"
                onClick={() => {
                  if (isPendingAck) {
                    setPendingAckRemovalId(item.id);
                    return;
                  }
                  void onRemove(item.id);
                }}
                disabled={isFusing}
                aria-disabled={isFusing}
                title={
                  isPendingAck
                    ? t(statusKey)
                    : t('chat.removeFromQueue')
                }
              >
                {t('chat.deleteQueuedMessage')}
              </button>
            </div>
          </div>
        );
      })}
      </div>
      <ConfirmDialog
        open={pendingAckRemovalId !== null}
        title={t('sharedSend.recoverySkipConfirmTitle')}
        body={t('sharedSend.recoverySkipConfirm')}
        confirmText={t('sharedSend.recoverySkipConfirmAction')}
        danger
        onCancel={() => {
          if (!isAbandoningPendingAck) {
            setPendingAckRemovalId(null);
          }
        }}
        onConfirm={() => {
          void confirmPendingAckRemoval();
        }}
      />
    </>
  );
}
