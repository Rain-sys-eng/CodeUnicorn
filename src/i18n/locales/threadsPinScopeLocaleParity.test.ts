import { describe, expect, it } from "vitest";
import en from "./en/threads";
import es from "./es/threads";
import fr from "./fr/threads";
import hi from "./hi/threads";
import ja from "./ja/threads";
import ko from "./ko/threads";
import ptBR from "./pt-BR/threads";
import ru from "./ru/threads";
import zh from "./zh/threads";
import zhTW from "./zh-TW/threads";

const REQUIRED_KEYS = ["pinToGlobal", "pinToProject"] as const;

const PACKS: Array<[string, { threads: Record<string, unknown> }]> = [
    ["en", en],
    ["zh", zh],
    ["zh-TW", zhTW],
    ["ja", ja],
    ["ko", ko],
    ["es", es],
    ["fr", fr],
    ["hi", hi],
    ["pt-BR", ptBR],
    ["ru", ru],
];

describe("threads pin scope locale parity", () => {
    it.each(PACKS)("%s has localized pin scope copy", (locale, pack) => {
        for (const key of REQUIRED_KEYS) {
            const value = pack.threads[key];
            expect(typeof value, `${locale}.threads.${key}`).toBe("string");
            expect(value, `${locale}.threads.${key}`).toBeTruthy();
            expect(value, `${locale}.threads.${key}`).not.toBe(
                `threads.${key}`,
            );
        }
    });
});
