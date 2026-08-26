# Design: harden-dsh-npm-global-install

## 现象

Windows CLI 一键安装 DSH 日志：

- `npm warn tar ENOENT: Cannot cd into '.../@deepseek-ai/dsh/node_modules/isexe'`
- `tarball data for <pkg> ... seems to be corrupted. Trying again.`
- exit `-4058`（Node ENOENT）

这是 npm arborist 并发解压的经典 Windows 竞态。tarball corrupted 多为解压失败的误诊。

## 决策

| 选项 | 结论 |
|------|------|
| 只加长 timeout | 不够。npm 内部重试仍会撞同一竞态。 |
| 只在 Windows 加 `--maxsockets=1` | 不够。macOS 共用命令，用户要求一起修。 |
| 全 engine 硬化 | 过宽。Codex / Kimi 包小，现网稳定。 |
| DSH 全平台硬化 + 残留清理 + 一次重试 | 采用。命令预览与真实执行保持一致。 |

## 流程

```
plan (hardened preview)
  → 清 stale 全局目录（无 package.json）
  → npm install -g --maxsockets=1 ...
  → 若 ENOENT / corrupted / -4058
      → 强制清残留
      → 再装一次
  → doctor
```

残留路径同时覆盖 Windows `{prefix}/node_modules/@deepseek-ai/dsh` 与 Unix `{prefix}/lib/node_modules/@deepseek-ai/dsh`。只删这个包目录，不动 `$DSH_HOME`。

## 风险

- `--maxsockets=1` 会拉长下载。用 420s timeout 覆盖。
- Update 时若包是完整的，首次不删，避免「删掉还能装失败」丢可用 CLI。
- 重试只在 extract-race 文本 / `-4058` 时触发，EACCES 等权限错误不重试。
