// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReasoningSelect } from './ReasoningSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ReasoningSelect', () => {
  it('shows the selected effort trigger with icon, label and chevron', () => {
    const { container } = render(
      <ReasoningSelect
        value="low"
        onChange={vi.fn()}
        options={['low', 'medium']}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Low' });

    // The primary-row pill always shows its label and chevron so it reads the
    // same as the model / permission pills next to it.
    expect(trigger.querySelector('.selector-button-text')?.textContent).toBe('Low');
    expect(trigger.querySelector('.codicon-lightbulb-empty')).toBeTruthy();
    expect(trigger.querySelector('[class*="codicon-chevron"]')).toBeTruthy();
    expect(container.querySelector('.selector-reasoning-button.is-icon-only')).toBeNull();
  });

  it('renders the default trigger with label and chevron', () => {
    const { container } = render(
      <ReasoningSelect
        value={null}
        onChange={vi.fn()}
        options={['low', 'medium']}
        showDefaultOption
        defaultLabel="Claude 默认"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Claude 默认' });

    expect(trigger.querySelector('.selector-button-text')?.textContent).toBe('Claude 默认');
    expect(trigger.querySelector('[class*="codicon-chevron"]')).toBeTruthy();
    expect(container.querySelector('.selector-reasoning-button.is-icon-only')).toBeNull();
  });

  it('does not fall back to all levels when explicit options are empty', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ReasoningSelect
        value={null}
        onChange={vi.fn()}
        options={[]}
        showDefaultOption
        defaultLabel="Claude 默认"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Claude 默认/i }));
    await waitFor(() => {
      expect(document.body.querySelector('[data-reasoning-id]')).toBeTruthy();
    });

    expect(screen.getAllByText('Claude 默认')).toHaveLength(2);
    expect(screen.queryByText('Low')).toBeNull();
    expect(screen.queryByText('Medium')).toBeNull();
    expect(screen.queryByText('High')).toBeNull();
    expect(screen.queryByText('Extra High')).toBeNull();
    expect(screen.queryByText('Max')).toBeNull();
  });

  it('renders and selects the DSH off effort', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    render(
      <ReasoningSelect
        value="high"
        onChange={onChange}
        options={['off', 'low', 'high', 'max']}
        showDefaultOption
        defaultLabel="Default"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'High' }));
    await user.click(await screen.findByText('Off'));

    expect(onChange).toHaveBeenCalledWith('off');
  });

  it('renders and selects the runtime ultra effort', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    render(
      <ReasoningSelect
        value="low"
        onChange={onChange}
        options={['low', 'ultra']}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Low' }));
    await user.click(await screen.findByText('Ultra'));

    expect(onChange).toHaveBeenCalledWith('ultra');
  });
});
