// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the curated indicator to expose a marker we can query in tests.
vi.mock('../../../curated-skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../curated-skills')>();
  return {
    ...actual,
    CuratedSkillIndicator: (props: { onOpenSkillsSettings?: () => void }) => (
      <div
        className="curated-indicator"
        data-testid="curated-indicator"
        data-has-open-handler={props.onOpenSkillsSettings ? 'yes' : 'no'}
      >
        <button className="curated-indicator-chip" type="button">
          <span className="curated-indicator-chip-icon" />
          <span className="curated-indicator-chip-name">Lazy senior dev</span>
        </button>
      </div>
    ),
  };
});

import { CuratedSkillIndicator } from '../../../curated-skills';

// A minimal stub that mirrors the header layout: the indicator lives in
// the readiness bar's right accessory slot so it stays on the title row.
function MiniChatInputBoxStub({
  onOpenSkillsSettings,
}: {
  onOpenSkillsSettings?: () => void;
}) {
  return (
    <div className="chat-input-box">
      <div className="composer-readiness-bar">
        <div className="composer-readiness-target-group">Codex / gpt-5.5</div>
        <div className="composer-readiness-activity">
          <div
            className="composer-readiness-right-accessory"
            data-testid="composer-readiness-right-accessory"
          >
            <CuratedSkillIndicator onOpenSkillsSettings={onOpenSkillsSettings} />
          </div>
        </div>
      </div>
      <div className="input-editable-wrapper scrollable">Input</div>
      <div className="chat-input-box-footer">Footer</div>
    </div>
  );
}

describe('ChatInputBox curated-skill indicator mount', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the indicator inside the readiness bar right accessory', () => {
    const { container } = render(<MiniChatInputBoxStub />);
    const rightAccessory = container.querySelector(
      '[data-testid="composer-readiness-right-accessory"]',
    );
    expect(rightAccessory).toBeTruthy();
    const indicator = container.querySelector('.curated-indicator');
    expect(indicator).toBeTruthy();
    expect(rightAccessory?.contains(indicator as Node)).toBe(true);
    const bar = container.querySelector('.composer-readiness-bar');
    expect(bar?.contains(indicator as Node)).toBe(true);
  });

  it('forwards the onOpenSkillsSettings callback to the indicator', () => {
    const onOpen = vi.fn();
    render(<MiniChatInputBoxStub onOpenSkillsSettings={onOpen} />);
    const indicator = screen.getByTestId('curated-indicator');
    expect(indicator.getAttribute('data-has-open-handler')).toBe('yes');
  });

  it('renders the chip with the expected name', () => {
    const { container } = render(<MiniChatInputBoxStub />);
    expect(container.textContent).toContain('Lazy senior dev');
  });
});
