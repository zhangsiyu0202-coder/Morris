# Subagent C 工作单 — Stop/Abort + Slash commands (P1-3 + P1-6)

## 任务边界

两件纯前端改动合并:
1. **Stop/Abort**: 用户在 Morris 流中途想停下来, 当前没办法 (只有 retry 错误后)
2. **Slash commands**: 输入框打 `/` 触发命令面板, 5 个内置命令

**不做**:
- 持久化 conversation (subagent A)
- Agent context 注入 (subagent B)

## 必读

1. `.kiro/steering/design-system.md::Buttons` + `::Disclosure rows` + `::Sidebar` — 视觉规则
2. `apps/web/components/assistant/conversation.tsx` — 主 UI, 你要改这里
3. `apps/web/components/assistant/assistant-dock.tsx` — dock UI
4. `useChat` 文档 — 它有 `stop` 函数 (https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat#stop) 和 `setMessages` 函数
5. `/home/jia/posthog/frontend/src/scenes/max/slash-commands.tsx` — PostHog 形态 (本地 PostHog clone)

## Part A: Stop/Abort

### 改动

`apps/web/components/assistant/conversation.tsx`:

- `useChat` 解构加 `stop`: `const { messages, sendMessage, status, error, regenerate, clearError, stop } = useChat({...})`
- 在输入框右侧的 send 按钮区域, 当 `status === "submitted"` 或 `"streaming"` 时, **替换** send 按钮为 stop 按钮:
  - 图标: `Square` from lucide-react (实心方块)
  - 颜色: outline (白底 ink-900 边框) + 圆角 8px
  - onClick: `stop()` + 把 status 重置为 idle
- stop() 后流被打断, 已经收到的 partial 文字保留 (useChat 自动)

### 单元测试

`apps/web/components/assistant/__tests__/stop-button.test.tsx` (用 @testing-library/react):
- status="ready" 时显示 send 按钮
- status="streaming" 时显示 stop 按钮
- 点击 stop 调 useChat.stop

## Part B: Slash commands

### 命令清单 (5 个)

| Command | 触发 | 行为 |
|---|---|---|
| `/new` | 输入 `/new` 回车 | 调 createConversation (subagent A 实现 — 你**不要**自己写 createConversation; 改成 fetch 占位 + TODO comment 说"等 subagent A 完成") |
| `/clear` | 输入 `/clear` 回车 | 清空当前 conversation 的 messages (`setMessages([])`); 留 conversation doc, 不删 |
| `/list` | 输入 `/list` 回车 | sendMessage("列出我所有的调研") — 让 Morris 自己调 listStudies 工具 |
| `/study <id>` | 输入 `/study s_abc123` 回车 | sendMessage("切换到调研 s_abc123 上下文, 给我列出最近 sessions"); 也可以直接改 PageContext (P2) |
| `/help` | 输入 `/help` 回车 | 本地渲染一条 assistant 消息 (使用 setMessages append), 列出所有命令; 不调 LLM |

**重要**: 命令在前端拦截, **不发到** /api/assistant. 直接在 submit 函数检测 `text.startsWith("/")` 后分支处理.

### 命令面板 UI

`apps/web/components/assistant/slash-command-menu.tsx` (新文件):
- 当 input value === "/" 或 "/<前缀>" 时显示
- floating 在输入框上方 (用 `absolute` + `bottom-full` 定位)
- 列出匹配命令: `[/icon] {command}  {description}`
- ↑/↓ 键导航, Enter 选中
- Escape 关闭

### 改动 conversation.tsx

```typescript
// 在 submit() 函数加分支:
function submit(text: string) {
  const trimmed = text.trim();
  if (!trimmed || isBusy) return;
  if (trimmed.startsWith("/")) {
    handleSlashCommand(trimmed);
    return;
  }
  sendMessage({ text: trimmed });
  setInput("");
}

function handleSlashCommand(text: string) {
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  switch (cmd) {
    case "new": /* TODO: 等 subagent A 的 createConversation 接通 */ break;
    case "clear": setMessages([]); break;
    case "list": sendMessage({ text: "列出我所有的调研" }); break;
    case "study": sendMessage({ text: `切换到调研 ${args[0]} 上下文, 给我列出最近 sessions` }); break;
    case "help": setMessages([...messages, { id: `help-${Date.now()}`, role: "assistant", parts: [{ type: "text", text: HELP_TEXT }] }]); break;
    default: /* 未知命令: 当普通消息发出 */ sendMessage({ text }); break;
  }
  setInput("");
}
```

### 单元测试

`apps/web/components/assistant/__tests__/slash-commands.test.tsx`:
- /clear 调 setMessages([])
- /list 调 sendMessage 含 "列出我所有的调研"
- /help 不调 sendMessage, append 一条 assistant 消息
- 未知命令 /foo 当普通消息发
- /new 占位 — 调用了 (注释 TODO 即可, 测试不强 assert 行为)

## 写文档/代码 fallback 规则

(同 B 工作单)

## 验收

- `pnpm -F web typecheck` Done
- 新增测试 ≥ 8 用例 (Part A 3 + Part B 5+) 全绿
- `pnpm vitest run apps/web/components/assistant` 全绿
- 手动: 启动 dev server, 在 /assistant 发条长 prompt, 中途点 stop, 看到流停止 + 部分文字保留
- 手动: 输入 /h 显示自动补全 /help; Enter 后看到 help 消息

## 不做的

- 不实现 createConversation (subagent A 做)
- 不改 system prompt (subagent B 做)
- 不引入新依赖 — 命令面板用 plain React + tailwind
- 不接 useEffect keyboard shortcut 全局 — 仅输入框内捕获 ↑↓Enter Escape
