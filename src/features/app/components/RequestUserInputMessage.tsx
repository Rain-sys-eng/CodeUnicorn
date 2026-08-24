import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  RequestUserInputRequest,
  RequestUserInputResponse,
  RequestUserInputSettlementResult,
  RequestUserInputSettlementOptions,
} from "../../../types";
import { requestUserInputIdentityKey } from "../../../utils/requestUserInputIdentity";
import {
  getUserInputOptionKey,
  getUserInputOptionValue,
  getUserInputQuestionKey,
  UserInputQuestionCard,
  type UserInputNotesState,
  type UserInputSecretVisibilityState,
  type UserInputSelectionState,
} from "./UserInputQuestionCard";
import {
  buildRecommendedDefaultAnswers,
  hasRecommendedDefaultAnswers,
  USER_INPUT_TIMEOUT_SECONDS,
  USER_INPUT_TIMEOUT_WARNING_SECONDS,
} from "./userInputTimeout";

type RequestUserInputMessageProps = {
  requests: RequestUserInputRequest[];
  activeThreadId: string | null;
  activeWorkspaceId?: string | null;
  onSubmit: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
    options?: RequestUserInputSettlementOptions,
  ) => Promise<RequestUserInputSettlementResult | void> | RequestUserInputSettlementResult | void;
  onDismiss?: (
    request: RequestUserInputRequest,
    options?: RequestUserInputSettlementOptions,
  ) => Promise<RequestUserInputSettlementResult | void> | RequestUserInputSettlementResult | void;
};

type RequestDraftState = {
  selections: UserInputSelectionState;
  notes: UserInputNotesState;
  secretVisible: UserInputSecretVisibilityState;
  activeQuestionIndex: number;
};

const REQUEST_STALE_TIMEOUT_SECONDS = USER_INPUT_TIMEOUT_SECONDS;
const REQUEST_STALE_WARNING_SECONDS = USER_INPUT_TIMEOUT_WARNING_SECONDS;

function getRequestDraftKey(request: RequestUserInputRequest) {
  return requestUserInputIdentityKey(request);
}

function formatRequestCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function RequestUserInputMessage({
  requests,
  activeThreadId,
  activeWorkspaceId,
  onSubmit,
  onDismiss,
}: RequestUserInputMessageProps) {
  const { t } = useTranslation();
  const [locallyCollapsedRequestKeys, setLocallyCollapsedRequestKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [locallySettledRequestKeys, setLocallySettledRequestKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const scopedRequests = useMemo(
    () =>
      requests.filter((request) => {
        const requestKey = getRequestDraftKey(request);
        if (locallySettledRequestKeys.has(requestKey)) {
          return false;
        }
        if (!activeThreadId) {
          return false;
        }
        if (request.params.thread_id !== activeThreadId) {
          return false;
        }
        if (activeWorkspaceId && request.workspace_id !== activeWorkspaceId) {
          return false;
        }
        return true;
      }),
    [requests, activeThreadId, activeWorkspaceId, locallySettledRequestKeys],
  );
  const activeRequests = useMemo(
    () =>
      scopedRequests.filter(
        (request) => !locallyCollapsedRequestKeys.has(getRequestDraftKey(request)),
      ),
    [scopedRequests, locallyCollapsedRequestKeys],
  );
  const collapsedRequest = useMemo(
    () =>
      scopedRequests.find((request) =>
        locallyCollapsedRequestKeys.has(getRequestDraftKey(request)),
      ) ?? null,
    [scopedRequests, locallyCollapsedRequestKeys],
  );
  useEffect(() => {
    const pruneRequestKeys = (current: Set<string>) => {
      if (current.size === 0) {
        return current;
      }
      const liveRequestKeys = new Set(requests.map(getRequestDraftKey));
      let changed = false;
      const next = new Set<string>();
      current.forEach((requestKey) => {
        if (liveRequestKeys.has(requestKey)) {
          next.add(requestKey);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    };
    setLocallyCollapsedRequestKeys(pruneRequestKeys);
    setLocallySettledRequestKeys(pruneRequestKeys);
  }, [requests]);
  const activeRequest = activeRequests[0];
  const activeRequestKey = activeRequest ? getRequestDraftKey(activeRequest) : null;
  const collapsedRequestKey = collapsedRequest ? getRequestDraftKey(collapsedRequest) : null;
  const [draftByRequest, setDraftByRequest] = useState<
    Record<string, RequestDraftState>
  >({});
  const [deadlineByRequest, setDeadlineByRequest] = useState<
    Record<string, number>
  >({});
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timeoutDismissedRequestKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeRequest) {
      return;
    }
    const requestKey = activeRequestKey;
    if (!requestKey) {
      return;
    }
    setDraftByRequest((current) => {
      if (current[requestKey]) {
        return current;
      }
      const nextSelections: UserInputSelectionState = {};
      const nextNotes: UserInputNotesState = {};
      const nextSecretVisible: UserInputSecretVisibilityState = {};
      activeRequest.params.questions.forEach((question, index) => {
        const key = getUserInputQuestionKey(question, index);
        nextSelections[key] = new Set<string>();
        nextNotes[key] = "";
        nextSecretVisible[key] = false;
      });
      return {
        ...current,
        [requestKey]: {
          selections: nextSelections,
          notes: nextNotes,
          secretVisible: nextSecretVisible,
          activeQuestionIndex: 0,
        },
      };
    });
    setDeadlineByRequest((current) => {
      if (typeof current[requestKey] === "number") {
        return current;
      }
      return {
        ...current,
        [requestKey]: Date.now() + REQUEST_STALE_TIMEOUT_SECONDS * 1000,
      };
    });
  }, [activeRequest, activeRequestKey]);

  useEffect(() => {
    setSubmitError(null);
    setIsSubmitting(false);
  }, [activeRequestKey]);

  useEffect(() => {
    if (!activeRequestKey) {
      return undefined;
    }
    const timerId = window.setInterval(() => {
      // 倒计时秒针走 transition，避免每秒 setState 以紧急优先级打断输入等交互。
      startTransition(() => {
        setClockMs(Date.now());
      });
    }, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [activeRequestKey]);

  const remainingSecondsFor = (requestKey: string | null, now = clockMs) => {
    if (!requestKey) {
      return REQUEST_STALE_TIMEOUT_SECONDS;
    }
    const deadline = deadlineByRequest[requestKey];
    if (typeof deadline !== "number") {
      return REQUEST_STALE_TIMEOUT_SECONDS;
    }
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  };
  const activeRemainingSeconds = remainingSecondsFor(activeRequestKey);
  const collapsedRemainingSeconds = remainingSecondsFor(collapsedRequestKey);

  // Timeout: submit the recommended (first) option. Fall back to dismiss only
  // when there is no selectable recommended answer.
  // Must stay above any early return to keep hook order stable.
  useEffect(() => {
    if (
      !activeRequest ||
      !activeRequestKey ||
      isSubmitting ||
      submitError ||
      activeRemainingSeconds > 0 ||
      timeoutDismissedRequestKeysRef.current.has(activeRequestKey)
    ) {
      return;
    }
    timeoutDismissedRequestKeysRef.current.add(activeRequestKey);
    const recommended = buildRecommendedDefaultAnswers(
      activeRequest.params.questions,
    );
    const settlementOptions: RequestUserInputSettlementOptions = {
      staleSettlementHint: "timeout",
    };
    const settleTimeout = hasRecommendedDefaultAnswers(recommended)
      ? () =>
          onSubmit(activeRequest, { answers: recommended }, settlementOptions)
      : () =>
          onDismiss
            ? onDismiss(activeRequest, settlementOptions)
            : Promise.resolve();
    void Promise.resolve(settleTimeout())
      .then(() => {
        setLocallyCollapsedRequestKeys((current) => {
          if (!current.has(activeRequestKey)) {
            return current;
          }
          const next = new Set(current);
          next.delete(activeRequestKey);
          return next;
        });
        setLocallySettledRequestKeys((current) => {
          if (current.has(activeRequestKey)) {
            return current;
          }
          const next = new Set(current);
          next.add(activeRequestKey);
          return next;
        });
        timeoutDismissedRequestKeysRef.current.delete(activeRequestKey);
        setDraftByRequest((current) => {
          if (!current[activeRequestKey]) {
            return current;
          }
          const next = { ...current };
          delete next[activeRequestKey];
          return next;
        });
        setDeadlineByRequest((current) => {
          if (typeof current[activeRequestKey] !== "number") {
            return current;
          }
          const next = { ...current };
          delete next[activeRequestKey];
          return next;
        });
      })
      .catch(() => {
        timeoutDismissedRequestKeysRef.current.delete(activeRequestKey);
        setSubmitError(t("approval.submitFailed"));
      });
  }, [
    activeRemainingSeconds,
    activeRequest,
    activeRequestKey,
    isSubmitting,
    onDismiss,
    onSubmit,
    submitError,
    t,
  ]);

  if (!activeRequest && !collapsedRequest) {
    return null;
  }

  const { questions } = activeRequest?.params ?? collapsedRequest?.params ?? { questions: [] };
  const totalRequests = activeRequests.length;
  const requestKey = activeRequest ? getRequestDraftKey(activeRequest) : "";
  const requestAnchorId = `request-user-input-${encodeURIComponent(requestKey)}`;
  const requestDraft = draftByRequest[requestKey];
  const selections = requestDraft?.selections ?? {};
  const notes = requestDraft?.notes ?? {};
  const secretVisible = requestDraft?.secretVisible ?? {};
  const safeActiveQuestionIndex = Math.min(
    Math.max(requestDraft?.activeQuestionIndex ?? 0, 0),
    Math.max(questions.length - 1, 0),
  );
  const isStaleWarning =
    activeRemainingSeconds <= REQUEST_STALE_WARNING_SECONDS &&
    activeRemainingSeconds > 0;

  const buildAnswers = () => {
    const answers: RequestUserInputResponse["answers"] = {};
    questions.forEach((question, index) => {
      if (!question.id) {
        return;
      }
      const answerList: string[] = [];
      const key = getUserInputQuestionKey(question, index);
      const selectedValues = selections[key] ?? new Set<string>();
      const options = question.options ?? [];
      const hasOptions = options.length > 0;
      if (hasOptions && selectedValues.size > 0) {
        options.forEach((option, optionIndex) => {
          if (!selectedValues.has(getUserInputOptionKey(optionIndex))) {
            return;
          }
          answerList.push(getUserInputOptionValue(option, optionIndex));
        });
      }
      const note = (notes[key] ?? "").trim();
      if (note) {
        if (hasOptions) {
          answerList.push(`user_note: ${note}`);
        } else {
          answerList.push(note);
        }
      }
      answers[question.id] = { answers: answerList };
    });
    return answers;
  };

  const hasAnswerForQuestion = (
    answers: RequestUserInputResponse["answers"],
    questionId: string,
  ) => {
    const values = answers[questionId]?.answers ?? [];
    return values.some((value) => String(value ?? "").trim().length > 0);
  };

  const buildSkippedQuestionIds = () => {
    return questions
      .slice(safeActiveQuestionIndex)
      .map((question) => question.id)
      .filter((questionId) => questionId.trim().length > 0);
  };

  const shouldPreservePartialAnswersOnSkip = (
    answers: RequestUserInputResponse["answers"],
  ) => {
    return questions
      .slice(0, safeActiveQuestionIndex)
      .some((question) => hasAnswerForQuestion(answers, question.id));
  };

  const getSettlementOptions = (
    targetRequestKey: string,
  ): RequestUserInputSettlementOptions | undefined => {
    const targetRemainingSeconds = remainingSecondsFor(targetRequestKey, Date.now());
    return targetRemainingSeconds <= 0 ? { staleSettlementHint: "timeout" } : undefined;
  };

  const submitRequest = (
    targetRequest: RequestUserInputRequest,
    response: RequestUserInputResponse,
    targetRequestKey: string,
  ) => {
    const settlementOptions = getSettlementOptions(targetRequestKey);
    if (settlementOptions) {
      return onSubmit(targetRequest, response, settlementOptions);
    }
    return onSubmit(targetRequest, response);
  };

  const handleOptionToggle = (
    questionId: string,
    optionKey: string,
    multiSelect: boolean,
  ) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      const currentSelected = draft.selections[questionId] ?? new Set<string>();
      const nextSelected = new Set(currentSelected);
      if (multiSelect) {
        if (nextSelected.has(optionKey)) {
          nextSelected.delete(optionKey);
        } else {
          nextSelected.add(optionKey);
        }
      } else if (nextSelected.size === 1 && nextSelected.has(optionKey)) {
        nextSelected.clear();
      } else {
        nextSelected.clear();
        nextSelected.add(optionKey);
      }
      return {
        ...current,
        [requestKey]: {
          ...draft,
          selections: {
            ...draft.selections,
            [questionId]: nextSelected,
          },
        },
      };
    });
  };

  const handleNotesChange = (questionId: string, value: string) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      return {
        ...current,
        [requestKey]: {
          ...draft,
          notes: { ...draft.notes, [questionId]: value },
        },
      };
    });
  };

  const handleToggleSecretVisible = (questionId: string) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      const currentVisible = Boolean(draft.secretVisible[questionId]);
      return {
        ...current,
        [requestKey]: {
          ...draft,
          secretVisible: {
            ...draft.secretVisible,
            [questionId]: !currentVisible,
          },
        },
      };
    });
  };

  const handleQuestionTabChange = (nextQuestionIndex: number) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      return {
        ...current,
        [requestKey]: {
          ...draft,
          activeQuestionIndex: nextQuestionIndex,
        },
      };
    });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submitRequest(activeRequest, { answers: buildAnswers() }, requestKey);
      // Hide the live card immediately so a lagging parent queue cannot leave
      // a second "still open" form after the history shows 已提交.
      settleRequestLocally(requestKey);
    } catch {
      setSubmitError(t("approval.submitFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  function clearRequestDraft(targetRequestKey: string) {
    timeoutDismissedRequestKeysRef.current.delete(targetRequestKey);
    setDraftByRequest((current) => {
      if (!current[targetRequestKey]) {
        return current;
      }
      const next = { ...current };
      delete next[targetRequestKey];
      return next;
    });
    setDeadlineByRequest((current) => {
      if (typeof current[targetRequestKey] !== "number") {
        return current;
      }
      const next = { ...current };
      delete next[targetRequestKey];
      return next;
    });
  }

  function settleRequestLocally(targetRequestKey: string) {
    setLocallyCollapsedRequestKeys((current) => {
      if (!current.has(targetRequestKey)) {
        return current;
      }
      const next = new Set(current);
      next.delete(targetRequestKey);
      return next;
    });
    setLocallySettledRequestKeys((current) => {
      if (current.has(targetRequestKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(targetRequestKey);
      return next;
    });
    clearRequestDraft(targetRequestKey);
  }

  const collapseActiveRequestLocally = () => {
    setLocallyCollapsedRequestKeys((current) => {
      if (current.has(requestKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(requestKey);
      return next;
    });
  };

  const expandRequestLocally = (targetRequestKey: string) => {
    setLocallyCollapsedRequestKeys((current) => {
      if (!current.has(targetRequestKey)) {
        return current;
      }
      const next = new Set(current);
      next.delete(targetRequestKey);
      return next;
    });
  };

  const handleClose = () => {
    setSubmitError(null);
    collapseActiveRequestLocally();
  };

  const buildAllSkippedQuestionIds = (
    targetRequest: RequestUserInputRequest,
  ) => {
    return targetRequest.params.questions
      .map((question) => question.id)
      .filter((questionId) => questionId.trim().length > 0);
  };

  const handleSkip = async (
    targetRequest: RequestUserInputRequest,
    targetRequestKey: string,
  ) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      // Skip MUST use the same runtime path as submit (not dismiss-only local hide).
      // Empty answers + skippedQuestionIds unblocks MCP and writes durable audit.
      const answers =
        targetRequest === activeRequest ? buildAnswers() : {};
      const preservePartial =
        targetRequest === activeRequest &&
        shouldPreservePartialAnswersOnSkip(answers);
      const skippedQuestionIds = preservePartial
        ? buildSkippedQuestionIds()
        : buildAllSkippedQuestionIds(targetRequest);
      // onSubmit is required; skip always goes through submit with skippedQuestionIds.
      await submitRequest(
        targetRequest,
        {
          answers: preservePartial ? answers : {},
          ...(skippedQuestionIds.length > 0 ? { skippedQuestionIds } : {}),
        },
        targetRequestKey,
      );
      settleRequestLocally(targetRequestKey);
    } catch {
      setSubmitError(t("approval.submitFailed"));
      expandRequestLocally(targetRequestKey);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!activeRequest && collapsedRequest && collapsedRequestKey) {
    return (
      <div className="message request-user-input-message">
        <div
          className="request-user-input-collapsed"
          role="group"
          aria-label={t("approval.collapsedUserInputRequest")}
          data-request-user-input-id={String(collapsedRequest.request_id)}
          data-request-user-input-key={collapsedRequestKey}
          data-workspace-id={collapsedRequest.workspace_id}
          data-thread-id={collapsedRequest.params.thread_id}
        >
          <div className="request-user-input-collapsed-main">
            <span className="request-user-input-collapsed-title">
              {t("approval.inputRequested")}
            </span>
            <span
              className="request-user-input-collapsed-timer"
              aria-hidden="true"
            >
              {formatRequestCountdown(collapsedRemainingSeconds)}
            </span>
          </div>
          {submitError ? (
            <div className="request-user-input-collapsed-error">
              {submitError}
            </div>
          ) : null}
          <div className="request-user-input-collapsed-actions">
            <button
              type="button"
              className="request-user-input-collapsed-expand"
              onClick={() => expandRequestLocally(collapsedRequestKey)}
              disabled={isSubmitting}
            >
              {t("approval.expandUserInputRequest")}
            </button>
            <button
              type="button"
              className="request-user-input-dismiss"
              onClick={() => void handleSkip(collapsedRequest, collapsedRequestKey)}
              disabled={isSubmitting}
              aria-label={t("approval.skipUserInputRequest")}
              title={t("approval.skipUserInputRequest")}
            >
              {t("approval.skipAndContinue")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeRequest) {
    return null;
  }

  return (
    <div className="message request-user-input-message">
      <UserInputQuestionCard
        id={requestAnchorId}
        flavor="request"
        className="request-user-input-live-card"
        role="group"
        tabIndex={-1}
        title={t("approval.inputRequested")}
        queueLabel={
          totalRequests > 1
            ? t("approval.requestOf", { current: 1, total: totalRequests })
            : null
        }
        questions={questions}
        activeQuestionIndex={safeActiveQuestionIndex}
        remainingSecondsLabel={formatRequestCountdown(activeRemainingSeconds)}
        isTimeWarning={isStaleWarning}
        selections={selections}
        notes={notes}
        secretVisible={secretVisible}
        submitError={submitError}
        isSubmitting={isSubmitting}
        dataAttributes={{
          "data-request-user-input-id": String(activeRequest.request_id),
          "data-request-user-input-key": requestKey,
          "data-workspace-id": activeRequest.workspace_id,
          "data-thread-id": activeRequest.params.thread_id,
        }}
        onQuestionTabChange={handleQuestionTabChange}
        onOptionToggle={handleOptionToggle}
        onNotesChange={handleNotesChange}
        onToggleSecret={handleToggleSecretVisible}
        onClose={handleClose}
        onDismiss={() => void handleSkip(activeRequest, requestKey)}
        onSubmit={() => void handleSubmit()}
      />
    </div>
  );
}
