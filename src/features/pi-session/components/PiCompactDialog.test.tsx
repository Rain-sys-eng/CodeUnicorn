import { describe, expect, it } from "vitest";
import { compactErrorToNotice } from "./PiCompactDialog";

describe("compactErrorToNotice", () => {
  it("pi 的「太短/无可压缩」映射为中性提示", () => {
    // pi 上游原话：dist/core/agent-session.js compact()
    expect(
      compactErrorToNotice("Nothing to compact (session too small)"),
    ).toContain("没有可压缩的内容");
    expect(compactErrorToNotice("nothing to compact")).not.toBeNull();
  });

  it("其它错误保持红色错误路径", () => {
    expect(compactErrorToNotice("Already compacted")).toBeNull();
    expect(compactErrorToNotice("pi rpc request mossx-1 timed out")).toBeNull();
    expect(
      compactErrorToNotice("当前 turn 仍在进行中，无法压缩；请等待完成或先停止。"),
    ).toBeNull();
  });
});
