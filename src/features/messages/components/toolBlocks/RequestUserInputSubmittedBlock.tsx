import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type { ConversationItem } from '../../../../types';

type SubmittedQuestion = {
  id: string;
  header: string;
  question: string;
  options?: Array<{ label: string; description: string }>;
  selectedOptions: string[];
  note: string;
};

type SubmittedPayload = {
  schema: 'requestUserInputSubmitted/v1';
  submittedAt: number;
  questions: SubmittedQuestion[];
};

interface RequestUserInputSubmittedBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
}

function parseSubmittedPayload(detail: string): SubmittedPayload | null {
  if (!detail.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(detail) as Partial<SubmittedPayload> | null;
    if (!parsed || parsed.schema !== 'requestUserInputSubmitted/v1') {
      return null;
    }
    if (!Array.isArray(parsed.questions)) {
      return null;
    }
    return {
      schema: 'requestUserInputSubmitted/v1',
      submittedAt:
        typeof parsed.submittedAt === 'number' ? parsed.submittedAt : Date.now(),
      questions: parsed.questions.map((question) => ({
        id: typeof question?.id === 'string' ? question.id : '',
        header: typeof question?.header === 'string' ? question.header : '',
        question: typeof question?.question === 'string' ? question.question : '',
        options: Array.isArray(question?.options)
          ? question.options
              .map((option) => ({
                label: typeof option?.label === 'string' ? option.label : '',
                description:
                  typeof option?.description === 'string' ? option.description : '',
              }))
              .filter((option) => option.label || option.description)
          : undefined,
        selectedOptions: Array.isArray(question?.selectedOptions)
          ? question.selectedOptions.filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
          : [],
        note: typeof question?.note === 'string' ? question.note : '',
      })),
    };
  } catch {
    return null;
  }
}

function formatQuestionAnswerSummary(
  question: SubmittedQuestion,
  noneLabel: string,
): string {
  const parts = [
    ...question.selectedOptions.map((value) => value.trim()).filter(Boolean),
    question.note.trim() ? question.note.trim() : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : noneLabel;
}

function questionTitle(question: SubmittedQuestion): string {
  return question.header.trim() || question.question.trim() || '';
}

/**
 * Flat fold control aligned with MiddleStepsCollapsedChip / 「已处理 · … ›」:
 *   已提交 · 部署环境 无 ›
 *   ────────────────────────
 */
export const RequestUserInputSubmittedBlock = memo(
  function RequestUserInputSubmittedBlock({
    item,
  }: RequestUserInputSubmittedBlockProps) {
    const { t } = useTranslation();
    const payload = useMemo(() => parseSubmittedPayload(item.detail), [item.detail]);
    // Default collapsed — only the process-phase-style summary row is visible.
    const [isExpanded, setIsExpanded] = useState(false);
    const noneLabel = t('approval.none');
    const submittedLabel = t('approval.submitted');

    const summarySegments = useMemo(() => {
      if (!payload || payload.questions.length === 0) {
        const fallback = (item.output || noneLabel).trim();
        return fallback ? [fallback] : [noneLabel];
      }
      return payload.questions.map((question) => {
        const title = questionTitle(question);
        const answer = formatQuestionAnswerSummary(question, noneLabel);
        return title ? `${title} ${answer}` : answer;
      });
    }, [item.output, noneLabel, payload]);

    const collapsedLabel = useMemo(() => {
      const detail = summarySegments.join('  ');
      return detail ? `${submittedLabel} · ${detail}` : submittedLabel;
    }, [submittedLabel, summarySegments]);

    const ariaLabel = `${collapsedLabel}. ${
      isExpanded
        ? t('approval.collapseUserInputRequest')
        : t('approval.expandUserInputRequest')
    }`;

    // Expanded body: canvas-flat Q → answer rows only (no option grid / no card chrome).
    const expandedBody =
      payload && payload.questions.length > 0 ? (
        <div className="request-user-input-submitted-detail">
          {payload.questions.map((question, index) => {
            const questionId = question.id || `submitted-question-${index}`;
            const title = questionTitle(question);
            const answer = formatQuestionAnswerSummary(question, noneLabel);
            return (
              <section
                key={questionId}
                className="request-user-input-submitted-detail-row"
              >
                {title ? (
                  <div className="request-user-input-submitted-detail-label">
                    {title}
                  </div>
                ) : null}
                {question.question && question.question !== title ? (
                  <div className="request-user-input-submitted-detail-prompt">
                    {question.question}
                  </div>
                ) : null}
                <div className="request-user-input-submitted-detail-answer">
                  {answer}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="request-user-input-submitted-detail is-fallback">
          {item.output || noneLabel}
        </div>
      );

    return (
      <div
        className={`request-user-input-submitted-drawer${
          isExpanded ? ' is-expanded' : ' is-collapsed'
        }`}
      >
        <button
          type="button"
          className={`request-user-input-submitted-toggle${
            isExpanded ? ' is-expanded' : ' is-collapsed'
          }`}
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          aria-label={ariaLabel}
        >
          <span className="request-user-input-submitted-toggle-copy">
            <span className="request-user-input-submitted-toggle-label">
              {collapsedLabel}
            </span>
            <ChevronRight
              className="request-user-input-submitted-toggle-chevron"
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </span>
          <span className="request-user-input-submitted-toggle-rule" aria-hidden />
        </button>
        {isExpanded ? (
          <div className="request-user-input-submitted-slot is-expanded">
            <div className="request-user-input-submitted-slot-inner">
              {expandedBody}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
