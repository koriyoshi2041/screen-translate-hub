# 第一版实现（Windows）

对应需求：[第一版范围](../requirements/09-v1-scope.md)。

本文规定第一版的进程划分、代码仓库结构、服务协议的第一版承载方式，以及每个模块的职责和主要函数。01 至 16 中的数据结构、算法和接口照常适用；本文只写第一版在实现上的选择，以及函数一级的划分。代码与本文不一致时，以修订本文为先。

## 1 技术选型

| 部分 | 语言与主要依赖 | 理由 |
| --- | --- | --- |
| 桌面主程序：托盘、快捷键、框选、覆盖层、浮卡、AI 卡片、服务监管 | TypeScript，Electron；Win32 接口经 koffi 调用 | 透明、点击穿透、置顶、不激活、排除截屏（`setContentProtection` 即 `WDA_EXCLUDEFROMCAPTURE`）都有现成接口；不需要本机编译器；界面与网页观看端共用排版代码 |
| 屏幕采集与变化检测 | Python 3.12，windows-capture（Windows.Graphics.Capture），numpy | 能关闭鼠标指针和采集黄框；Chromium 系的采集做不到不带指针；numpy 做逐像素比对足够快 |
| OCR | Python，RapidOCR 3.10（PP-OCRv6 small），onnxruntime | 实测整屏约 0.8 秒；检测后处理和模型都现成 |
| 运行协调器、归一化、翻译适配、局域网观看、AI 助手 | TypeScript，Node 24 | 竞速、复用和生命周期是事件驱动的状态机，适合单线程事件循环；pi 是 TypeScript 写的；Bergamot 有 WASM 版本 |
| 网页观看端 | TypeScript，浏览器原生 DOM | 与覆盖层共用 `@sth/render` |
| 服务协议 | 第 3 节，WebSocket + MessagePack | Node 和 Python 都有成熟实现；流、时限、取消、状态码的语义与 [服务协议](08-service-protocol.md) 相同 |

原技术选型（[技术选型](15-tech-selection.md)）中的 Rust、Tauri 方案保留为后续路线：协议与语言无关，任何一个服务都可以单独用 Rust 重写后替换，其他服务不受影响。第一版先用开发最快、在这台电脑上就能完整测试的组合。

## 2 进程

第一版的全部进程运行在同一台电脑上：

| 进程 | 登记名称 | 实现的接口 | 语言 |
| --- | --- | --- | --- |
| 桌面主程序 | `agent`、`overlay`、`card`、`region_select`、`window_tracker` | `agent`、`overlay`、`card`、`region_select`、`window_tracker` | TS（Electron） |
| 运行协调器 | `coordinator` | `coordinator` | TS |
| 屏幕采集 | `capture` | `capture` | Python |
| OCR | `ocr.rapidocr` | `ocr` | Python |
| 归一化 | `normalize` | `normalize` | TS |
| 翻译 | 每个翻译源一个进程，例如 `translate.claude-cli`、`translate.openai`、`translate.bergamot`、`translate.mock` | `translate` | TS |
| 局域网观看 | `viewer` | `viewer`，另有 HTTP 和浏览器用的 WebSocket | TS |
| AI 助手 | `assistant` | `assistant` | TS |

主程序是服务清单和监管者（[架构](01-architecture.md) 2.1）：按需启动服务进程，崩溃后按退避间隔重启。系统集成服务都在主程序进程内，与 [桌面端](12-desktop.md) 1.1 一致；屏幕采集是例外，它在单独的 Python 进程中运行。Windows 的屏幕采集不需要系统授权，`WDA_EXCLUDEFROMCAPTURE` 对所有采集方生效，单独成进程不影响权限归属和自身窗口的排除，[桌面端](12-desktop.md) 1.1 的理由只对 macOS 成立。

没有图形界面时（例如经 SSH 运行测试），主程序的核心以无界面方式运行：`tools/dev/agent-headless.ts` 加载同一套服务清单和监管逻辑，用回放采集代替屏幕采集，用记录显示端代替覆盖层（[验收与测试](16-acceptance.md) 第 2 节）。

### 2.1 启动与登记

1. 主程序生成 256 位的本机会话令牌，在 `127.0.0.1` 的随机端口上启动协议服务器；
2. 启动服务进程时，经标准输入写入一行 JSON：`{"agent": "ws://127.0.0.1:端口", "token": "…", "name": "登记名称", "config": {…}}`（[安全](11-security.md) 第 5 节）；
3. 服务在 `127.0.0.1` 的随机端口上启动自己的协议服务器，连上主程序，用 `agent.Register` 登记描述和端点，并保持这条流；
4. 运行协调器用 `agent.ListServices` 解析绑定，用 `agent.Acquire` 占用服务、取得端点后直接连接（[服务协议](08-service-protocol.md) 8.3）。

本机连接都要出示会话令牌。第一版用回环地址上的 TCP 端口代替命名管道：[安全](11-security.md) 第 5 节担心的两个问题，其他系统账户和网页都拿不到令牌，握手不能通过；浏览器的连接另外检查 `Origin`。命名管道作为以后的传输方式，协议层不需要改动。

## 3 服务协议的第一版承载

帧的语义、流、时限、取消、状态码与 [服务协议](08-service-protocol.md) 相同，承载方式简化如下：

- 传输：WebSocket，一个二进制消息承载一个帧；
- 编码：帧和业务消息都用 MessagePack，二进制字段直接使用 MessagePack 的二进制类型；字段名使用 [数据模型](02-data-model.md) 的蛇形命名；
- 不拆分业务消息：单条消息上限 64 MiB，足够容纳未压缩的 4K 画面；
- 流量控制按消息条数计额度：每条流每个方向初始 32 条，接收方的业务代码每取走一条，补回一条。语义与服务协议第 5 节相同：慢的接收方能让发送方停下。

| 帧 | 字段 |
| --- | --- |
| `hello` | `ver`（`[1, 0]`）、`kind`（`local`、`browser`）、`peer`、`token` |
| `ack` | `ok`、`code?`（`INVALID_CREDENTIAL`、`PROTOCOL_INCOMPATIBLE`、`UNAVAILABLE`）、`reason?` |
| `open` | `s`（流标识）、`svc`（目标服务的登记名称）、`iface`、`maj`、`min`、`method`、`dl`（剩余时长，毫秒，0 为不限）、`meta` |
| `msg` | `s`、`b`（业务消息） |
| `half` | `s` |
| `close` | `s`、`code`、`msg?`、`retry?` |
| `cancel` | `s`、`reason` |
| `credit` | `s`、`n` |
| `ping`、`pong` | `n` |

一个进程可以在同一个端点上提供多项服务，`open` 中的 `svc` 选择其中一项，例如主程序同时提供 `agent`、`overlay`、`card`。

## 4 代码仓库结构

```text
package.json                 npm 工作区
tsconfig.base.json
packages/
  wire/                      服务协议（TS）
  model/                     数据模型类型与几何、语言等工具函数（TS）
  render/                    显示状态机、译文排版、DOM 绘制（TS，覆盖层、浮卡、网页共用）
  workflow/                  工作流文档、静态校验、默认模板（TS）
  service-kit/               服务进程的公共启动代码：读启动信息、登记、日志（TS）
services/
  coordinator/               运行协调器（TS）
  normalize/                 归一化（TS）
  translate/                 翻译适配：claude-cli、openai、anthropic、bergamot、mock（TS）
  viewer/                    局域网观看：服务、HTTP、网页（TS）
  assistant/                 AI 助手：门控、心跳、大脑、平台工具、MCP 适配（TS）
  py/
    sth_wire/                服务协议（Python）
    sth_service/             服务进程的公共启动代码（Python）
    capture/                 屏幕采集与变化检测（Python）
    ocr/                     OCR（Python）
apps/
  desktop/                   Electron 主程序：主进程与各窗口的页面
tools/
  dev/                       无界面主程序、回放采集、端到端演示脚本
  win/                       Windows 开发辅助，例如把命令投送到桌面会话
tests/
  fixtures/                  静态样本和动态样本
docs/
```

TypeScript 只使用可擦除的语法（`erasableSyntaxOnly`），Node 24 可以直接运行源文件；发行时用 esbuild 打包。测试用 Node 自带的 `node:test` 和 Python 的 `unittest`，不引入额外的测试框架。

## 5 packages/wire

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `frames.ts` | `type Frame`；`encodeFrame(f: Frame): Uint8Array`；`decodeFrame(b: Uint8Array): Frame` | 第 3 节的帧 |
| `status.ts` | `type StatusCode`；`class RpcError extends Error { code; retryAfterMs? }`；`failureClass(code): 'whole' \| 'segment' \| null` | 状态码与 [运行协调器](04-run-coordinator.md) 6.3 的两类失败 |
| `stream.ts` | `class Stream<In, Out>`：`send(m: Out): Promise<void>`、`recv(): Promise<In \| undefined>`、`[Symbol.asyncIterator]()`、`halfClose()`、`cancel(reason)`、`close(status)`、`done: Promise<Status>`、`signal: AbortSignal`、`deadline?: number` | 一次调用；`send` 在额度不足时等待；时限到达时以 `deadline_exceeded` 结束 |
| `connection.ts` | `class Connection`：`open(svc, iface, ver, method, opts): Stream`、`onOpen(handler)`、`close(reason)`、`closed: Promise<void>` | 多路复用、流标识分配、额度、保活；连接断开时以 `unavailable` 结束其上全部流 |
| `ws.ts` | `connect(url, auth): Promise<Connection>`；`listen(opts: {host, port, token, origins?, onConnection}): Promise<Server>` | WebSocket 传输与握手 |
| `host.ts` | `class ServiceHost`：`constructor(name, manifest)`、`implement(iface, ver, methods: Record<string, Handler>)`、`attach(conn)`；`type Handler = (call: Stream, open: OpenInfo) => Promise<void>` | 服务端：按 `svc`、`iface`、`method` 分派，检查接口版本 |
| `client.ts` | `class Peer`：`unary(svc, iface, method, req, opts)`、`serverStream(...)`、`clientStream(...)`、`bidi(...)` | 四种调用形态的便捷封装 |

Python 的 `services/py/sth_wire` 提供同名的 `Connection`、`Stream`、`ServiceHost`、`Peer`，基于 asyncio 和 websockets，语义相同。

## 6 packages/model

| 文件 | 内容 |
| --- | --- |
| `types.ts` | [数据模型](02-data-model.md) 全部类型：`Rect`、`RectF`、`Quad`、`CaptureGeometry`、`EncodedImage`、`Image`、`TextBlock`、`OcrRegion`、`OcrResult`、`Unit`、`ReuseRef`、`Candidate`、`RaceRecord`、`SourceOutcome`、`ChangeMap`、`DisplayEvent`、`DisplaySnapshot`、`ParagraphView`、`Notice`、`Annotation` |
| `geometry.ts` | `quadBounds(q): RectF`；`pxRect(q, W, H): Rect`（数据模型 1.2 的 $\operatorname{px}$）；`orderQuad(points): Quad`（数据模型 1.2 的点序）；`iou(a, b)`；`rectUnion`、`rectIntersect`、`expandRect`、`clipRect`；`toRelative(q, W, H)` |
| `lang.ts` | `normalizeTag(t)`；`supports(declared: string[], tag): boolean`（[总览](00-overview.md) 3.5 的查找规则）；`sameBaseLanguage(a, b): boolean`（需求 09 第 3.2 节） |
| `text.ts` | `cacheKey(u: string): string`（数据模型第 8 节的 $\kappa$）；`isCjk(ch)`、`scriptOf(ch)` |

## 7 packages/render

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `state.ts` | `interface DisplayState`；`emptyState()`；`applyEvent(s, ev): ApplyResult`（序号连续时更新，不连续时返回 `gap`）；`fromSnapshot(snap)`；`toSnapshot(s)` | [显示与排版](07-display.md) 第 1 节的显示状态；运行协调器用同一份代码生成快照，保证"快照等于事件依次作用的结果" |
| `layout.ts` | `fitText(text, box, opts, measure): FitResult`；`expandBox(box, others, frame, dir)` | 07 第 5.3、5.4 节：二分查找字号、占用相邻空白、截断 |
| `dom.ts` | `class DomRenderer`：`constructor(root, settings)`、`setMode(mode)`、`render(state, frameSize, viewSize, mapping)` | 原位底板和整屏压暗两种显示方式（需求 09 第 3.1 节） |
| `annotations.ts` | `class AnnotationLayer`：`set(items)`、`clear(ids?)`、`render(viewMapping)` | [AI 助手](17-assistant.md) 第 7 节的屏幕标注 |
| `settings.ts` | `interface DisplaySettings`；`defaultSettings(kind)` | 07 第 6 节，加上显示方式和底板不透明度 |

## 8 services/coordinator

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `main.ts` | `main()` | 读启动信息，提供 `coordinator.Run`、`coordinator.GetRunDetails` |
| `run.ts` | `class Run`：`prepare(): Promise<PreflightResult>`、`execute()`、`pause(reason)`、`resume()`、`stop(reason)`、`control(action)` | [运行协调器](04-run-coordinator.md) 第 2、8、9 节的状态机和控制 |
| `plan.ts` | `compilePlan(doc, entry, resolver): Promise<ExecPlan>` | 冻结配置、解析绑定、运行前检查（[工作流定义](03-workflow.md) 6.3）；把工作流编译成执行计划 |
| `continuous.ts` | `runContinuous(run, plan)` | 04 第 3.1 节的取批次循环 |
| `batch.ts` | `processBatch(ctx, batch): Promise<BatchRecord>` | 04 第 3.2 节的一个批次 |
| `reuse.ts` | `planReuse(prev, map, frame, params, ocrDone): ReusePlan`；`paragraphShift(lines, map)`；`adjacent(rects, map, delta)`；`ocrRegions(map, positions, margin, frame)`；`dropDuplicates(result, reusedBounds)`；`matchHeld(held, units, cacheHas)` | 04 第 4 节的段落复用 |
| `cache.ts` | `class TranslationCache`：`get(key)`、`put(key, text)`、`clear()` | 04 第 5 节，最久未用淘汰 |
| `race.ts` | `class Race`：`onCandidate(c)`、`onFailure(source, cls, reason, cause?)`、`canAffect(source)`、`finish(by)`、`record()` | 04 第 6 节的竞速算法 |
| `dispatch.ts` | `class SourceDispatcher`：`dispatch(units, races, deadline)`；`class ServiceQueue`：`acquire(signal)` | 04 第 7 节：分组、排队、限速、释放与取消 |
| `availability.ts` | `class Availability`：`isUnavailable(svc)`、`mark(svc, code, retryAfter?)`、`onChange(cb)` | 04 第 6.3 节的服务可用状态 |
| `langid.ts` | `detectLanguage(text): string \| undefined` | 04 第 3.4 节；第一版按文字系统判断，可以替换为语言识别库 |
| `display.ts` | `class DisplayHub`：`open(outputs)`、`emit(body)`、`snapshot(stream)` | 为每个显示节点维护显示流，发给覆盖层、浮卡和观看服务 |
| `details.ts` | `class RunDetails`：`push(ev)`、`list(filter)` | 04 第 1 节的运行详情 |

## 9 services/normalize

| 文件 | 函数 | 职责 |
| --- | --- | --- |
| `normalize.ts` | `normalize(req: NormalizeRequest): Unit[]` | [归一化](06-normalization.md) 全部步骤 |
| `coords.ts` | `toFrameCoords(region, block): TextBlock` | 06 第 2 节 |
| `direction.ts` | `inferDirection(block): Direction` | 06 第 3 节 |
| `lines.ts` | `mergeFragments(blocks): Line[]` | 06 第 4 节 |
| `order.ts` | `readingOrder(items, gMin): Item[]`；`leafOrder(items, dir)` | 06 第 5 节的递归切分 |
| `paragraphs.ts` | `mergeParagraphs(items, params): Paragraph[]` | 06 第 6 节 |
| `join.ts` | `joinLines(a, b): string` | 06 第 7 节 |

## 10 services/translate

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `engine.ts` | `interface TranslateEngine { manifest(); translate(req, emit, signal) }` | 一个翻译源的统一形态 |
| `service.ts` | `serveEngine(engine)` | 把引擎包装成 `translate.Translate`（[服务接口](09-service-interfaces.md) 第 13 节） |
| `prompt.ts` | `buildPrompt(req): {system, user}`；`parseItems(text): Map<number, string>` | AI 类翻译源共用的提示词和结果解析，带术语表和上下文 |
| `claude-cli.ts` | `class ClaudeCliEngine` | 常驻一个 `claude -p --input-format stream-json --output-format stream-json` 进程，省去每次启动的开销；内置工具全部关闭 |
| `openai.ts` | `class OpenAiEngine` | 兼容 OpenAI 聊天补全接口，支持流式 |
| `anthropic.ts` | `class AnthropicEngine` | Anthropic Messages 接口，支持流式 |
| `bergamot.ts` | `class BergamotEngine` | Bergamot WASM，经英文串联 |
| `mock.ts` | `class MockEngine` | 按脚本给出版本、完成标记、延迟和两类失败 |

## 11 services/py/capture

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `service.py` | `main()` | 提供 `capture.Session`、`capture.Grab`（[服务接口](09-service-interfaces.md) 第 4 节） |
| `session.py` | `class CaptureSession`：`on_frame(frame, geom)`、`take_batch(wait_ms)`、`pause()`、`resume()`、`close()` | [变化检测](05-change-detection.md) 第 1 至 3 节 |
| `change.py` | `differs(a, b, tol)`；`change_map(new, old, tol, tile)`；`zero_bits(...)`；`components8(mask)`；`estimate_shift(new, old, box, axis)`；`verify_shift(...)` | 05 第 4 节，纯 numpy，与采集方式无关，回放采集也用它 |
| `sources.py` | `class WgcSource`、`class ReplaySource` | 屏幕帧的来源：Windows.Graphics.Capture，或者从文件回放 |
| `geometry.py` | `capture_geometry(range, monitors, window_rect)` | [数据模型](02-data-model.md) 1.4 的采集几何 |

## 12 services/py/ocr

| 文件 | 函数 | 职责 |
| --- | --- | --- |
| `service.py` | `main()` | 提供 `ocr.Recognize`（[服务接口](09-service-interfaces.md) 第 11 节） |
| `engine.py` | `class RapidOcrEngine`：`recognize(rgb, languages) -> list[TextBlock]` | 调用 RapidOCR，把结果转换为统一的文字块，点序按数据模型 1.2 |

## 13 services/viewer

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `main.ts` | `main()` | 提供 `viewer.Publish`、`viewer.SetSharing`；启动局域网 HTTP 服务 |
| `sources.ts` | `class SourceRegistry`：`publish(stream)`、`list()`、`subscribe(id, sink)` | [后台平台服务](10-backend.md) 5.1 至 5.3 的来源、快照和慢速观看端 |
| `frames.ts` | `class FrameStore`：`put(id, image)`、`get(id, width, dataSaver)` | 按观看端宽度缩放并编码，同一宽度只编码一次 |
| `http.ts` | `startHttp(opts)` | 网页、画面、浏览器 WebSocket；访问口令（需求 09 第 3.4 节） |
| `web/` | 观看页 | 来源列表、画面与译文、显示设置；用 `@sth/render` 绘制 |

## 14 services/assistant

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `main.ts` | `main()` | 提供 `assistant.Session`、`assistant.Tools` |
| `session.ts` | `class AssistantSession`：`start(opts)`、`userMessage(text)`、`pause()`、`resume()`、`stop()` | [AI 助手](17-assistant.md) 第 2 节；叫醒的合并与排队 |
| `heartbeat.ts` | `class Heartbeat`：`start()`、`stop()`、`onSample(cb)` | 17 第 3 节 |
| `gate.ts` | `class RuleGate`、`class JevGate`、`class CompositeGate` | 17 第 4 节 |
| `tools.ts` | `platformTools(deps): PlatformTool[]` | 17 第 6 节，一份定义，供 pi 和 MCP 共用 |
| `brain-pi.ts` | `class PiBrain` | 17 第 5.2 节 |
| `brain-claude.ts` | `class ClaudeCodeBrain` | 17 第 5.2 节 |
| `mcp.ts` | `runMcpStdio(tools)` | 供 Claude Code 使用的 MCP 服务器 |

## 15 apps/desktop

| 文件 | 函数与类型 | 职责 |
| --- | --- | --- |
| `main/main.ts` | 应用入口 | 单实例、托盘、设置、启动主程序核心 |
| `main/agent.ts` | `class AgentCore`：`start()`、`stop()`；`agent` 接口的 `Register`、`ListServices`、`Acquire`、`Notify`、`SaveHistory` | 服务清单与转发（[服务接口](09-service-interfaces.md) 第 3 节） |
| `main/supervisor.ts` | `class Supervisor`：`define(spec)`、`ensure(name)`、`stop(name)`、`stopAll()` | 按需启动、退避重启、空闲回收 |
| `main/settings.ts` | `loadSettings()`、`saveSettings(s)` | 设置文件，位于 `%APPDATA%\screen-translate-hub` |
| `main/entries.ts` | `startScreenshot()`、`toggleContinuous()`、`toggleOverlay()`、`toggleInteractive()`、`focusAssistant()` | 入口：按绑定的工作流发起运行 |
| `main/hotkeys.ts` | `registerHotkeys(map, handlers)` | 全局快捷键 |
| `main/win32.ts` | `getWindowRect(hwnd)`、`getForegroundWindow()`、`setWindowPosAfter(hwnd, after)`、`watchWinEvents(cb)`、`setToolWindow(hwnd)`、`excludeFromCapture(hwnd)` | koffi 调用 user32、dwmapi |
| `main/overlay.ts` | `class OverlayService`：`overlay.Attach`、`overlay.Annotate` | 覆盖层窗口：透明、点击穿透、不激活、排除截屏；跟随窗口 |
| `main/region-select.ts` | `selectRegion(): Promise<Rect \| null>` | 框选界面 |
| `main/card.ts` | `class CardService`：`card.Open` | 截图结果：画在原位或截图浮卡 |
| `main/assistant-card.ts` | `class AssistantCard` | AI 悬浮卡片 |
| `renderer/*` | 各窗口的页面 | 覆盖层、浮卡、AI 卡片、框选、设置 |

## 16 开发与测试

- 单元测试：`npm test` 运行全部 TS 包的 `node:test`，`python -m unittest` 运行 Python 包；
- 端到端（无界面）：`tools/dev/e2e-*.ts` 启动无界面主程序，用回放采集和模拟翻译源跑通单次截图和持续屏幕，比较记录显示端收到的事件（[验收与测试](16-acceptance.md) 第 2、4 节）；
- 桌面实测：经 SSH 开发时，用 `tools/win/run-in-desktop.ps1` 在桌面会话中启动主程序；设置 `STH_DEBUG_CAPTURABLE=1` 时平台窗口不排除在采集之外，以便截图检查覆盖层的绘制。
