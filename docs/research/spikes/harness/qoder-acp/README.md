---
type: evidence
status: historical
---

# Qoder ACP Spike Harness — qodercli 1.1.27

针对 `qodercli --acp`（stdio, newline-delimited JSON-RPC 2.0）的可重复探测脚本。
报告见 `../../../mossx-qoder-capability-spike.md`。

## 结构

- `probes/acp_client.py` — 最小 ACP client：spawn `qodercli --acp`、NDJSON 收发、
  agent→client request 自动应答（permission 自动 allow、fs 读写限制在实验 cwd）、
  全部 raw line 落 transcript。
- `probes/probe1_initialize.py` — initialize 握手 + session/new（0 次模型调用）。
- `probes/probe2_prompt.py` — trivial prompt 全 lifecycle（1 次模型调用）+ session/list + set_model。
- `probes/probe3_resume.py` — session/load 断连回放 + session/resume attach + session/list（0 次模型调用）。
- `probes/probe5_config.py` — set_config_option（reasoning_effort）+ set_mode（0 次模型调用）。
- `probes/probe6_golden_turn.py` — 默认模型 qmodel_38max 的黄金 turn 采集（2 次模型调用）；
  用于把 spike 中 `unknown` 的 capability 升级为实测值。
- `evidence/` — 仅提交本 README；运行时 raw transcript（`>>` 发出 / `<<` 收到 / `!!` stderr）只做本地分析，不入库。

## 复跑

```bash
export QODER_SPIKE_CWD=/tmp/mossx-qoder-spike   # 可选，默认即此值
export QODER_SPIKE_EVIDENCE=/tmp/mossx-qoder-spike-evidence
python3 probes/probe1_initialize.py
python3 probes/probe2_prompt.py
python3 probes/probe3_resume.py
python3 probes/probe5_config.py
python3 probes/probe6_golden_turn.py   # 需要有可用模型配额的已登录账号
```

注意：probe2/6 消耗真实模型调用；2026-08-21 spike 期间本机账号模型 API 不可达
（`Network attempt failed at unknown`），probe6 仅验证了错误面。实验 cwd 固定为 /tmp 沙箱。
