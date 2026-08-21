// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatInputBox } from "./ChatInputBox";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    initReactI18next: {
      type: "3rdParty" as const,
      init: () => {},
    },
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

function setEditableText(editable: HTMLDivElement, text: string) {
  editable.innerText = text;
  let textNode = editable.firstChild as Text | null;
  if (!(textNode instanceof Text)) {
    textNode = document.createTextNode(text);
    editable.innerHTML = "";
    editable.appendChild(textNode);
  }
  textNode.textContent = text;
}

describe("ChatInputBox submit button", () => {
  afterEach(() => {
    cleanup();
  });

  it("opts the editable wrapper into the shared thin scrollbar", () => {
    render(<ChatInputBox showHeader={false} />);

    const wrapper = document.querySelector(".input-editable-wrapper");
    expect(wrapper?.classList.contains("scrollable")).toBe(true);
  });

  it("enables the send button immediately after plain text input", () => {
    render(<ChatInputBox showHeader={false} />);

    const editable = document.querySelector(".input-editable") as HTMLDivElement | null;
    expect(editable).toBeTruthy();
    if (!editable) {
      return;
    }

    const sendButton = screen.getByTitle("chat.sendMessageEnter") as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    editable.focus();
    setEditableText(editable, "00000000000000000000");
    fireEvent.input(editable);

    expect(sendButton.disabled).toBe(false);
  });

  it("submits and clears an editable draft when submission is allowed", async () => {
    const onSubmit = vi.fn();
    render(<ChatInputBox showHeader={false} onSubmit={onSubmit} />);

    const editable = document.querySelector(".input-editable") as HTMLDivElement | null;
    expect(editable).toBeTruthy();
    if (!editable) {
      return;
    }

    setEditableText(editable, "可以发送");
    fireEvent.input(editable);
    fireEvent.keyDown(editable, { key: "Enter", code: "Enter", keyCode: 13 });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("可以发送", undefined);
    });
    expect(editable.textContent).toBe("");
  });

  it("keeps draft editable but blocks submit while submission is disabled", () => {
    const onSubmit = vi.fn();
    render(
      <ChatInputBox
        showHeader={false}
        submitDisabled
        onSubmit={onSubmit}
      />,
    );

    const editable = document.querySelector(".input-editable") as HTMLDivElement | null;
    expect(editable).toBeTruthy();
    expect(editable?.getAttribute("contenteditable")).toBe("true");
    if (!editable) {
      return;
    }

    setEditableText(editable, "下一条草稿");
    fireEvent.input(editable);
    fireEvent.keyDown(editable, { key: "Enter", code: "Enter", keyCode: 13 });

    expect(
      (screen.getByTitle("chat.sendMessageEnter") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(editable.textContent).toBe("下一条草稿");
  });
});
