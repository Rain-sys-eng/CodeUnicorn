## ADDED Requirements

### Requirement: Claude history window assembly MUST preserve every complete JSONL line

`load_claude_session_window_from_path` 的 byte window 组装 MUST NOT 丢弃任何完整
jsonl 行。chunk 边界跨界行 MUST 由相邻 chunk 完整拼接，或由 page 边界行对齐
（cursor 指向首条完整行）保证其在某一页内完整返回。window MUST NOT 因内部
chunk 对齐产生非法 JSON 拼接行。

#### Scenario: line straddling a 256KB chunk boundary survives window load

- **WHEN** 一条 jsonl 行（如 assistant text chunk）横跨 `CLAUDE_WINDOW_TAIL_CHUNK` 边界
- **THEN** window 加载结果 MUST 包含该行的完整内容
- **AND** MUST NOT 出现该行与相邻行拼接成的非法 JSON 被静默跳过

#### Scenario: single line larger than the byte window

- **WHEN** 单条 jsonl 行超过 byte window（如超大 base64 image 消息行）且压住 page seam
- **THEN** 该行 MUST 由覆盖其完整范围的更早分页返回
- **AND** 本页 MUST NOT 以残缺片段冒充完整消息（fail-closed）

### Requirement: Claude history window pagination MUST be contiguous and lossless

window 分页 MUST NOT drain 已解析的 messages：window 范围内的全部 messages
MUST 返回给调用方；`has_more` MUST 仅由 `window_start > 0` 决定；
`next_cursor` MUST 是行对齐 byte offset，MUST NOT 为 `"0"`。相邻两页的
message 并集 MUST 等于全量且无交集。

#### Scenario: whole file fits the window but rows exceed limit

- **WHEN** session 文件可整体装入 byte window（`window_start == 0`）但 parsed messages 数量超过 limit
- **THEN** 加载结果 MUST 返回全部 messages
- **AND** `has_more` MUST be `false`、`next_cursor` MUST be `None`

#### Scenario: multi-page walk covers every message exactly once

- **WHEN** session 文件足够大使 `window_start > 0`
- **THEN** 依次以 `next_cursor` 翻页，各页 message id 的并集 MUST 等于全量解析 id 集合
- **AND** 任意两页 id 集合 MUST 不相交

### Requirement: Post-turn history reconcile MUST NOT drop previously visible items

Claude 线程 turn/completed 后的 history reconcile（自动 refresh）MUST 保留当前
已展示但不在本次 hydrated window 覆盖范围内的旧消息（preserve-prefix merge：
以 hydrated 首条 item 为锚点拼接）。锚点无法对齐时 MUST 回退为信任磁盘的整体
替换。显式 rewind / fork / delete 触发的重载 MUST NOT 使用该 merge。

#### Scenario: reconcile keeps older revealed items

- **WHEN** 当前列表含 window 覆盖范围之外（更旧）的已展示消息
- **AND** post-turn reconcile 完成 hydrated 加载
- **THEN** 合并后的列表 MUST 保留这些旧消息
- **AND** window 覆盖的尾部 MUST 以 hydrated 内容为准

#### Scenario: reconcile defers while an optimistic user bubble is pending

- **WHEN** reconcile 触发时当前线程仍存在 pending optimistic user bubble
- **THEN** reconcile MUST 延迟重试，MUST NOT 用磁盘 window 替换掉该气泡
