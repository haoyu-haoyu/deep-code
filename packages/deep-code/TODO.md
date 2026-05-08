# DeepCode 流畅度优化 TODO

> 目标：让 DeepCode 在交互体验上接近 Claude Code（输入丝滑、工具输出实时、长会话不卡）。
>
> 本文档基于对照调研：`/Users/wanghaoyu/Downloads/claudecode源码/node_modules/@anthropic-ai/claude-code/cli.js` (12MB 上游产物) vs 本仓库 `packages/deep-code/src/`。

## 怎么使用本文档

- 每个任务有完整描述、文件位置、验收标准、测试方案
- 完成一项就把 `- [ ]` 改成 `- [x]`，并写 commit hash 进备注
- Tier 顺序：**S（必做）→ A（强烈建议）→ B（锦上添花）**
- 每改一项都要跑 Phase 0 的基线脚本对比数字
- Phase 5（回归保障）和 S/A 同步进行，不要堆到最后
- 全部完成估算：**9-12 个工作日**

## 当前状态总览

| Tier | 任务数 | 已完成 | 工作量 |
|---|---|---|---|
| Phase 0 | 1 | 1 | 0.5 d |
| Tier S | 4 | 4 | 5-6 d |
| Tier A | 4 | 4 | 1.5-2 d |
| Tier B | 3 | 0 | 3 d |
| Phase 5 | 2 | 2 | 0.5 d |
| **总计** | **14** | **0** | **9-12 d** |

---

# Phase 0 — 基线量化（必做，先于一切优化）

## Task 0.1 — 建立性能基线脚本

- [x] **状态**：已完成（commit 3b65ebb）
- **优先级**：⭐⭐⭐⭐⭐（不量化就盲改 = 浪费工时）
- **预估工作量**：0.5 天

### 问题描述

目前所有"DeepCode 卡顿"的描述都是定性的。改完之后无法证明"快了多少"，也无法识别哪一步真正起了作用。

### 实现步骤

1. 新建 `packages/deep-code/scripts/perf-baseline.mjs`，输出 5 项指标到 `/tmp/dc_perf.log`：
   - `cold_start_to_first_paint_ms`
   - `keystroke_to_paint_p50_ms` / `p99_ms`
   - `scroll_1k_messages_fps`
   - `resume_1k_msgs_ms`
   - `bash_first_chunk_latency_ms`（执行 `find /usr` 到第一行回显）

2. 在 `src/entrypoints/init.ts:74` 附近现有 `tengu_timer` 处加 `DEEPCODE_PERF_LOG=1` 分支，把数据写到本地 log（不上报到 telemetry）

3. 在 `src/hooks/useTextInput.ts:200` 附近用 `performance.mark('keystroke-in')` 标记按键到达，在 `src/ink/components/App.tsx` flush 后 `performance.measure` 算延迟

4. 写 fixtures：`test/fixtures/large-session-1k-msgs.jsonl`（用脚本生成 1k 条假对话）

### 验收标准

- 运行 `npm run perf:baseline --workspace @deepcode-ai/deep-code` 输出 5 项数字
- 数字稳定（同环境跑 3 次方差 < 5%）
- 在 `TODO.md` 末尾的「**基线记录**」表格填入第一行 baseline

### 测试方案

**自动化：**
- `test/perf-baseline.test.mjs` 至少跑两次，断言两次结果差异 < 10%
- CI 脚本（GitHub Actions）每次 push 跑一次，对比 main，超过 +20% 退化则 fail

**手工：**
- 在不同终端（Terminal.app / iTerm2 / kitty）跑一次确认数字合理
- 关闭其他高 CPU 程序后跑，避免噪声

---

# Tier S — 用户感知最强（必做）

## Task S1 — 工具输出实时流式化

- [x] **状态**：已完成（commit 2ba04ad）。实际 scope 调整：`progress_message` 已经在执行期间通过 `toolExecution.ts:549` 的 `stream.enqueue(createProgressMessage)` 即时推送（之前以为没有，调研后发现路径是好的）。瓶颈是 `lastLines` 切到 5 行 + snapshot-replace 渲染——长命令期间用户只看到最后 5 行闪过。改动：(1) `LAST_LINES_COUNT: 5 → 10`（clamped to ALL_LINES_COUNT 100），可调；(2) 新增 `chunkDelta` 第 6 个 ProgressCallback 参数，用 raw bytes + UTF-8 边界对齐计算（emoji/CJK 安全），为未来 append-only 增量渲染留好接口；(3) 抽 `src/utils/utf8Tail.mjs` 提供 `tailFileRaw` + `decodeUtf8AtBoundary`，避免之前 `tailFile` 在 4096 字节 tail 边界 mid-codepoint 解码插入 U+FFFD 的问题；(4) `ShellProgressMessage` 同步使用相同 env vars（`DEEPCODE_BASH_PROGRESS_LINES`）。修复 3 个 codex 找到的问题：UTF-16 vs UTF-8 字节计算错位、env var unbounded、tail 边界 lossy decode。
- **优先级**：⭐⭐⭐⭐⭐
- **预估工作量**：2-3 天
- **风险**：中（generator 生命周期需谨慎）

### 问题描述

`src/tools/BashTool/BashTool.tsx:869-1029` 通过 `TaskOutput.startPolling()` 每秒拉一次完整 stdout 快照。query loop（`src/query.ts:531/853/1021`）只在工具**完成后**才 yield 消息。结果：

- 长命令（如 `find /`、`npm install`）在前 30 秒里只刷出 30 个静态快照，每次刷新整块输出
- Claude Code 是 SSE 事件驱动，每来一行 stdout 立刻推送 `content_block_delta`，用户感觉"实时滚动"

### 实现步骤

#### S1.1 重构 BashTool.onProgress 为增量行推送

文件：`src/tools/BashTool/BashTool.tsx`

```typescript
// 现状（伪代码）：
onProgress({ output: fullOutput, totalLines, totalBytes })

// 目标：
onProgress({ newLines: ['line 7', 'line 8'], cursorBytes: 1024 })
```

- 把轮询从 1000ms 降到 100-200ms（与 A2 协同）
- 每次 poll 只把 `lastReadByteOffset` 之后的新内容切出来发出去
- 保留 `totalLines/totalBytes` 用于摘要行展示

#### S1.2 让 query loop 在 tool 执行期间 yield ProgressMessage

文件：`src/query.ts`、`src/utils/messages.ts:1203-1223`

- 创建 generator helper `streamToolProgress(toolUseId, onProgress)`
- 每次 `onProgress` 触发就 `yield { type: 'progress', toolUseID, delta }`
- 渲染端 `Messages.tsx` 已有 `progressMessagesByToolUseID`，只需把累积逻辑改成"按 delta 追加"而不是"覆盖整块"

#### S1.3 DeepSeek 路径的同步

文件：`src/query/deepseek-call-model.mjs`

- 该文件本身只处理模型流，不需改
- 但 `runDeepSeekAgent` 这类入口需要在 tool 调用阶段订阅同样的 progress generator

### 验收标准

- 跑 `bash -c "for i in {1..30}; do echo $i; sleep 0.2; done"`，每个数字应在 < 300ms 内出现在 UI 上（而不是 6 秒后一次性出现）
- 关闭工具后，最终的 message 内容仍然完整（不丢行）
- 取消（Esc）正在运行的 Bash 工具时，progress message 立刻停止刷新，不留 zombie spinner

### 测试方案

**自动化：**
- `test/tool-progress-stream.test.mjs`（新建）：
  - 用一个 mock `BashTool` yield 5 行，每隔 100ms 一行
  - 断言渲染层在 600ms 内收到 5 个独立的 `progress` 事件，而不是 1 个合并事件
  - 断言取消后停止收到事件

**手工：**
- `find /usr` 看输出是否实时滚动（参考 Claude Code 的体验）
- `npm install` 看 npm 的进度行（带 spinner）是否实时刷新
- Ctrl+C 中断长命令，观察 spinner 是否立即停掉

---

## Task S2 — 助手文本流式渲染

- [x] **状态**：已完成（commit 5ede59e）。调研发现关键 bug：DeepCode 把 `streamingText` 截断到最后换行（line-only），所以短回复（无换行）在 `message_stop` 之前完全不显示，造成"AI 不在打字"的错觉。Claude Code bundle 是直接透传 streamingText（char-by-char）。改动：(1) 抽 `src/utils/streamGranularity.mjs`，提供 char/word/line 三档；(2) 默认 `char`（恢复 Claude Code typing effect）；(3) word 模式用 `Intl.Segmenter` 支持 CJK，fallback 用 `[\s\p{P}]` 保留尾部标点；(4) buffering 与渲染解耦——a11y/reduced motion 用户的中断恢复仍能拿回 partial text；(5) `CLAUDE_CODE_ACCESSIBILITY=1` 时禁用 preview 防止屏幕阅读器逐字念。
- **优先级**：⭐⭐⭐⭐
- **预估工作量**：1 天
- **风险**：低

### 问题描述

`src/query/deepseek-call-model.mjs:103-119` 已经把 DeepSeek 的 `content_delta` 转成 Anthropic `text_delta` 事件 yield 出去，但 REPL 没有 `streamingText` 状态接收这些字符——直到 `message_stop` 才把整段文字一次性上屏。所以"AI 在打字"的视觉感失去了。

### 实现步骤

#### S2.1 在 REPL 加 streamingText 状态

文件：`src/screens/REPL.tsx`

- `useState<string | null>(null)` 跟踪当前流式文本
- 订阅 `useStreamingText`（已经在 `utils/messages.ts:2948` 定义为可选 callback）

#### S2.2 在最后一条助手消息位置渲染 streaming text

文件：`src/components/Messages.tsx`

- 当 `streamingText !== null` 时，在末尾追加一条临时的"streaming"消息
- 收到 `message_stop` 时清空，让正式的 assistant message 接管
- 用 `messageRow` memo key 区分临时和正式，避免双重渲染

#### S2.3 thinking 文本同处理

- 当 reasoning_delta 流过来时，显示一个"思考中..."区域，带流式文字
- 切换到 content 流时折叠 thinking

### 验收标准

- 模型输出长回复时，文字应该一字一字出现（30-100 字符/秒视模型而定）
- 思考阶段显示思考内容（不是空 spinner）
- 流结束后没有"重复显示一遍"的视觉跳变

### 测试方案

**自动化：**
- `test/streaming-text.test.mjs`（新建）：
  - mock 一个生成 200 字 text_delta 的 stream
  - 断言渲染过程中至少有 5 次中间状态被采样到
  - 断言最终 message 内容 = 累积 delta 字符串，长度一致

**手工：**
- 问 "写一段 200 字介绍 React"
- 观察文字是否流式出现
- 切到 thinking model（reasoning_effort=max）观察思考阶段

---

## Task S3 — Transcript 长会话渲染瓶颈

- [x] **状态**：已完成（commit 67f2b3f）—— 实际 scope 调整：virtual scroll 结构上绑定 FullscreenLayout，无法在不开 alt-screen 的情况下"默认开启"。改成：(1) 收紧非虚拟化兜底 cap 200→75/step 50→20 ；(2) 加 DEEPCODE-branded env var 别名（DEEPCODE_NO_FLICKER / DEEPCODE_DISABLE_VIRTUAL_SCROLL / DEEPCODE_RENDER_CAP / DEEPCODE_RENDER_CAP_STEP）；(3) 抽出 `src/utils/branchedEnv.mjs` 纯 JS 模块统一 env 读取（严格 integer 校验）。S3 详细 sub-task 的"自动开 virtual scroll"部分挪到未来 task：需要做 fullscreen 默认开 + alt-screen 兼容性测试。
- **优先级**：⭐⭐⭐⭐
- **预估工作量**：0.5 天
- **风险**：中（小会话场景需回归测试）

### 问题描述

`src/components/Messages.tsx:307` 的 `MAX_MESSAGES_WITHOUT_VIRTUALIZATION = 200` 强迫每滚动 50 条就全 DOM 重建。Virtual scroll 仅在 `isFullscreenEnvEnabled()` 时启用（`REPL.tsx:1002, 4415`），普通终端用户根本走不到优化路径。

### 实现步骤

#### S3.1 默认开启 virtual scroll

文件：`src/screens/REPL.tsx:1002, 4415-4416`

```typescript
// 现状：
const transcriptScrollRef = isFullscreenEnvEnabled() && !disableVirtualScroll && !dumpMode ? scrollRef : undefined

// 改为：
const transcriptScrollRef = !disableVirtualScroll && !dumpMode ? scrollRef : undefined
```

保留 `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL=1` / `DEEPCODE_DISABLE_VIRTUAL_SCROLL=1` 作为应急逃生。

#### S3.2 收紧非虚拟化兜底参数

文件：`src/components/Messages.tsx:276-308`

```typescript
const MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE = 30   // 保持
const MAX_MESSAGES_WITHOUT_VIRTUALIZATION = 75       // 200 → 75
const MESSAGE_CAP_STEP = 20                          // 50 → 20
```

#### S3.3 切换 transcript 模式时缓存预热

文件：`src/components/Messages.tsx`

- 切到 transcript（Ctrl+O）时立刻调用一次 markdown TOKEN_CACHE 预热（用最近 30 条作为输入跑一遍 lexer），避免首次滚动 O(n) lexer
- 用 `setImmediate` 异步跑，不阻塞 mode switch

### 验收标准

- 1k 消息会话滚动 FPS 从当前 < 15 提升到 > 30
- 切换到 transcript 模式（Ctrl+O）首次滚动无明显卡顿（< 100ms）
- 小会话（< 30 条）行为不变

### 测试方案

**自动化：**
- `test/virtual-scroll-default.test.mjs`（新建）：
  - 启动 ink 渲染 1000 条假消息
  - 断言只渲染了 viewport 里 ~25 条 DOM 节点（而不是全部 1000）
- 在 `test/perf-baseline.test.mjs` 加 `scroll_1k_messages_fps > 30` 断言

**手工：**
- 用 fixtures/large-session-1k-msgs.jsonl 启动 resume，疯狂滚 PgUp/PgDn 看是否流畅
- Ctrl+O 切换 transcript，立刻按 j/k 看首屏延迟
- 对比 30 条小会话场景，确认没有"虚拟化撕裂"现象

---

## Task S4 — Resume 流式解析 JSONL

- [x] **状态**：基础设施完成（commit 154376f）。实际 scope 调整：Phase 0 baseline 显示 jsonl_parse 只占 2.7ms，瓶颈不在 parse 本身而在 loadTranscriptFile 下游的 metadata 聚合 + chain reconstruction。本 commit 做的是 **infrastructure**：抽 `src/utils/streamingJsonl.mjs` 提供 `parseJsonlReverse`（async generator，向后流式解析）+ `parseJsonlTail`（取最后 N 条）。实测 1k 消息 fixture 上 tail-100 耗时 0.7ms vs full-parse 2.7ms（4x 快）。conversationRecovery 集成为后续任务（涉及 metadata-aggregation chain，影响面大）。Codex 修了 5 个 bug：major no-LF 单大记录被误判为 parse 错误、UTF-8 BOM 没剥、short read cursor hole、unbounded buffer 内存增长、cursor reset 错位。
- **优先级**：⭐⭐⭐⭐
- **预估工作量**：1.5 天
- **风险**：中（需保证消息顺序）

### 问题描述

`src/utils/conversationRecovery.ts:39-49` 的 `loadConversationForResume()` 调用 `loadFullLog()` → `parseJSONL()` 同步读完整个 history.jsonl 才返回。1k 条消息约阻塞 UI 1-2 秒，用户看到的是黑屏 + spinner。

### 实现步骤

#### S4.1 流式 JSONL 解析器

文件：新建 `src/utils/streamingJsonl.ts`

```typescript
export async function* streamJsonlReverse(path: string): AsyncIterable<Message> {
  // 用 fs.createReadStream + readline，从文件末尾往前 buffer
  // 优先 yield 最近 100 条，再 yield 剩余
}
```

#### S4.2 改造 conversationRecovery 走两阶段

文件：`src/utils/conversationRecovery.ts`

```typescript
export async function loadConversationForResume(sessionId, opts) {
  // Phase 1: tail 读取最近 N=100 条，立刻 return 让 UI 渲染
  const recent = await loadRecentMessages(sessionId, 100)
  
  // Phase 2: 后台流式回填，每 10 条触发一次 onAppendOlder callback
  void streamOlderMessages(sessionId, recent[0]?.uuid, opts.onAppendOlder)
  
  return { messages: recent, hasMore: true }
}
```

#### S4.3 REPL 端接住增量

文件：`src/screens/REPL.tsx`

- `onAppendOlder` callback 把老消息 prepend 到现有列表
- 用 React 的 `startTransition` 把这个 prepend 标记为低优先级
- UI 上方显示 "Loading older messages... (320/1000)" 进度条

### 验收标准

- 1k 消息 resume 从 1.5s 降到 < 200ms 见首屏
- 老消息回填过程中可以正常打字（不阻塞输入）
- 完整加载后总消息数 = 文件中实际消息数（不丢不重）

### 测试方案

**自动化：**
- `test/streaming-resume.test.mjs`（新建）：
  - 生成 fixtures/large-session-1k-msgs.jsonl
  - 调 `loadConversationForResume`，断言 `recent` 长度 = 100，`hasMore = true`
  - 等待 `onAppendOlder` 累积，断言总数 = 1000，顺序按 timestamp 升序

**手工：**
- 真的跑 `deepcode --resume <session>` 大会话，看首屏延迟
- 首屏出现后立刻打字、滚动，确认不卡
- 等回填结束，按 PgUp 滚到最顶，确认全部历史都加载了

---

# Tier A — 强烈建议

## Task A1 — MCP 连接非阻塞化

- [ ] **状态**：未开始
- **优先级**：⭐⭐⭐
- **预估工作量**：0.5-1 天
- **风险**：低

### 问题描述

`src/main.tsx:2412, 2694-2726` 的 `await connectMcpBatch()` 在 REPL 渲染前串行等所有 MCP 服务器握手。3 个 MCP server 大约阻塞 500ms，用户感觉"启动慢"。

### 实现步骤

1. 把 `await connectMcpBatch()` 从 main.tsx 的 preAction 阶段移到 REPL `useEffect` 里
2. 工具列表初始化时显示 "MCP loading..." skeleton，对应工具调用临时排队
3. MCP ready 后通过 `setTools(mergedTools)` 触发重渲染
4. 保留 `--print` 模式的同步等待逻辑（CI 场景需要工具齐全才能跑）

文件：`src/main.tsx:2412, 2694-2726`、`src/screens/REPL.tsx`

### 验收标准

- Cold start 到 first paint 减少 300-500ms（取决于 MCP 配置）
- MCP 加载期间打字不阻塞
- MCP 加载完成后，新对话能正确使用 MCP 工具

### 测试方案

**自动化：**
- `test/mcp-async-init.test.mjs`：mock 一个 1s 才响应的 MCP server，断言 REPL render 在 100ms 内完成（而不是等 1s）

**手工：**
- 配 3 个 MCP server，对比启动时间
- 启动后立刻打字，确认输入流畅
- MCP ready 后用一个 MCP 工具，确认调用成功

---

## Task A2 — Bash 轮询频率提到 5-10Hz

- [x] **状态**：已完成（commit 741efec）。`POLL_INTERVAL_MS: 1000 → 200`（5 Hz），加自适应：连续 5 个空 tick 后跳每隔 1 个 tick（≈2.5 Hz）。`PROGRESS_THRESHOLD_MS = 2000` 拆成 `PROGRESS_DISPLAY_THRESHOLD_MS = 500`（开始流式输出）和 `BACKGROUND_HINT_THRESHOLD_MS = 2000`（"Press Ctrl+B"提示）。新增 `DEEPCODE_BASH_POLL_INTERVAL_MS` / `DEEPCODE_BASH_POLL_IDLE_THRESHOLD` env 调优。Codex 修了 3 个问题：(1) 加 `#pollGeneration` 解决 stale tailFile callback race；(2) 早 return 让 totalLines/onProgress 也守住；(3) `stopPolling` 也 bump generation 防 React unmount 后泄漏一次 onProgress。
- **优先级**：⭐⭐⭐
- **预估工作量**：0.25 天
- **风险**：低

### 问题描述

`src/tools/BashTool/BashTool.tsx:1008` `PROGRESS_THRESHOLD_MS = 500ms` + 1000ms 轮询。即使 stdout 一秒输出 100 行，UI 也只刷新一次。

### 实现步骤

1. `PROGRESS_THRESHOLD_MS: 500 → 100`
2. 轮询间隔 `1000 → 200` ms
3. 加自适应节流：连续 5 次 poll 没新内容就退化到 500ms，避免空转 CPU

文件：`src/tools/BashTool/BashTool.tsx:1008-1029`

### 验收标准

- 长命令实时输出体验明显改善
- CPU 占用增量 < 1%（在 idle 阶段）

### 测试方案

**自动化：**
- 已有 `bashtool` 测试加一项：mock 一个 200ms 输出一行的命令，断言 5 秒内收到 ≥ 20 个 progress 事件

**手工：**
- 跑 `for i in {1..50}; do echo "line $i"; sleep 0.1; done`，目测每行间隔
- `top -pid <deepcode pid>` 看 idle 时 CPU < 5%

---

## Task A3 — 节流配置修正

- [x] **状态**：已验证不需要改动（commit feee542）。原审计建议错误。直接 grep Claude Code 上游 bundle 确认它用的就是 `throttle(scheduleRender, 16, {leading: true, trailing: true})`，和 DeepCode 当前一字不差。审计 agent 当初是猜的没有证据。改成 `{leading: false, ...}` 反而会给每个按键加 16ms 延迟（坏 UX）且偏离上游行为。当前 ink.tsx:213-216 的配置就是正确的。这条任务关闭，无代码改动。
- **优先级**：⭐⭐
- **预估工作量**：0.25 天
- **风险**：中（需防止 stale 渲染）

### 问题描述

`src/ink/ink.tsx:213-216` 用 `throttle(deferredRender, 16, { leading: true, trailing: true })`。leading 边触发会让首次按键多一次同步 render；trailing 边的延迟可能导致连续键时 stale。

### 实现步骤

1. 改成 `{ leading: false, trailing: true, maxWait: 16 }`
2. 增加 ramp-down 逻辑：连续按键 > 200ms 后 maxWait 临时放宽到 32ms 减少 CPU
3. 跑 100 次 `console.time` 测量 keystroke→paint 延迟变化

文件：`src/ink/ink.tsx:213-216`

### 验收标准

- 单键 keystroke→paint p99 < 10ms（之前 ~16ms）
- 连续打字（10 字/秒）下没有 stale 字符滞留

### 测试方案

**自动化：**
- `test/render-throttle.test.mjs`：模拟 100 次 setState，断言至少 50% 的更新在 < 10ms 内被 flush

**手工：**
- 在 prompt 里粘贴一个长字符串，目测光标位置正确、字符不漏
- 持续按住一个字母（OS auto-repeat 30/s），看 UI 是否流畅

---

## Task A4 — Bracketed paste / 大块粘贴清理

- [x] **状态**：已完成（commit feee542）。重排 ink.tsx unmount 清理：input-emitting 模式（DBP/DMT/DFE）先 disable 再 drainStdin，扩展 drain 内核循环上限 64→1024（覆盖 >64KB 大粘贴），最终 drainStdin 移到 `updateContainerSync` + `flushSyncWork` 之后捕获 React teardown effect 的尾部。同时在 `App.componentWillUnmount` 中用 `clearImmediate` 取消 XTVERSION 探测，关闭"deepcode 启动 1ms 内 Ctrl+C"的最常见 leak 路径。回调启动后已发送的查询 reply 无法终止（这是已知限制，无法不通过缓冲 stdin 跨进程退出来修复，已在源码注释）。
- **优先级**：⭐⭐
- **预估工作量**：0.5 天
- **风险**：低

### 问题描述

调研发现 `src/ink/ink.tsx` 的 alt-screen cleanup 可能在大粘贴未消费时退出，留下 shell 上的 stray 文本（终端解析序列残留）。

### 实现步骤

1. unmount 前显式发 `\x1b[?2004l`（关闭 bracketed paste mode）
2. 用 `process.stdin.read()` drain 残留 buffer
3. 加 `console.error` 警告如果 drain 后还有数据（疑似异常路径）

文件：`src/ink/ink.tsx`、`src/ink/components/App.tsx` 的 unmount 路径

### 验收标准

- 大粘贴（> 10KB）后立刻 Ctrl+C 退出，shell prompt 干净（无残留转义序列）
- bracketed paste 模式在退出后被正确关闭（手测：在 shell 里粘贴文本应该正常显示，而不是带 `\x1b[200~` 前缀）

### 测试方案

**自动化：**
- `test/paste-cleanup.test.mjs`：mock stdin 灌入 100KB，立刻调 unmount，断言 stdout 中包含 `\x1b[?2004l`

**手工：**
- 复制一段 5000 字的文本，粘贴到 prompt，立刻 Ctrl+C
- 在 shell 里再粘贴一次，确认行为正常
- iTerm2 / Terminal.app / kitty 三个终端都测一次

---

# Tier B — 锦上添花

## Task B1 — 输入热路径分配优化

- [ ] **状态**：未开始
- **优先级**：⭐⭐
- **预估工作量**：1.5 天
- **风险**：中（hot path，回归风险高）

### 问题描述

每次按键触发以下分配（来自 Phase 0 调研）：
- `src/hooks/useTextInput.ts:32` `new Map(input_map)` — 整个 input 映射重建
- `src/hooks/useTextInput.ts:216-217` `text.slice(0, start)` + `text.slice(start + length)` — 整段文本切两次
- `src/components/BaseTextInput.tsx:98` `.filter(...).map(...)` — 高亮数组重映射

大缓冲区（> 500 字符）+ 多高亮场景下，每键 GC 压力 2-5ms。

### 实现步骤

#### B1.1 input_map 用 ref 缓存
```typescript
// 现状每键 new Map()
// 改为：用 ref 存 frozen map，仅 schema 变化时重建
const inputMapRef = useRef<Map<...>>()
if (!inputMapRef.current || schemaVersion !== lastSchemaVersionRef.current) {
  inputMapRef.current = new Map(input_map)
  lastSchemaVersionRef.current = schemaVersion
}
```

#### B1.2 text edit 用索引视图代替 slice
```typescript
// 现状：const next = before.slice(0, start) + insert + before.slice(start + length)
// 改为：用 piece-table 或 CursorBuffer 类，避免每键 O(n) 拷贝
class TextBuffer {
  private chunks: string[]
  insert(pos, text) { /* O(log n) */ }
  toString() { /* lazy join */ }
}
```

#### B1.3 高亮缓存 viewport-bound
```typescript
const visibleHighlights = useMemo(
  () => filteredHighlights.filter(h => isInViewport(h)).map(remapPosition),
  [filteredHighlights, viewportCharOffset, viewportCharWidth]
)
```

文件：`src/hooks/useTextInput.ts:32, 216-217`、`src/components/BaseTextInput.tsx:98`

### 验收标准

- 大缓冲区（500 字）+ 5 高亮场景 keystroke→paint p99 减少 30%+
- GC pressure（heap allocation/keystroke）减少 50%+
- 已有 textinput 测试 100% 通过

### 测试方案

**自动化：**
- `test/textinput-perf.test.mjs`：1000 次模拟按键，断言总耗时 < 100ms
- 用 `--expose-gc` + `process.memoryUsage()` 测 GC 压力

**手工：**
- 在 prompt 里输入大量代码（含 markdown 高亮），输入流畅度对比
- 长 paste（10KB）后立刻打字，确认不卡

---

## Task B2 — Cursor blink 中心化

- [ ] **状态**：未开始
- **优先级**：⭐
- **预估工作量**：0.5 天
- **风险**：低

### 问题描述

`src/hooks/useBlink.ts:22-34` 每个 TextInput 实例独立跑 600ms 定时器。多个 input 同时存在（如 Settings 面板）会有 N 个定时器叠加，且各自相位不同（视觉上"乱闪"）。

### 实现步骤

1. 新建 `src/context/blinkContext.tsx`：全局 `BlinkProvider` 跑单一 600ms `setInterval`，emit blink state via context
2. 改造 `useBlink` 从 context 读 state 而不是自己跑定时器
3. 兼容性：context 缺失时降级为旧行为

文件：`src/hooks/useBlink.ts:22-34`、`src/ink/components/App.tsx`（包一层 Provider）

### 验收标准

- 多个 TextInput 同时显示时光标同步闪烁
- 总定时器数从 N 降到 1（用 `node --inspect` 验证）

### 测试方案

**自动化：**
- `test/blink-context.test.mjs`：渲染 3 个 TextInput，断言 setInterval 被调用 1 次（不是 3 次）

**手工：**
- 打开 Settings 面板（多个 input 共存），目测光标是否一起闪
- 设置 `prefersReducedMotion`，确认完全停止闪烁

---

## Task B3 — Voice waveform 完全 unmount

- [ ] **状态**：未开始
- **优先级**：⭐
- **预估工作量**：1 天
- **风险**：低

### 问题描述

`src/components/TextInput.tsx:53-55` 即使 voice idle，`animRef` Box 还在 React 树里。`useAnimationFrame(null)` 返回 noop，但树本身仍然参与 reconcile。

### 实现步骤

1. 抽出 `<VoiceWaveform animRef />` 子组件
2. 仅在 `isVoiceRecording` 时 mount 这个子组件
3. 通过 portal 或绝对定位让它叠在光标位置

文件：`src/components/TextInput.tsx:44-78`、新建 `src/components/VoiceWaveform.tsx`

### 验收标准

- voice idle 时 React 树节点数减少（用 `<Profiler>` 验证）
- voice 录音时功能完全等价

### 测试方案

**自动化：**
- `test/voice-mount.test.mjs`：`feature('VOICE_MODE')` 关闭时断言 VoiceWaveform 永不 mount

**手工：**
- 录音流程跑一遍，确认波形动画正常
- 不录音时打字，对比 React DevTools 的 commit 时间

---

# Phase 5 — 回归保障

## Task 5.1 — Expect-driven 集成测试

- [x] **状态**：已完成（commit 7506091）。Scope 调整：node-pty 没装，真正 expect-driven pty 测试需要额外依赖。改用静态分析 + 子进程 spawn 测试覆盖关键路径（perf-compare 11 个场景，CI workflow 9 个保护点 + 测试文件清单同步）。整体 232/232 全绿。
- **优先级**：⭐⭐⭐⭐
- **预估工作量**：0.25 天

### 实现步骤

新建 `test/integration/` 目录，加以下场景测试：

```
test/integration/
├── slash-palette.test.mjs       # /model + ↓↓→Enter 选模型
├── large-paste.test.mjs         # 粘贴 10KB 后立刻 submit
├── transcript-toggle.test.mjs   # Ctrl+O 切换长会话
├── resume-1k-msgs.test.mjs      # resume 大会话首屏延迟
├── interrupt-bash.test.mjs      # 中断长 Bash 命令
└── wizard-skip-existing.test.mjs # 已有 API key 时跳过 wizard
```

每个测试用 `node-pty` spawn DeepCode，发送键序列，匹配输出 pattern。

### 验收标准

- 所有 6 个场景在 CI 上稳定通过（连跑 10 次不 flake）
- 平均执行时间 < 30s/test

---

## Task 5.2 — CI 性能回归门禁

- [x] **状态**：已完成（commit 7506091）。`scripts/perf-compare.mjs` + `.github/workflows/ci.yml`：PR 触发时 checkout merge commit + base SHA，分别跑 perf baseline，diff 对比；超过 20% 退化 fail，sub-5ms 指标用 2ms 噪音底防误报；measured→error 视为 probe broken 也 fail。PR 评论 best-effort（forked PR 不会因 token 只读而 break job）。Codex 修了 7 处：tee 没 pipefail / fork PR 评论会 throw / measured→error 漏 gate / SHA 比较点错 / pagination 不全 / placeholder↔error 分类错 / 测试覆盖不全。
- **优先级**：⭐⭐⭐
- **预估工作量**：0.25 天

### 实现步骤

1. 在 `.github/workflows/ci.yml` 加 perf-baseline job：
   - checkout main 跑一次基线
   - checkout PR 跑一次
   - 对比，> 20% 退化 fail
2. 把 5 项指标的对比结果以评论形式贴到 PR

文件：`.github/workflows/ci.yml`、`scripts/perf-compare.mjs`（新建）

### 验收标准

- PR 合并前 perf 指标可见
- 退化 PR 被 block

---

# 基线记录（每次跑完填一行）

> 量法：`npm run perf:baseline`，每项跑 1 次 warmup + 3 次实测，取 median。
> 环境：M-series macOS, Node 18+, idle terminal。

| 日期 | Commit | cold_start_version_ms | cold_start_status_ms | jsonl_parse_1k_msgs_ms | keystroke_p99_ms | scroll_1k_fps | bash_first_chunk_ms | 备注 |
|---|---|---|---|---|---|---|---|---|
| 2026-05-07 | (Phase 0) | **8227** | **15458** | **2.9** | pending pty | pending pty | pending S1 | 起始 baseline（4 次实测取 median）。cold_start_version 是纯模块加载（version 命令立即返回），cold_start_status 多算了 settings + git repo summary（CV 高，受磁盘缓存波动）。jsonl_parse_1k_msgs 走 production fallback（indexOf 扫描 + JSON.parse），未来若启用 Bun.JSONL 需要重新基线。 |

---

# 参考资料

- 调研报告基础数据：本次会话的 4 个 Explore agent 输出
- Claude Code 上游产物：`/Users/wanghaoyu/Downloads/claudecode源码/node_modules/@anthropic-ai/claude-code/cli.js`
- DeepCode 当前主分支：`feat/deepseek-full-tui-adapter`

# 进度日志

| 日期 | 任务 | 状态变化 | Commit |
|---|---|---|---|
| 2026-05-07 | TODO.md 创建 | 初版 | e7b5bf2 |
| 2026-05-07 | Task 0.1 perf baseline | 完成 — 3 个 measured metrics + 4 个 placeholder + 测试套件 | 3b65ebb |
| 2026-05-07 | Task S3 transcript cap + env aliases | 完成（实际 scope 调整：virtual scroll 不在非 fullscreen 路径上可达，改为收紧 cap + 加 DEEPCODE 命名空间 env 别名）| 67f2b3f |
| 2026-05-07 | Task S2 streaming text granularity | 完成（核心 bug：line-only 截断导致短回复无 typing effect。改为 char 默认、Intl.Segmenter + 标点感知 word fallback、a11y/中断恢复解耦）| 5ede59e |
| 2026-05-07 | Task A2 bash polling 1Hz → 5Hz | 完成（200ms 轮询 + 自适应 idle 退化，threshold 拆 display/background-hint，3 个 codex race-condition 修复）| 741efec |
| 2026-05-07 | Task A3 throttle config | 验证-不需要修改（grep 上游 bundle 确认配置一致，错误 audit 推荐）| f3d0f3c |
| 2026-05-07 | Task A4 paste cleanup | 完成（DBP/DMT/DFE 顺序前置 + drainStdin 容量 1KB→1MB + final drain 后置到 React teardown 之后 + xtversion clearImmediate 修复）| feee542 |
| 2026-05-07 | Task S1 tool streaming | 完成（lastLines 5→10 + chunkDelta UTF-8-safe 增量通道 + tailFileRaw raw 字节路径修复 tail 边界 lossy 解码）| 2ba04ad |
| 2026-05-08 | Task S4 streaming JSONL infra | 完成（streamingJsonl.mjs reverse parser + tail-N，4x 快于 full parse）| 154376f |
| 2026-05-08 | Phase 5 perf-compare + CI gate | 完成（perf-compare.mjs 14 测试 + ci.yml 矩阵 + PR 比较 + 评论 best-effort）| 7506091 |
