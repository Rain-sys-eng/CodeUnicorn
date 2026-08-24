import { act, cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Note: prewarmKatexAssets is intentionally NOT awaited in this global
// setup. Awaiting it in beforeAll pushes every test file's mount past
// the testing-library asyncUtilTimeout window because the lazy katex
// chain (katex + rehype-katex + katex.min.css) blocks initial React
// commits in jsdom. Math-specific tests should prewarm in their own
// file-level beforeAll (see Markdown.math-rendering.test.tsx).

// Raise Testing Library's async utility timeout so CI runners (where
// component commit can be 20x slower than local) do not flake on
// waitFor / findBy* assertions. Local runs unaffected because they
// resolve well under 1s.
configure({ asyncUtilTimeout: 5000 });

function waitForReactHostTask(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

async function flushReactSuspenseWork() {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await waitForReactHostTask();
      await Promise.resolve();
    }
  });
}

afterEach(async () => {
  await flushReactSuspenseWork();
  cleanup();
  await flushReactSuspenseWork();
  // composerDraftStore 是模块级单例,不清理会把草稿泄漏到下一个用例。
  const { __resetComposerDraftStoreForTests } = await import(
    "../features/composer/hooks/composerDraftStore"
  );
  __resetComposerDraftStoreForTests();
});

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    value: () => [],
    configurable: true,
  });
}

// Radix primitives (Select, etc.) call scrollIntoView on the active item when
// opening/positioning; jsdom does not implement it. A no-op keeps tests from
// throwing "scrollIntoView is not a function".
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => {},
    configurable: true,
    writable: true,
  });
}

// Mock react-i18next to return keys or fallback text during tests.
// The translation map + interpolation helper live in ./i18nTestMessages.
// vi.mock is hoisted above top-level imports, so the factory must not
// reference a top-level import binding directly; the async factory
// imports the module lazily instead (hoisting-safe pattern).
vi.mock("react-i18next", async () => {
  const { mockTranslate } = await import("./i18nTestMessages");
  return {
    initReactI18next: {
      type: "3rdParty",
      init: vi.fn(),
    },
    useTranslation: () => ({
      t: mockTranslate,
      i18n: {
        language: "en",
        changeLanguage: vi.fn(),
      },
    }),
    getI18n: () => ({
      t: mockTranslate,
      language: "en",
      changeLanguage: vi.fn(),
    }),
  };
});

if (!("IS_REACT_ACT_ENVIRONMENT" in globalThis)) {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    writable: true,
  });
} else {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

if (!("matchMedia" in globalThis)) {
  Object.defineProperty(globalThis, "matchMedia", {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // configurable/writable so suites can swap in a triggerable fake (vi.stubGlobal).
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverMock,
    configurable: true,
    writable: true,
  });
}

if (!("IntersectionObserver" in globalThis)) {
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: IntersectionObserverMock,
  });
}

if (!("requestAnimationFrame" in globalThis)) {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: (id: number) => clearTimeout(id),
  });
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const existingLocalStorage =
  localStorageDescriptor && "value" in localStorageDescriptor
    ? localStorageDescriptor.value
    : null;

if (!existingLocalStorage || typeof (existingLocalStorage as Storage).clear !== "function") {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    writable: true,
    configurable: true,
  });
}

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// Mock client storage to use in-memory cache without Tauri backend
vi.mock("../services/clientStorage", () => {
  const cache: Record<string, Record<string, unknown>> = {};
  return {
    preloadClientStores: vi.fn(() => Promise.resolve()),
    preloadCriticalClientStores: vi.fn(() => Promise.resolve()),
    preloadDeferredClientStores: vi.fn(() => Promise.resolve()),
    isPreloaded: vi.fn(() => true),
    isClientStoreReady: vi.fn(() => true),
    whenClientStoreReady: vi.fn(() => Promise.resolve()),
    subscribeClientStoreHydrated: vi.fn(() => () => {}),
    getClientStoreSync: vi.fn((store: string, key: string) => {
      return cache[store]?.[key];
    }),
    getClientStoreFullSync: vi.fn((store: string) => {
      return cache[store];
    }),
    resetClientStorageForTests: vi.fn(() => {
      Object.keys(cache).forEach((store) => {
        delete cache[store];
      });
    }),
    writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
      if (!cache[store]) cache[store] = {};
      cache[store][key] = value;
    }),
    writeClientStoreData: vi.fn((store: string, data: Record<string, unknown>) => {
      cache[store] = data;
    }),
  };
});

vi.mock("../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));
