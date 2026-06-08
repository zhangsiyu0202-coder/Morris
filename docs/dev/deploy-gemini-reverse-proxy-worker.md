# 部署 Gemini Reverse Proxy（Cloudflare Worker）— Merism 用

> **目标读者**：Merism 工程接手人。
> **目的**：把 [`JacobLinCool/gemini-reverse-proxy-worker`](https://github.com/JacobLinCool/gemini-reverse-proxy-worker) 部署到自己的 Cloudflare Worker，作为 Merism 后端调用 Google Gemini API（含 **Files API**）的统一出口。
> **为什么这样做**：境内直接调用 `generativelanguage.googleapis.com` 不稳定；走 OpenAI-compat 商业中转会丢失 Files API + `video_metadata.start_offset/end_offset`，无法复刻 PostHog 的"上传一次 + 多段独立分析 + 二阶段 consolidation"流程。本反代**协议层 1:1 透传**，Files API 完整可用。

---

## 0. 数据流路径

```
Merism Function (analyzeSession)
        │
        │  HTTPS (你掌控)
        ▼
你部署的 Cloudflare Worker (worker.your-domain.workers.dev)
        │
        │  HTTPS (Cloudflare ↔ Google)
        ▼
generativelanguage.googleapis.com  (Google AI Studio)
        │
        │  或 aiplatform.googleapis.com  (Vertex AI)
```

**第三方层级 = 0**（Cloudflare 不算第三方推理服务，它只是 CDN/边缘转发）。
**协议完整度 = 100%**（Files API、`/v1beta/files`、resumable upload、`video_metadata` 全保留）。
**月成本 ≈ 0**（Cloudflare Worker 免费 10 万请求/天 + Google AI Studio 免费额度）。

---

## 1. 前置条件清单

| 项 | 必需 | 说明 |
|---|---|---|
| Cloudflare 账号 | ✅ | 免费注册即可 |
| Google AI Studio API Key（`AIzaSy...`）**或** Vertex AI Service Account JSON | ✅ | 二选一，推荐前者，简单 |
| Node.js ≥ 20 | ✅ | 本地构建 Worker |
| pnpm ≥ 8 | ✅ | repo 用 pnpm |
| wrangler CLI（Cloudflare Worker 工具） | ✅ | 后面 `npm i -g wrangler` |
| 一张境外可用支付方式 | ⚠️ | 只在你想超出 Google 免费额度时才需要。Wildcard / Nobepay / 实体 Visa 都行 |

> ⚠️ **关于 Google AI Studio 免费额度**：截至 2026 年，`gemini-2.5-flash-lite` 在 AI Studio 有可观的免费层（具体数字 Google 会调整，请以 [`https://ai.google.dev/pricing`](https://ai.google.dev/pricing) 为准）。如果你只做内部测试或小流量 dogfooding，**通常不会触发付费**。

---

## 2. 拿到 Google AI Studio API Key

> 这一步通常要科学上网，走完一次拿到 key 之后**就不再需要**——后续所有调用都通过你的 Cloudflare Worker 出口。

### 2.1 注册 / 登录

1. 打开 https://aistudio.google.com
2. 用一个 Google 账号登录（任意区都可，无需美区，但**避免账号曾被风控**）
3. 同意 Terms

### 2.2 创建 API Key

1. 左侧导航 → **Get API key** → **Create API key**
2. 关联到一个 Google Cloud Project（没有就创建一个新的，名字随意，如 `merism-dev`）
3. 拿到形如 `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` 的 key
4. **立刻保存到密码管理器**——AI Studio 不能再次查看完整 key

### 2.3 给 Project 启用 Generative Language API

通常在创建 key 时自动启用。如果调用报 `PERMISSION_DENIED`：

1. 打开 https://console.cloud.google.com
2. 选择对应 project
3. 搜索 **Generative Language API** → Enable

### 2.4 申请多个 key（可选，推荐）

反代支持**多 key 负载均衡 + 失败转移**（用 `;` 分隔）。建议至少申请 **2-3 个 key**：

- 提高免费额度上限（按 key 计算）
- 一个 key 被风控时其他 key 接管
- 工程上对应 Merism 的"provider 高可用"需求

每个 key 可以挂在**同一个 GCP project 下**，也可以分散到不同 project（更隔离，但管理更繁）。

### 2.5 关于 Vertex AI Service Account（Path C-vertex 退路）

如果将来你需要用 Vertex AI（更高额度、企业级 SLA、需要绑定信用卡），换成 Service Account JSON。本反代**两种鉴权方式都支持**，环境变量塞 JSON 字符串即可。

> 本文档默认以 **AI Studio API key** 为路径——简单、免费起步、Files API 全开。

---

## 3. Cloudflare 账号 + Wrangler CLI 准备

### 3.1 注册 Cloudflare 账号

1. https://dash.cloudflare.com/sign-up
2. 邮箱 + 密码注册（**不需要**绑定域名也能用 `*.workers.dev` 默认子域）
3. 完成邮箱验证

> 想自定义子域名（比如 `gemini.merism.app`）的话，需要把一个域名托管到 Cloudflare DNS。这一步**可以延后做**，Worker 先用默认 `*.workers.dev` 子域跑通即可。

### 3.2 安装 Wrangler

Wrangler 是 Cloudflare Worker 的官方 CLI。**全局**安装一次即可：

```bash
npm install -g wrangler
# 验证
wrangler --version
# 应输出 4.x.x（2026 当下主线 4.x，注意 3.x 与 4.x 命令略有差异）
```

如果你在 macOS 上怕权限问题，也可以用 `npx wrangler ...` 每次临时调用。

### 3.3 登录 Cloudflare

```bash
wrangler login
```

会自动开浏览器，授权 Wrangler 访问你的 Cloudflare 账号。完成后命令行返回 `Successfully logged in`。

> **服务器/CI 环境**没有浏览器时，改用 API Token：
> 1. Cloudflare Dashboard → My Profile → API Tokens → Create Token → 选 "Edit Cloudflare Workers" 模板
> 2. 在 shell 里 `export CLOUDFLARE_API_TOKEN=xxx`
> 3. wrangler 自动识别该环境变量

---

## 4. 拿到 Worker 源码（Fork 或 Clone）

### 4.1 推荐：Fork 到自己的 GitHub 账号

```
点开 https://github.com/JacobLinCool/gemini-reverse-proxy-worker
→ 右上角 Fork
→ Owner 选你自己 / 你的 org
→ Create fork
```

**为什么 Fork 不直接 Clone**：

- 上游有更新时你能 sync
- 你后面要改 Worker（比如加自定义 header、加额外路由、对接 Cloudflare AI Gateway）需要存自己的 commit 历史
- Cloudflare Worker 可以接到 GitHub → push 自动部署（CI/CD）

### 4.2 Clone 到本地

```bash
git clone git@github.com:<你的 GitHub 用户名>/gemini-reverse-proxy-worker.git
cd gemini-reverse-proxy-worker
```

### 4.3 安装依赖

```bash
pnpm install
```

如果机器上没 pnpm：

```bash
npm install -g pnpm
# 或者用 corepack（推荐 Node 20+）
corepack enable
corepack prepare pnpm@latest --activate
```

### 4.4 项目结构（速览）

```
gemini-reverse-proxy-worker/
├── src/                     Worker 主代码（TypeScript）
├── public/                  Dashboard 静态资源（HTML/CSS）
├── scripts/                 测试 / 工具脚本
├── wrangler.jsonc           Cloudflare Worker 配置（重要）
├── .env.example             本地开发用环境变量样板
├── package.json             依赖 + pnpm scripts
├── worker-configuration.d.ts  Wrangler 自动生成的环境类型
└── README.md
```

**关键文件**：
- `wrangler.jsonc`——Worker 部署配置（名称、路由、KV/D1 绑定等）
- `.env.example`——本地 dev 时读，部署到 Cloudflare 后**不会**生效（生产环境靠 `wrangler secret put`）

---

## 5. 配置 `wrangler.jsonc`

打开 `wrangler.jsonc`，至少改这两处：

### 5.1 Worker 名字

```jsonc
{
  // ...
  "name": "merism-gemini-proxy",   // 改成有辨识度的名字，会成为子域：merism-gemini-proxy.<你的账号子域>.workers.dev
  // ...
}
```

> Worker 名字一旦部署，**就是你的 URL 的一部分**。改名 = 换 URL。所以选好名字一次到位。

### 5.2 Compatibility date

```jsonc
{
  // ...
  "compatibility_date": "2026-06-01",   // 用一个近期的日期；越新越能用 Cloudflare 最新 runtime 特性
  // ...
}
```

### 5.3 路由（可选，先跳过）

默认不配 `routes`，Worker 会挂在 `https://<name>.<account-subdomain>.workers.dev`。

如果以后要绑定自定义域名（比如 `gemini.merism.app`）：

```jsonc
{
  // ...
  "routes": [
    { "pattern": "gemini.merism.app/*", "custom_domain": true }
  ]
}
```

前提是该域名已经托管到 Cloudflare DNS。

### 5.4 KV 绑定（可选，进阶用）

如果你想做"运行时改 key 不重新部署"，绑定一个 KV namespace 给 `KV_STORAGE`：

```jsonc
{
  // ...
  "kv_namespaces": [
    { "binding": "KV_STORAGE", "id": "<你的 KV namespace ID>" }
  ]
}
```

KV namespace 的创建：

```bash
wrangler kv namespace create merism-gemini-proxy-config
# 输出里把 id 复制到 wrangler.jsonc
```

> 第一次部署**不需要**配 KV——直接走环境变量更简单。等你跑稳了、需要在线轮换 key 时再加。

---

## 6. 设置 Secrets（生产环境的 API Key）

> **不要把 key 写进 `wrangler.jsonc`，也不要 commit `.env`**。生产 Worker 必须用 `wrangler secret put` 注入。

### 6.1 必须设置：`GEMINI_API_KEY`

```bash
wrangler secret put GEMINI_API_KEY
# 命令行会让你粘贴 value：
# 单 key：AIzaSyXXXX
# 多 key（推荐）：AIzaSyAAA;AIzaSyBBB;AIzaSyCCC
# 直接粘贴回车即可（终端不显示，正常）
```

### 6.2 强烈建议：`CLIENT_KEY_VALIDATION_SECRET`

**这是保护你的 Worker 不被全网随便调用的关键**——没设的话任何人拿到你的 worker URL 就能用你的 Google 配额烧 token。

```bash
# 生成一个高熵秘钥
openssl rand -base64 48
# 输出形如 zX5d... 的 64+ 字符

# 注入 Worker
wrangler secret put CLIENT_KEY_VALIDATION_SECRET
# 把刚才生成的 secret 粘贴进去
```

设置后，**所有调用方必须在 `x-goog-api-key` 头里带一个用这个 secret 签发的 JWT**——见下面 §10 客户端 JWT 签发。

### 6.3 可选：`GEMINI_API_BASE_URL`

如果你要让反代转发到 **Cloudflare AI Gateway**（拿到额外的缓存/分析能力），改成：

```bash
wrangler secret put GEMINI_API_BASE_URL
# 粘贴：https://gateway.ai.cloudflare.com/v1/<你的 Cloudflare account id>/<你的 gateway slug>/google-ai-studio/
```

否则**不用设**，反代默认走 `https://generativelanguage.googleapis.com/`。

### 6.4 验证 secrets 已落

```bash
wrangler secret list
# 应该看到：
# GEMINI_API_KEY (encrypted)
# CLIENT_KEY_VALIDATION_SECRET (encrypted)
# 等等
```

> ⚠️ Wrangler 不显示 secret 的明文值。要回看就只能在你的密码管理器里找。

---

## 7. 部署

### 7.1 第一次部署

```bash
pnpm deploy
# 等价于 wrangler deploy
```

终端会打印类似：

```
Deployed merism-gemini-proxy triggers (4.21s)
  https://merism-gemini-proxy.<你的账号子域>.workers.dev
Current Version ID: 12345678-...
```

**记录这个 URL**——它就是你后续给 Merism 的 `GEMINI_API_BASE_URL`。

### 7.2 本地开发模式（可选）

```bash
pnpm dev
# 等价于 wrangler dev
```

会在 `http://localhost:8787` 起一个本地 Worker，连同 secrets 都从 `.env` 读（这就是 `.env.example` 的用途）。

### 7.3 通过 GitHub Actions 自动部署（推荐，进阶）

让 push 到 main 自动部署。在 fork 仓库里：

1. 创建 Cloudflare API Token（见 §3.3）
2. GitHub repo → Settings → Secrets and variables → Actions → 新建 secret：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`（在 Cloudflare Dashboard 右侧能看到）
3. 添加 `.github/workflows/deploy.yml`：

```yaml
name: Deploy Worker
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

这样以后改 Worker 代码 push 即上线。**Secrets（如 GEMINI_API_KEY）仍然只能用 `wrangler secret put` 一次性写入**——不会出现在代码里。

---

## 8. 验证：Files API 是否真的走通

> 这是部署完**必须**做的一步——验证反代不仅能 `generateContent`，还能**完整代理 Files API**。这是 PostHog 流程能不能跑的关键。

> 假设你**没**启用 `CLIENT_KEY_VALIDATION_SECRET`，先用裸 Worker 测；启用后改用 JWT，见 §10。

设环境变量方便后续命令：

```bash
export WORKER_URL=https://merism-gemini-proxy.<你的账号子域>.workers.dev
export DIRECT_KEY=AIzaSyXXXXXXXXXX   # 一个真实的 AI Studio key（直接传，不签 JWT）
```

### 8.1 健康检查（基础 generateContent）

```bash
curl -s -X POST \
  "$WORKER_URL/v1beta/models/gemini-2.5-flash-lite:generateContent" \
  -H "x-goog-api-key: $DIRECT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{ "text": "Reply with exactly the word OK." }]
    }]
  }' | jq .
```

期望看到 `"text": "OK"` 或近似。

### 8.2 关键验证：Files API resumable upload 启动

```bash
curl -s -i -X POST \
  "$WORKER_URL/upload/v1beta/files" \
  -H "x-goog-api-key: $DIRECT_KEY" \
  -H "X-Goog-Upload-Protocol: resumable" \
  -H "X-Goog-Upload-Command: start" \
  -H "X-Goog-Upload-Header-Content-Length: 1024" \
  -H "X-Goog-Upload-Header-Content-Type: video/mp4" \
  -H "Content-Type: application/json" \
  -d '{ "file": { "display_name": "smoke-test.mp4" } }'
```

**期望**响应头里出现 `X-Goog-Upload-URL: https://...`。这意味着反代**完整透传**了 Google 的 resumable upload 协议——Files API 全开。

如果失败：
- **404**：路径写错了，或 Worker 在剥 path（不应该，但有些反代实现会）
- **401**：API key 没通过；检查 `wrangler secret list` 和 §6.1
- **400** + `Invalid X-Goog-Upload-Protocol`：Worker 在重写或丢了关键 header；检查 src 里 fetch 时是不是把 headers 透传了

### 8.3 端到端：上传一段视频 → 分段分析

写一个 Node 脚本快测。新建 `scripts/smoke-files-api.ts`（或者在 Merism 仓库里新建一个临时脚本）：

```ts
import { GoogleGenAI, createPartFromUri } from "@google/genai";
import * as fs from "node:fs";

const WORKER_URL = process.env.WORKER_URL!;
const KEY = process.env.GEMINI_DIRECT_KEY!;   // 暂时用直传 key 测

const ai = new GoogleGenAI({
  apiKey: KEY,
  httpOptions: { baseUrl: WORKER_URL },   // 关键：把所有 Gemini 流量打到你的 Worker
});

// 1. 上传一段 30 秒的测试视频（提前准备 sample.mp4）
const uploaded = await ai.files.upload({
  file: "./sample.mp4",
  config: { mimeType: "video/mp4", displayName: "smoke" },
});

// 2. 等 ACTIVE
let file = uploaded;
while (file.state?.toString() === "PROCESSING") {
  await new Promise((r) => setTimeout(r, 1000));
  file = await ai.files.get({ name: uploaded.name! });
}
if (file.state?.toString() !== "ACTIVE") throw new Error("file not ACTIVE");

console.log("file_uri:", file.uri);

// 3. 用 video_metadata.start_offset/end_offset 切片分析（PostHog 流程的核心）
const resp = await ai.models.generateContent({
  model: "gemini-2.5-flash-lite",
  contents: [
    {
      role: "user",
      parts: [
        {
          fileData: { fileUri: file.uri!, mimeType: "video/mp4" },
          videoMetadata: { startOffset: "5s", endOffset: "15s" },
        },
        { text: "Describe what happens in this 10-second slice." },
      ],
    },
  ],
});

console.log(resp.text);

// 4. 清理
await ai.files.delete({ name: file.name! });
```

跑：

```bash
pnpm add -D @google/genai tsx
WORKER_URL=https://merism-gemini-proxy.<...>.workers.dev \
GEMINI_DIRECT_KEY=AIzaSy... \
npx tsx scripts/smoke-files-api.ts
```

跑通 = 你的反代**完整复刻 PostHog 流程的所有底层能力**。

---

## 9. Merism 接入：`analyzeSession` 新增 Gemini 视觉链路

> 这一节给的是**接入骨架**，不是完整实现。完整实现等 ADR 0005 确定后做。

### 9.1 环境变量（`.env` / Appwrite Function 环境）

```bash
# 反代地址
GEMINI_API_BASE_URL=https://merism-gemini-proxy.<...>.workers.dev/

# 客户端用的 token——**不是** AI Studio key 本身
# 如果启用了 CLIENT_KEY_VALIDATION_SECRET，这里放签发出来的 JWT
# 否则放真实 AI Studio key（开发期可以这样，**生产必须 JWT**）
GEMINI_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 模型
GEMINI_MODEL=gemini-2.5-flash-lite

# 视觉分析开关
GEMINI_VISUAL_ANALYSIS_ENABLED=true

# 上限保护（避免一次访谈花光月度预算）
GEMINI_VIDEO_MAX_SIZE_MB=2048    # 单个视频上限，超出走降级
GEMINI_FILES_TTL_HOURS=48        # 上传后 TTL，超时清理
GEMINI_SEGMENT_DURATION_SEC=60   # 默认每段 60 秒
GEMINI_SEGMENT_OVERLAP_SEC=2     # 段间重叠 2 秒避免动作被切断
GEMINI_MAX_PARALLEL_SEGMENTS=4   # 并发段数（受 worker rate-limit 影响）
```

### 9.2 模块结构（对标 PostHog activities）

```
apps/functions/analyzeSession/src/
├── handler.ts                                 // 已有：纯核心
├── main.ts                                    // 已有：SDK wrapper
├── video-segments.ts                          // 已有：段规划，留用
├── gemini-visual-analyzer.ts                  // 顶层编排器
├── gemini/
│   ├── client.ts                              // GoogleGenAI 实例化，httpOptions.baseUrl 指向反代
│   ├── upload-video.ts                        // 对应 PostHog a2_upload_video_to_gemini
│   ├── analyze-segment.ts                     // 对应 a4_analyze_video_segment
│   ├── consolidate.ts                         // 对应 a6_consolidate_video_segments；Merism 用 DeepSeek（PostHog 全 Gemini，但 a6 是纯文本 reasoning，DeepSeek 够用且更便宜）
│   └── cleanup.ts                             // files.delete，best-effort
└── prompts/
    ├── visual-segment-analysis.ts             // 单段 prompt
    └── visual-consolidation.ts                // 二阶段 prompt
```

### 9.3 `gemini/client.ts`（最关键的一行）

```ts
import { GoogleGenAI } from "@google/genai";

export function createGeminiClient(env: {
  GEMINI_API_BASE_URL: string;
  GEMINI_API_KEY: string;
}) {
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: {
      // ⚠️ 必须以 / 结尾。SDK 会自动拼 v1beta/...
      baseUrl: env.GEMINI_API_BASE_URL,
    },
  });
}
```

**就这一行 `baseUrl`**——把 SDK 默认的 Google 官方 URL 替换成你的 Worker URL。下面所有调用就走反代了。

### 9.4 `gemini/upload-video.ts`（PostHog a2 等价）

```ts
export async function uploadVideoToGemini(deps: {
  client: GoogleGenAI;
  videoBytes: Uint8Array;
  mimeType: string;          // 通常 "video/mp4"
  displayName: string;       // 推荐用 sessionId 或 traceId 便于追溯
  maxWaitSec?: number;       // 默认 300
}): Promise<{ fileUri: string; geminiFileName: string; durationSec: number }> {
  const { client, videoBytes, mimeType, displayName, maxWaitSec = 300 } = deps;

  const uploaded = await client.files.upload({
    file: new Blob([videoBytes], { type: mimeType }),
    config: { mimeType, displayName },
  });

  // 等 state == ACTIVE
  let file = uploaded;
  const start = Date.now();
  while (file.state?.toString() === "PROCESSING") {
    if ((Date.now() - start) / 1000 >= maxWaitSec) {
      // best-effort 清理已上传的孤儿
      await client.files.delete({ name: file.name! }).catch(() => {});
      throw new Error("gemini_file_processing_timeout");
    }
    await new Promise((r) => setTimeout(r, 500));
    file = await client.files.get({ name: file.name! });
  }
  if (file.state?.toString() !== "ACTIVE") {
    throw new Error("gemini_file_not_active");
  }

  const durationSec = parseFloat(file.videoMetadata?.videoDuration ?? "0");

  return {
    fileUri: file.uri!,
    geminiFileName: file.name!,
    durationSec,
  };
}
```

### 9.5 `gemini/analyze-segment.ts`（PostHog a4 等价）

```ts
export async function analyzeVideoSegment(deps: {
  client: GoogleGenAI;
  fileUri: string;
  mimeType: string;
  segment: { startSec: number; endSec: number; index: number };
  prompt: string;            // 来自 prompts/visual-segment-analysis.ts
  model?: string;
}) {
  const { client, fileUri, mimeType, segment, prompt, model = "gemini-2.5-flash-lite" } = deps;

  const resp = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: { fileUri, mimeType },
            videoMetadata: {
              startOffset: `${segment.startSec.toFixed(2)}s`,
              endOffset: `${segment.endSec.toFixed(2)}s`,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      // 严格 JSON 输出（visualAnalysis schema 要求）
      responseMimeType: "application/json",
    },
  });

  return {
    segmentIndex: segment.index,
    text: resp.text,           // 可解析的 JSON 字符串
    usageTokens: resp.usageMetadata,
  };
}
```

### 9.6 `gemini-visual-analyzer.ts`（顶层编排）

```ts
export async function runGeminiVisualAnalysis(deps: {
  client: GoogleGenAI;
  videoBytes: Uint8Array;
  transcript: TranscriptSegment[];
  sessionId: string;
  config: {
    segmentDurationSec: number;
    overlapSec: number;
    maxParallelSegments: number;
    filesTtlHours: number;
  };
  consolidator: (segments: SegmentResult[]) => Promise<VisualAnalysis>;
  // ↑ consolidator 用 DeepSeek 实现（已有的 deepseek 适配器复用）
}): Promise<VisualAnalysis> {
  const { client, videoBytes, transcript, sessionId, config, consolidator } = deps;

  // 1. 上传视频（PostHog a2）
  const { fileUri, geminiFileName, durationSec } = await uploadVideoToGemini({
    client,
    videoBytes,
    mimeType: "video/mp4",
    displayName: sessionId,
  });

  try {
    // 2. 规划段（已有的 video-segments.ts）
    const segments = planSegments({
      durationSec,
      segmentDurationSec: config.segmentDurationSec,
      overlapSec: config.overlapSec,
    });

    // 3. 每段独立调用，并发上限 maxParallelSegments
    const results = await mapWithConcurrency(
      segments,
      config.maxParallelSegments,
      (segment) =>
        analyzeVideoSegment({
          client,
          fileUri,
          mimeType: "video/mp4",
          segment,
          prompt: buildSegmentPrompt(segment, transcript),
        })
          .then((r) => ({ ok: true as const, ...r }))
          .catch((err) => ({ ok: false as const, segment, err })),
    );

    // 4. 容错：partial result（PostHog 没有这条，但 Merism 要这条）
    const successful = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // 5. consolidate（PostHog a6，但我们用 DeepSeek 不用 Gemini）
    const visualAnalysis = await consolidator(successful);

    return {
      ...visualAnalysis,
      provenance: {
        modelId: "gemini-2.5-flash-lite",
        viaRelay: "cloudflare-worker",
        failedSegments: failed.map((f) => ({
          index: f.segment.index,
          reason: String(f.err),
        })),
      },
    };
  } finally {
    // 6. 清理（PostHog cleanup）
    await client.files.delete({ name: geminiFileName }).catch(() => {});
  }
}
```

### 9.7 ADR 与 AGENTS 同步

接入完成时同步：

- **新建** `docs/adr/0005-gemini-visual-analysis-via-cloudflare-worker.md`（取代 ADR-0004 Qwen 路线）
- **更新** `AGENTS.md` 的 Provider 段：DeepSeek (LLM) + Qwen (ASR/TTS) + **Gemini via self-hosted Cloudflare Worker (post-session video only)**
- **更新** `AGENTS.md` 的 Backend forbidden list："No second LLM provider" 改为"Gemini 仅用于 post-session 视觉分析，调用边界硬约束在 `apps/functions/analyzeSession/`"

---

## 10. 客户端 JWT 签发（生产必须）

> 启用 `CLIENT_KEY_VALIDATION_SECRET` 后，**调用方在 `x-goog-api-key` 请求头里放的不是 AI Studio key 本身，而是一个 HMAC-SHA256 签名的 JWT**。这是反代的"门票"——没有签名匹配的 JWT 进不来。

### 10.1 JWT payload 结构

```jsonc
{
  "nbf": 1763237597,                              // not-before, Unix 秒
  "exp": 3000000000,                              // expiration, Unix 秒
  "allowed_endpoints": ["^/v1beta/.*"]            // 可选，正则数组限制可访问的路径
}
```

### 10.2 在 Merism 这边签发 JWT

新建 `apps/functions/analyzeSession/src/gemini/jwt.ts`：

```ts
import { createHmac } from "node:crypto";

function base64url(input: string | Buffer): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function signGeminiProxyToken(deps: {
  validationSecret: string;
  ttlSeconds?: number;             // 默认 3600（1 小时）
  allowedEndpoints?: string[];     // 默认全开
}): string {
  const { validationSecret, ttlSeconds = 3600, allowedEndpoints } = deps;

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    nbf: now - 5,                  // 容忍 5 秒时钟漂移
    exp: now + ttlSeconds,
  };
  if (allowedEndpoints) payload.allowed_endpoints = allowedEndpoints;

  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${payloadB64}`;
  const signature = base64url(
    createHmac("sha256", validationSecret).update(signingInput).digest(),
  );

  return `${signingInput}.${signature}`;
}
```

### 10.3 调用 Gemini SDK 时使用

```ts
import { signGeminiProxyToken } from "./gemini/jwt";
import { GoogleGenAI } from "@google/genai";

const apiKey = signGeminiProxyToken({
  validationSecret: process.env.GEMINI_PROXY_VALIDATION_SECRET!,
  ttlSeconds: 3600,
  allowedEndpoints: ["^/v1beta/.*", "^/upload/v1beta/files$"],
});

const client = new GoogleGenAI({
  apiKey,
  httpOptions: { baseUrl: process.env.GEMINI_API_BASE_URL! },
});
```

### 10.4 Token 生命周期建议

| 场景 | TTL | 备注 |
|---|---|---|
| 一次访谈分析（端到端 ≤ 30 min） | 1 小时 | 单次任务用一个 token |
| Function 启动时签发，整个进程复用 | 1 小时 + 自动续签 | 检查 exp 临近时刷新 |
| 单元测试 | 5 分钟 | 测完即弃 |

**不要**让 token 几天不过期——一旦泄漏在日志里就是任意调用入场券。

---

## 11. 限流、成本、监控

### 11.1 Cloudflare Worker 免费层限制

| 项 | 免费层 | 付费起步（$5/月） |
|---|---|---|
| 请求数 | **10 万 / 天** | 1000 万 / 月 |
| CPU 时间 | **10 ms / 请求** | 30 s / 请求 |
| 单请求 body 大小 | 100 MB | 同 |
| 单响应 body 大小 | 25 MB（流式） | 同 |
| Subrequests（外发请求数） | 50 / 请求 | 1000 / 请求 |

**对反代来说**：
- 反代是 IO-bound，CPU 时间几乎不成问题——免费层够用
- 单请求 body 100 MB 对**视频上传是天花板**，但因为 Files API 用 resumable upload **每 chunk ≤ 8 MB**，所以 GB 级视频也能传
- 50 个 subrequests/请求**只**对你写的 Worker 单次调用有限制；正常代理一来一回 = 1 subrequest，**完全富裕**
- Merism 当前流量量级（dogfooding 阶段每天 < 100 段访谈），**永远跑不满免费层**

### 11.2 Google AI Studio 免费层（动态，以官网为准）

截至 2026-Q2：

- `gemini-2.5-flash-lite`：每 RPM、每日 RPD、每月 token 都有免费额度，具体见 https://ai.google.dev/pricing
- 多个 API key = 多份免费额度（**反代的多 key 负载均衡正好放大这个收益**）
- 一旦超出，按 token 计费（flash-lite 是 Gemini 系列里最便宜的）

**估算 Merism 单次访谈的 Gemini token 消耗**：
- 30 分钟视频 × `fps=1`（默认抽帧，视频带 timestamp 编码）≈ 几十万 token
- 一份访谈分段 30 段 × 单段 6-8K token，约 200-300K token
- 用 flash-lite，单次访谈 < $0.05（粗估，请以实际账单为准）

### 11.3 监控建议

启用 **Cloudflare AI Gateway**（在 Dashboard 创建一个 gateway，把 `GEMINI_API_BASE_URL` 改成 gateway URL）后免费拿到：

- 请求数量、token 数、延迟分布、错误率
- 按 model / 时间段聚合的统计
- 可选的 prompt/response 日志（**注意：开了日志 = 请求体被 Cloudflare 记录**——研究产品视情况权衡）

如果不开 AI Gateway，**至少**在 Worker 部署后定期看一下 Cloudflare Workers 的内置 Analytics（请求数、错误率），出错率 > 1% 就排查。

---

## 12. 常见坑 / 排错

### 12.1 部署后调用返 401

| 可能原因 | 排查 |
|---|---|
| `GEMINI_API_KEY` 未注入或拼错 | `wrangler secret list` 看是否存在；重新 `wrangler secret put` 一次 |
| AI Studio key 失效（被 Google 风控） | 在 https://aistudio.google.com 重新生成；多个 key 的好处此时凸显 |
| 启用了 `CLIENT_KEY_VALIDATION_SECRET` 但调用方仍传裸 key | 客户端必须签 JWT；见 §10 |
| JWT 已过期 / nbf 未到 / 签名错误 | 检查 token 的 exp / nbf；确认两边的 secret 完全一致（注意空格、换行） |

### 12.2 Files API 上传 400 / 415

```
Invalid X-Goog-Upload-Protocol
```

- 检查反代有没有原样透传 `X-Goog-Upload-*` 系列头
- 用 §8.2 的 curl 直接测端到端
- 如果是自己改了 Worker 代码，确认没有删 / 重写 headers

### 12.3 视频上传后 state 永远 PROCESSING

- Google 的处理时间和视频大小成正比；30 分钟 1080p MP4 通常 30-90 秒
- 我们的 `uploadVideoToGemini` 默认超时 300 秒
- 超时但没出错 = 视频可能太大 / 编码不被支持
- 支持的格式：MP4、MPEG、MOV、WEBM、AVI、FLV、WMV、3GPP；推荐统一转 H.264 + MP4

### 12.4 `start_offset` 切片返回的内容**像是整段视频**

- 检查 `videoMetadata.startOffset` 字段名是否拼对（驼峰：`startOffset`，不是 `start_offset`）
- 检查 `endOffset > startOffset`
- 检查段长度 ≥ 1 秒；过短 Gemini 可能把整段当 fallback

### 12.5 Cloudflare Worker 报 `Worker exceeded CPU limit`

- 反代正常情况不会撞 CPU 限制
- 如果撞到 = 你在 Worker 里写了同步循环 / 大对象 JSON parse；改成 streaming
- 实在跨不过去，升级到 $5/月 Workers paid 套餐（CPU 上限 30s）

### 12.6 `Subrequest exceeded`

- 单次 Worker 调用对外发起 > 50 个子请求才会撞上
- 反代正常 1 进 1 出，撞不到
- 如果你扩展 Worker 加了重试 / 多 upstream 轮询，注意控制次数

### 12.7 突然全 503 / 429

- Cloudflare 在异常流量时会限流；先看 Workers Analytics 上的 429/503 比例
- AI Studio key 单 key 也有 RPM/RPD 上限，多 key 负载均衡是天然解药
- 反代本身的多 key 是**随机轮询 + 失败转移**——一个 key 挂掉自动用下一个

---

## 13. 维护规则

### 13.1 Worker 代码升级

定期同步上游：

```bash
# 在你的 fork 里
git remote add upstream https://github.com/JacobLinCool/gemini-reverse-proxy-worker.git
git fetch upstream
git merge upstream/main      # 或 rebase
git push origin main         # 触发 GitHub Actions 自动重部署（见 §7.3）
```

每次 sync 上游后：
- 跑一次 §8 的端到端 smoke test
- 检查 `wrangler.jsonc` 是否引入新的字段需要配

### 13.2 Key 轮换

```bash
# 启用了 KV 存储则在 dashboard /dash.html 直接改
# 没启用 KV 则：
wrangler secret put GEMINI_API_KEY      # 输入新值
# 上一版的 secret 立即被覆盖；Worker 在下一次冷启动时读到新值（通常几秒内）
```

**轮换节奏**：
- 怀疑泄漏：立即换
- 周期性：每季度一次
- 风控触发：换被风控的那个

### 13.3 Validation Secret 轮换

`CLIENT_KEY_VALIDATION_SECRET` 一旦换，**所有正在用的 JWT 立即作废**。所以：
- 先在 Merism 的 env 里准备好新 secret
- 让 Merism 用新 secret 签发 JWT
- 把新 secret 在 Worker 端 `wrangler secret put`
- 老 token 自然失效

### 13.4 监控 Google API 账单

- 在 https://console.cloud.google.com → Billing → Reports 设置预警
- 推荐设个**软阈值** $10/月——超过就邮件提醒
- 真的关心的话，单 key 也可以在 GCP 设 quota 上限

---

## 14. 速查手册（一页搞定）

```bash
# 一次性
git clone <你的 fork>
cd gemini-reverse-proxy-worker
pnpm install
npm i -g wrangler
wrangler login

# Secrets
wrangler secret put GEMINI_API_KEY                  # AI Studio key，多 key 用 ; 分隔
wrangler secret put CLIENT_KEY_VALIDATION_SECRET    # 用 openssl rand -base64 48 生成

# 部署
pnpm deploy
# → 拿到 https://merism-gemini-proxy.<你账号>.workers.dev

# 验证 Files API
export WORKER_URL=https://merism-gemini-proxy.<...>.workers.dev
export DIRECT_KEY=AIzaSy...
curl -i -X POST "$WORKER_URL/upload/v1beta/files" \
  -H "x-goog-api-key: $DIRECT_KEY" \
  -H "X-Goog-Upload-Protocol: resumable" \
  -H "X-Goog-Upload-Command: start" \
  -H "X-Goog-Upload-Header-Content-Length: 1024" \
  -H "X-Goog-Upload-Header-Content-Type: video/mp4" \
  -H "Content-Type: application/json" \
  -d '{ "file": { "display_name": "smoke" } }'
# → 头里应有 X-Goog-Upload-URL

# Merism 接入（最小代码）
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,        // JWT 或裸 key
  httpOptions: { baseUrl: process.env.GEMINI_API_BASE_URL },
});
```

---

## 15. 参考资料

- 反代 repo: https://github.com/JacobLinCool/gemini-reverse-proxy-worker
- Google Gemini API（File 上传）: https://ai.google.dev/gemini-api/docs/files
- Google Gemini API（视频理解 + video_metadata）: https://ai.google.dev/gemini-api/docs/video-understanding
- `@google/genai` SDK: https://www.npmjs.com/package/@google/genai
- Cloudflare Worker 限制: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare AI Gateway: https://developers.cloudflare.com/ai-gateway/
- PostHog 视频分析参考实现: `/home/jia/posthog/posthog/temporal/session_replay/session_summary/activities/video_based/`

---

> 文档作者：Caravaggio（视觉传达 + 演示专家临时跨界做工程笔记）
> 创建：2026-06-08
> 维护：每次 Worker 重大升级 / key 轮换策略变更后更新
