import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function extractUseCallbackBlock(source: string, callbackName: string): string | undefined {
  const declaration = `const ${callbackName} = useCallback(`;
  const start = source.indexOf(declaration);
  if (start === -1) {
    return undefined;
  }

  const openParen = source.indexOf("(", start);
  let depth = 0;

  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

describe("chat input responsiveness guard", () => {
  it("keeps ChatInputBoxAdapter text propagation out of React transitions", () => {
    const source = readSource(
      "src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx",
    );
    const handleInputBlock = extractUseCallbackBlock(source, "handleInput");

    expect(handleInputBlock).toBeTruthy();
    expect(handleInputBlock).toContain("onTextChange(content, null)");
    expect(handleInputBlock).not.toContain("startTransition");
  });

  it("keeps active thread draft updates out of React transitions", () => {
    const source = readSource("src/features/app/hooks/useComposerController.ts");
    const handleDraftChangeBlock = extractUseCallbackBlock(source, "handleDraftChange");

    expect(handleDraftChangeBlock).toBeTruthy();
    // 草稿写入必须走模块级 composerDraftStore(setComposerDraft),不允许退回
    // app-shell 根级 useState——那会让每次按键重渲染整个 app-shell(输入卡顿回归)。
    expect(handleDraftChangeBlock).toContain("setComposerDraft(");
    expect(handleDraftChangeBlock).not.toContain("setComposerDraftsByThread");
    expect(handleDraftChangeBlock).not.toContain("startTransition");
  });

  it("keeps Composer protected by an interaction-safe memo comparator", () => {
    const source = readSource("src/features/composer/components/Composer.tsx");

    expect(source).toContain("COMPOSER_CANVAS_ONLY_PROPS");
    expect(source).toContain("\"threadItemsByThread\"");
    expect(source).toContain("\"threadStatusById\"");
    expect(source).toContain("export const Composer = memo(ComposerGate, areComposerPropsEqual)");
  });

  it("keeps ChatInputBoxAdapter onSelectEffort on stable useCallback identities", () => {
    const source = readSource("src/features/composer/components/Composer.tsx");
    expect(extractUseCallbackBlock(source, "handleSharedEffortChange")).toBeTruthy();
    expect(extractUseCallbackBlock(source, "handleCreationEffortChange")).toBeTruthy();

    const onSelectEffortIndex = source.indexOf("onSelectEffort={");
    expect(onSelectEffortIndex).toBeGreaterThan(-1);
    const jsxSlice = source.slice(onSelectEffortIndex, onSelectEffortIndex + 800);
    expect(jsxSlice).toContain("handleSharedEffortChange");
    expect(jsxSlice).toContain("handleCreationEffortChange");
    expect(jsxSlice).not.toContain("(effort) =>");
  });
});
