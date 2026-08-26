// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playNotificationSoundBySelection } from "./notificationSounds";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

type NavigatorStub = {
  platform: string;
  userAgent: string;
  userAgentData?: { platform?: string };
};

const originalNavigator = {
  platform: navigator.platform,
  userAgent: navigator.userAgent,
  userAgentData: (navigator as NavigatorStub).userAgentData,
};
const originalWebServiceRuntime = window.__MOSSX_WEB_SERVICE__;

function stubNavigator(platform: string, userAgent: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: { platform },
  });
}

function restoreNavigator() {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: originalNavigator.platform,
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: originalNavigator.userAgent,
  });
  if (originalNavigator.userAgentData === undefined) {
    delete (navigator as NavigatorStub).userAgentData;
    return;
  }
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: originalNavigator.userAgentData,
  });
}

describe("playNotificationSoundBySelection linux webkit guard", () => {
  const audioCtor = vi.fn(() => ({
    volume: 1,
    preload: "auto",
    addEventListener: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
  }));

  beforeEach(() => {
    audioCtor.mockClear();
    vi.stubGlobal("Audio", audioCtor);
    delete window.__MOSSX_WEB_SERVICE__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreNavigator();
    if (originalWebServiceRuntime === undefined) {
      delete window.__MOSSX_WEB_SERVICE__;
    } else {
      window.__MOSSX_WEB_SERVICE__ = originalWebServiceRuntime;
    }
  });

  it("does not construct HTMLAudioElement on Linux native webview", () => {
    stubNavigator("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
    const onDebug = vi.fn();

    playNotificationSoundBySelection({
      soundId: "default",
      label: "notification",
      onDebug,
    });

    expect(audioCtor).not.toHaveBeenCalled();
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "client",
        label: "audio/notification linux webkit skip",
      }),
    );
  });

  it("still constructs HTMLAudioElement on macOS", async () => {
    stubNavigator(
      "MacIntel",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );

    playNotificationSoundBySelection({
      soundId: "default",
      label: "notification",
    });

    await vi.waitFor(() => {
      expect(audioCtor).toHaveBeenCalledTimes(1);
    });
  });

  it("still constructs HTMLAudioElement on Windows", async () => {
    stubNavigator("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

    playNotificationSoundBySelection({
      soundId: "default",
      label: "notification",
    });

    await vi.waitFor(() => {
      expect(audioCtor).toHaveBeenCalledTimes(1);
    });
  });

  it("still constructs HTMLAudioElement on Linux web-service runtime", async () => {
    stubNavigator("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
    window.__MOSSX_WEB_SERVICE__ = true;

    playNotificationSoundBySelection({
      soundId: "default",
      label: "notification",
    });

    await vi.waitFor(() => {
      expect(audioCtor).toHaveBeenCalledTimes(1);
    });
  });
});
