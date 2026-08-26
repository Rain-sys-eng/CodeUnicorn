import { describe, expect, it } from "vitest";
import en from "./en/piSession";
import es from "./es/piSession";
import fr from "./fr/piSession";
import hi from "./hi/piSession";
import ja from "./ja/piSession";
import ko from "./ko/piSession";
import ptBR from "./pt-BR/piSession";
import ru from "./ru/piSession";
import zh from "./zh/piSession";
import zhTW from "./zh-TW/piSession";

const locales = { es, fr, hi, ja, ko, "pt-BR": ptBR, ru, zh, "zh-TW": zhTW };

type Bundle = { piSession: Record<string, unknown> };

function flattenKeys(node: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

function valueAt(node: Record<string, unknown>, path: string): string {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, segment) => (acc as Record<string, unknown>)[segment],
      node,
    ) as string;
}

function placeholders(value: string) {
  return (value.match(/\{\{[^}]+\}\}/g) ?? []).sort();
}

describe("piSession locale parity", () => {
  const enKeys = flattenKeys((en as Bundle).piSession).sort();

  it.each(Object.entries(locales))(
    "%s mirrors the English keys and interpolation placeholders",
    (_language, locale) => {
      const bundle = (locale as Bundle).piSession;
      expect(flattenKeys(bundle).sort()).toEqual(enKeys);
      enKeys.forEach((path) => {
        expect(placeholders(valueAt(bundle, path))).toEqual(
          placeholders(valueAt((en as Bundle).piSession, path)),
        );
      });
    },
  );
});
