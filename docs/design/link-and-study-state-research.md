# Link 机制与 Study 生命周期调研报告

> 调研日期：2026-06-08  
> 调研方式：本地 `git clone --depth=1` 克隆源码后直接阅读  
> 调研对象：Formbricks v5.x、Rallly v4.8、PostHog surveys 模块、LimeSurvey master

---

## 目录

1. [Formbricks](#1-formbricks)
2. [Rallly](#2-rallly)
3. [PostHog](#3-posthog-surveys-模块)
4. [LimeSurvey](#4-limesurvey)
5. [综合结论：链接机制最佳实践](#5-综合结论链接机制最佳实践)
6. [综合结论：Study 状态机建议](#6-综合结论study-状态机建议)
7. [MerismV2 落地建议](#7-merismv2-落地建议)

---

## 1. Formbricks

### 仓库：`/tmp/formbricks`（tag: v5.x，截至 2026-06-05）

---

### A. 受访者链接机制

#### 链接结构

Formbricks 的链接调查 URL 形如：
```
https://app.formbricks.com/s/<surveyId>?suId=<singleUseId>&suToken=<hmacSignature>
```

- `surveyId`：cuid2 格式的调查 ID，路由直接暴露
- `suId`：可选的单次使用 ID，有两种安全模式

#### singleUse 机制

来源文件：`apps/web/lib/utils/single-use-surveys.ts`

```typescript
// 生成单次使用 ID（两种模式）
export const generateSurveySingleUseId = (isEncrypted: boolean): string => {
  const cuid = createId(); // cuid2
  if (!isEncrypted) return cuid;
  // 加密模式：用 AES 对称加密 cuid
  const encryptedCuid = symmetricEncrypt(cuid, env.ENCRYPTION_KEY);
  return encryptedCuid;
};

// 非加密模式：用 HMAC-SHA256 签名防篡改
export const generateSurveySingleUseSignature = (surveyId: string, singleUseId: string): string => {
  const payload = `formbricks.single-use.v1:${surveyId}:${singleUseId}`;
  return createHmac("sha256", getSingleUseSigningKey()).update(payload).digest("hex");
};

// 校验（timing-safe 防时序攻击）
export const validateSurveySingleUseSignature = (
  surveyId: string, singleUseId: string, signature?: string | null
): boolean => {
  if (!signature) return false;
  const expectedSignature = generateSurveySingleUseSignature(surveyId, singleUseId);
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
};
```

**两种 singleUse 模式对比：**

| 模式 | URL 参数 | 安全机制 | 适用场景 |
|------|----------|----------|----------|
| `isEncrypted=true` | `?suId=<AES加密cuid>` | 只有服务端能解密验证 | 高安全需求，防枚举 |
| `isEncrypted=false` | `?suId=<cuid>&suToken=<HMAC>` | HMAC 防伪造，cuid 可读 | 可以预生成大量链接 |

#### 受访者落地页完整流程

来源文件：`apps/web/modules/survey/link/page.tsx`（入口） + `apps/web/modules/survey/link/components/survey-renderer.tsx`

```typescript
// 1. 解析并验证 suId（纯计算，无 I/O）
if (isSingleUseSurvey) {
  const validatedSingleUseId = checkAndValidateSingleUseId(suId, isSingleUseSurveyEncrypted, survey.id, suToken);
  if (!validatedSingleUseId) {
    return <SurveyInactive status="link invalid" workspace={...} />;
  }
  singleUseId = validatedSingleUseId;
}

// 2. 并行加载剩余数据（workspace context、locale、已存在的 response）
const [workspaceContext, locale, singleUseResponse] = await Promise.all([
  getWorkspaceContextForLinkSurvey(survey.workspaceId),
  findMatchingLocale(),
  isSingleUseSurvey && singleUseId
    ? getResponseBySingleUseId(survey.id, singleUseId)()
    : Promise.resolve(undefined),
]);

// 3. 在 survey-renderer 中判断是否阻止渲染
if (survey.status === "draft" || survey.type !== "link") {
  notFound();  // 不泄露信息，直接 404
}
if (survey.status !== "inProgress") {
  return <SurveyInactive status={survey.status} ... />;  // paused / completed
}
// 断点续答：singleUse 下已完成则直接展示完成页
if (singleUseResponse?.finished) {
  return <SurveyCompletedMessage ... />;
}
```

**关键设计点：**
- `draft` 状态的调查对受访者 404（不是 403），不泄露调查存在
- `paused` + `publishOn != null` 展示"将在 X 时间开放"提示（`isScheduled`）
- 响应以 `(surveyId, singleUseId)` 为唯一约束，数据库层防止重复提交

#### 进度恢复（断点续答）

来源：`apps/web/modules/survey/link/lib/data.ts` 中 `getResponseBySingleUseId`

Formbricks 对 link 类型调查不做传统意义上的"进度保存"——单次使用 ID 绑定一个 Response 记录，Response 有 `finished: Boolean` 字段。已完成的会展示完成页，未完成的可以继续（实际是让用户重新从头填，因为中途数据已存在 response 中）。

#### Response 提交时的 singleUse 校验

来源：`apps/web/app/api/v2/client/[workspaceId]/responses/lib/utils.ts`

```typescript
// checkSurveyValidity() 强制校验
if (survey.type === "link" && survey.singleUse?.enabled) {
  // 1. 必须提供 singleUseId
  if (!responseInput.singleUseId) return badRequest("Missing single use id");
  
  // 2. 必须提供 meta.url（用来从 URL 解析 suId）
  const url = new URL(responseInput.meta.url);
  const suId = url.searchParams.get("suId");
  
  // 3. 重新校验 suId 签名
  canonicalSingleUseId = validateSurveySingleUseLinkParams({ surveyId, suId, suToken, isEncrypted, decrypt });
  
  // 4. 提交的 singleUseId 必须与 URL 中的 suId 一致
  if (!canonicalSingleUseId || canonicalSingleUseId !== responseInput.singleUseId) {
    return badRequest("Invalid single use id");
  }
}
```

---

### B. Survey 状态机（研究者侧）

#### 状态枚举

来源：`packages/database/schema.prisma`

```prisma
enum SurveyStatus {
  draft       // 草稿，受访者 404
  inProgress  // 进行中，接受提交
  paused      // 暂停，不接受提交（可带 publishOn 自动恢复）
  completed   // 已完成，不接受提交
}
```

（注：API 文档还提及 `scheduled`，这是 `paused + publishOn != null` 的前端展示状态，数据库层不存储独立枚举值。v5.x 已移除 `scheduled` 作为独立枚举。）

#### Survey 模型关键字段

来源：`packages/database/schema.prisma` model Survey

```prisma
model Survey {
  status              SurveyStatus  @default(draft)
  publishOn           DateTime?     // 自动发布时间（paused → inProgress）
  closeOn             DateTime?     // 自动关闭时间（inProgress → completed）
  autoComplete        Int?          // 收到 N 个响应后自动 completed
  autoClose           Int?          // 超时自动关闭（分钟）
  singleUse           Json?         // { enabled, isEncrypted }
  // 状态变更的 DB 索引
  @@index([status, publishOn])
  @@index([status, closeOn])
}
```

#### 定时状态迁移（关键）

来源：`apps/web/modules/survey/scheduling/lib/survey-scheduling.ts`

```typescript
// 迁移配置：两个方向
const getTransitionConfig = (transition: "publish" | "close") => {
  if (transition === "publish") {
    return {
      currentStatus: "paused",   // 从 paused
      nextStatus: "inProgress",  // 到 inProgress
      dueField: "publishOn",
      clearField: "publishOn",   // 迁移后清除调度字段
    };
  }
  return {
    currentStatus: "inProgress", // 从 inProgress
    nextStatus: "completed",     // 到 completed
    dueField: "closeOn",
    clearField: "closeOn",
  };
};

// 实际迁移：用 updateMany + where 条件保证幂等性
const result = await prisma.survey.updateMany({
  data: { [clearField]: null, status: nextStatus },
  where: {
    id: candidate.id,
    status: currentStatus,          // 防止并发重复执行
    [dueField]: { lte: now, not: null },
  },
});
```

**手动状态变更的 normalization 规则：**

```typescript
export const normalizeSurveyScheduling = ({ currentStatus, closeOn, publishOn, status }) => {
  const isManualStatusChange = currentStatus !== status;

  // 手动改为 inProgress 时，清除 publishOn（不需要自动发布了）
  if (isManualStatusChange && status === "inProgress") normalizedPublishOn = null;

  // 手动改为 paused 且没有 publishOn，则清除 closeOn（防止孤立的关闭调度）
  if (isManualStatusChange && status === "paused" && normalizedPublishOn === null) normalizedCloseOn = null;

  // 手动改为 completed，清除所有调度字段
  if (isManualStatusChange && status === "completed") {
    normalizedCloseOn = null; normalizedPublishOn = null;
  }

  // 验证：closeOn 必须晚于 publishOn
  if (normalizedPublishOn !== null && normalizedCloseOn !== null &&
      normalizedCloseOn.getTime() <= normalizedPublishOn.getTime()) {
    throw new ValidationError("Close date must be after publish date");
  }
};
```

**状态迁移图：**

```
draft ──publish──→ inProgress ──close/autoComplete──→ completed
  ↑                    │                                   │
  │                  pause                               (终态)
  │                    ↓
  │               paused ←──(publishOn到期自动)──→ inProgress
  └──────────────────── (管理员手动回到 draft 不支持)
```

### Formbricks 核心发现

1. **singleUse ID 有两个安全层**：数据库 `@@unique([surveyId, singleUseId])` 防重复提交，应用层 HMAC/加密防伪造。
2. **状态机靠 `publishOn`/`closeOn` 字段 + 定时 reconciliation 实现自动迁移**，不是靠枚举状态直接驱动时间。
3. **`draft` 状态 404 而非展示错误页**，避免信息泄露。
4. **并发安全**：`updateMany + where: { status: currentStatus }` 保证定时迁移的幂等性。

---

## 2. Rallly

### 仓库：`/tmp/rallly`（v4.8.1，2026-04-02）

---

### A. 受访者链接机制

#### 链接结构

来源：`packages/database/prisma/models/poll.prisma`

```prisma
model Poll {
  id                      String     @id @unique
  participantUrlId        String     @unique @map("participant_url_id")
  adminUrlId              String     @unique @map("admin_url_id")
  status                  PollStatus @default(open)
  guestId                 String?    // @deprecated
  userId                  String?
  // ...
}
```

Rallly 使用双链接模式：
- **`/invite/<participantUrlId>`**：受访者（参与者）链接，公开分享，人人可用
- **`/poll/<id>`**：管理员链接（`adminUrlId` 用于验证身份），只有创建者可管理

链接 ID 由 `nanoid()` 生成（`packages/utils/src/nanoid.ts`），两个 ID 独立随机，互不可推导：

```typescript
// apps/web/src/trpc/routers/polls.ts: make mutation
const pollId = nanoid();  // public ID = participant link
// adminUrlId 也是 nanoid，在 DB 层生成
```

**关键设计：pollId 本身即 participantUrlId**（v4 架构简化，旧版有独立 `adminUrlId`，现在管理权限通过 `userId` + tRPC 中间件校验）。

#### 参与者 session 机制

参与者无需登录，直接通过 `/invite/<pollId>` 访问。Rallly 没有显式的参与者 session 令牌——参与者标识存储在 Participant 记录里，通过 `guestId`（已废弃）或 `userId`（Better-Auth 登录用户）关联。

匿名参与时，系统直接创建 Participant 记录（name + email 可选填），无需 token 验证。

#### 权限校验（管理操作）

来源：`apps/web/src/features/poll/query.ts`（通过 `hasPollAdminAccess`）

```typescript
// 所有 book/close/modify 等管理操作都先校验
const hasAccess = await hasPollAdminAccess(input.pollId, ctx.user.id);
if (!hasAccess) {
  throw new TRPCError({ code: "FORBIDDEN", message: "..." });
}
```

---

### B. Poll 状态机

#### 状态枚举

来源：`packages/database/prisma/models/poll.prisma`

```prisma
enum PollStatus {
  open        // 开放接受参与者投票
  closed      // 手动关闭，不再接受新投票
  scheduled   // 已确定日期（book 操作后）
  canceled    // 取消（预留，当前 UI 未完全暴露）
}
```

#### 状态迁移（tRPC mutations）

来源：`apps/web/src/trpc/routers/polls.ts`

**`book`（确定日期 → scheduled）：**

```typescript
// 事务内：创建 scheduledEvent + 更新 poll 状态
const scheduledEvent = await prisma.$transaction(async (tx) => {
  const event = await tx.scheduledEvent.create({ data: { ... } });
  await tx.poll.update({
    where: { id: poll.id },
    data: { status: "scheduled", scheduledEventId: event.id },
  });
  return event;
});
// 状态变更后发邮件通知所有参与者
```

**`close`（关闭 → closed）：**

```typescript
await prisma.poll.update({
  where: { id: input.pollId },
  data: { status: "closed" },
});
// 无副作用，只改状态
```

**reopen（→ open，撤销 book）：**

```typescript
await prisma.$transaction(async () => {
  const poll = await prisma.poll.update({
    where: { id: input.pollId },
    data: { status: "open" },  // 回到 open
  });
  if (poll.scheduledEventId) {
    await prisma.scheduledEvent.delete({ where: { id: poll.scheduledEventId } });
  }
});
```

**状态迁移图：**

```
open ──book──→ scheduled
  │                │
close          reopen (pro功能)
  ↓                │
closed ←───────────┘
  
(canceled 为预留状态，当前 UI 未完全暴露)
```

#### 链接无状态，状态在 Poll 上

Rallly 的设计哲学：链接 ID 是永久不变的，受访者总能通过 `/invite/<id>` 访问 poll 页面，只是页面内容会根据 `poll.status` 展示不同内容（投票中 / 已确定日期 / 已关闭）。

### Rallly 核心发现

1. **双链接模式（participant/admin）天然隔离管理权限**，无需 token 签名，靠数据库 userId 关联。
2. **`book` 操作是事务性的**：同时创建 scheduledEvent + 更新 poll 状态，保证一致性。
3. **状态变更附带业务副作用**（发邮件通知），副作用与状态变更同在一个 tRPC mutation 内，通过 `after(async () => ...)` 延迟执行（Next.js `after` API）。
4. **参与者无 session token**，身份由 Participant 记录持有，适合轻量公开调研。

---

## 3. PostHog surveys 模块

### 仓库：`/tmp/posthog`（sparse checkout，products/surveys，2026-06）

---

### A. 受访者链接机制

PostHog surveys 主要是 in-app/widget 类型，不依赖独立的受访者链接 token。External survey 类型才有公开 URL，但这类 survey 没有单次使用限制——通过 feature flags targeting 控制谁看到。

对 MerismV2 参考价值较低，略。

---

### B. Survey 状态机（研究者侧）

PostHog surveys 的状态不是枚举字段，而是**从时间戳字段派生**：

#### 状态模型

来源：`products/surveys/backend/models.py`

```python
class Survey(FileSystemSyncMixin, RootTeamMixin, UUIDTModel):
    start_date = models.DateTimeField(null=True)   # 为 null → draft
    end_date = models.DateTimeField(null=True)      # 为 null（且有 start_date）→ running
    archived = models.BooleanField(default=False)  # 独立 archived 标志
    responses_limit = models.PositiveIntegerField(null=True)  # 响应数上限
```

状态派生逻辑（来源：`frontend/src/scenes/surveys/surveysLogic.tsx`）：

```typescript
export function getSurveyStatus(survey): ProgressStatus {
  if (!survey.start_date) return ProgressStatus.Draft;
  if (!survey.end_date)   return ProgressStatus.Running;
  return ProgressStatus.Complete;
}
// archived 是独立标志，complete 的 survey 才能 archive
```

#### launch / stop 专属 Actions

来源：`products/surveys/backend/api/survey.py`

```python
@action(methods=["POST"], detail=True, required_scopes=["survey:write"])
def launch(self, request, **kwargs):
    survey = self.get_object()
    if survey.archived:
        raise ValidationError("Cannot launch an archived survey. Unarchive it first.")
    if survey.end_date and survey.end_date <= now:
        raise ValidationError("Cannot launch a survey with end_date in the past.")
    if survey.start_date and survey.start_date <= now:
        return Response(...)  # 已 launched，no-op，直接返回

    survey.start_date = datetime.now(UTC)
    survey.save(update_fields=["start_date"])
    log_activity(...)  # 审计日志
    return Response(...)

@action(methods=["POST"], detail=True, required_scopes=["survey:write"])
def stop(self, request, **kwargs):
    survey = self.get_object()
    if survey.end_date and survey.end_date <= now:
        return Response(...)  # 已 stopped，no-op
    survey.end_date = datetime.now(UTC)
    survey.save(update_fields=["end_date"])
    log_activity(...)
    return Response(...)
```

#### 状态变更的副作用（Feature Flag 同步）

```python
def _should_survey_flags_be_active(self, instance):
    return bool(instance.start_date) and not instance.end_date and not instance.archived

# 每次状态更新后同步 targeting_flag 的 active 状态
should_flag_be_active = self._should_survey_flags_be_active(instance)
if instance.targeting_flag:
    instance.targeting_flag.active = should_flag_be_active
    instance.targeting_flag.save()
```

#### 可恢复（Resume）机制

```python
# 在 perform_update() 的 reporting 里
elif before_update.start_date is not None and before_update.end_date is not None and instance.end_date is None:
    report_user_action(user, "survey resumed", ...)
# stopped 的 survey 通过清除 end_date 可以 resume
```

**状态迁移图：**

```
null start_date → Draft
        │
      launch (set start_date)
        ↓
    Running (start_date set, end_date null)
        │                    ↑
      stop              resume (clear end_date)
        ↓                    │
    Complete (end_date set) ─┘
        │
      archive (set archived=true)
        ↓
    Archived (terminal)
```

### PostHog 核心发现

1. **状态从时间戳派生而非枚举**，天然支持"时间轴感知"（历史记录可重建），但查询时需要复合条件。
2. **`archived` 是独立 boolean**，不是状态枚举的一个值，这样 archived survey 不会出现在 running/draft 的过滤里。
3. **launch/stop 是专属 action endpoints**，不是 PATCH status 字段，保证业务操作语义清晰、有 no-op 保护。
4. **状态变更同步 feature flag active 状态**是典型的"有状态副作用"场景，对 MerismV2 有参考价值（survey 关闭时应停止新 session 签发）。

---

## 4. LimeSurvey

### 仓库：`/tmp/limesurvey`（master，2026-06-08）

---

### A. 受访者 Token 机制（最完整的学术问卷 token 系统）

#### Token 数据结构

来源：`application/models/Token.php`（抽象类，每个调查独立表 `{{tokens_<sid}}}`）

```php
// tokens 表字段
'token'      => "string(36)",       // 实际 token 字符串（随机字符）
'completed'  => "string(17) DEFAULT 'N'", // N=未完成; Q=配额满; YYYY-MM-DD HH:mm=完成时间戳
'usesleft'   => 'integer DEFAULT 1',  // 剩余使用次数，默认 1（单次使用）
'validfrom'  => 'datetime',            // 有效期开始
'validuntil' => 'datetime',            // 有效期结束
'participant_id' => 'string(50)',      // 可关联 CPD 参与者数据库
```

**可用性 scope（usable）：**

```php
'usable' => array(
    'condition' => "COALESCE(validuntil, '$now') >= '$now' 
                    AND COALESCE(validfrom, '$now') <= '$now' 
                    AND usesleft > 0"
)
```

即：日期在有效期内 **且** 剩余使用次数 > 0 才可用。

#### Token 生成

```php
public function generateToken($iTokenLength = null) {
    // 使用 Yii securityManager 生成密码学安全随机字符串
    $this->token = $this->generateRandomToken($iTokenLength);
    $counter = 0;
    while (!$this->validate(array('token'))) {  // 数据库唯一性验证
        $this->token = $this->generateRandomToken($iTokenLength);
        if ($counter++ > 50) {
            throw new CHttpException(500, 'Failed to create unique access code in 50 attempts.');
        }
    }
}

private function generateRandomToken($iTokenLength) {
    $token = Yii::app()->securityManager->generateRandomString($iTokenLength);
    // 替换特殊字符（保持 URL 安全）
    $token = str_replace(array('~', '_'), array('a', 'z'), (string) $token);
    // 允许 plugin hook 修改 token
    App()->pluginManager->dispatchEvent(new PluginEvent('afterGenerateToken'));
    return $token;
}
```

默认长度 15 字符，最大 36 字符（UUID 长度），仅包含字母数字字符。

#### 完成时更新 token 状态

来源：提交 `6948669`（LimeSurvey 核心响应处理）

```php
$token->usesleft--;
if ($token->usesleft <= 0) {
    if (isTokenCompletedDatestamped($thissurvey)) {
        $token->completed = $today;  // 记录完成时间戳
    } else {
        $token->completed = 'Y';     // 简单标记完成
    }
}
$token->save();
```

---

### B. Survey 状态机

#### 状态结构

LimeSurvey 的 survey 状态不是枚举，而是两个独立字段的组合：

来源：`application/models/Survey.php`

```php
// DB 字段
'active'    => 'Y' / 'N'          // 是否已激活（管理员手动切换）
'startdate' => datetime or null   // 开始日期（Y + 未来日期 → 定时开始）
'expires'   => datetime or null   // 过期日期（Y + 过去日期 → 已过期）
```

#### `getState()` 方法（5 种状态）

```php
public function getState() {
    if ($this->active == 'N') return 'inactive';
    
    if (!empty($this->expires) || !empty($this->startdate)) {
        $oNow   = self::shiftedDateTime("now");
        $oStop  = self::shiftedDateTime($this->expires);
        $oStart = self::shiftedDateTime($this->startdate);
        
        $bExpired  = (!is_null($oStop) && $oStop < $oNow);
        $bWillRun  = (!is_null($oStart) && $oStart > $oNow);
        
        if ($bExpired)  return 'expired';    // 已过期
        if ($bWillRun)  return 'willRun';    // 将来开始
        if (!is_null($oStop)) return 'willExpire'; // 正在进行（有截止日）
    }
    return 'running';  // 正在进行（无截止日）
}
```

**5 种逻辑状态：**

| getState() | active | startdate | expires | 含义 |
|------------|--------|-----------|---------|------|
| `inactive` | N | any | any | 未激活/已停用 |
| `willRun` | Y | 未来 | any | 尚未开始 |
| `running` | Y | null/过去 | null | 正在进行（无截止） |
| `willExpire` | Y | null/过去 | 未来 | 正在进行（有截止） |
| `expired` | Y | any | 过去 | 已过期 |

#### 激活与停用（控制器层）

来源：`application/controllers/SurveyAdministrationController.php`

- **激活（actionActivate）**：调用 `SurveyActivate::activate($surveyId)` 服务，设置 `active = 'Y'`，可选择开放访问模式（O=开放/C=受控）
- **停用（actionDeactivate）**：调用 `SurveyDeactivate::deactivate()`，将响应表重命名为 `old_responses_<sid>_<timestamp>`（归档数据），设置 `active = 'N'`

**停用副作用**：历史响应表归档（rename），不删除数据。

### LimeSurvey 核心发现

1. **Token 表是 per-survey 的独立表**（`tokens_<surveyId>`），适合百万级参与者的大型调研，但增加了 schema 管理复杂度。
2. **`usesleft` 字段支持 > 1 的使用次数**（同一 token 可填写多次），比简单的单次使用更灵活。
3. **`completed` 字段携带完成时间戳**（不只是 boolean），提供完整的参与时间线。
4. **Survey 停用（deactivate）会归档响应数据**，这是学术问卷的刚需——关闭调查不能销毁已收集的数据。

---

## 5. 综合结论：链接机制最佳实践

### 5.1 Token 类型选择

| 项目 | Token 类型 | 防重复机制 | 有效期控制 |
|------|-----------|-----------|-----------|
| Formbricks | cuid2 + HMAC/AES | DB unique constraint | 无内置（通过 survey status） |
| Rallly | nanoid（URL segment） | userId 关联 | 无（poll 状态控制） |
| LimeSurvey | 随机字母数字串（15-36位） | `usesleft > 0` | `validfrom` / `validuntil` |
| MerismV2 目前 | UUID token | `usedCount >= maxUses` | `expiresAt` datetime |

**最佳实践共识：**
1. 使用密码学安全随机生成（`crypto.randomBytes` / cuid2 / nanoid），不可从 ID 推导
2. 数据库层有唯一约束作为最后防线（Formbricks `@@unique([surveyId, singleUseId])`）
3. 有效期和使用次数限制分开控制（LimeSurvey `validfrom/validuntil` + `usesleft`）
4. token 验证是幂等的（Formbricks 的 HMAC 验证不依赖 DB 查询）

### 5.2 受访者落地页流程标准模式

```
受访者 GET /s/<surveyId>?suId=<id>&suToken=<sig>
         │
         ▼
    ① 验证 surveyId 格式（无效→404）
         │
         ▼
    ② 加载 Survey（不存在→404，不泄露）
         │
         ▼
    ③ 验证 suId（无效→SurveyInactive "link invalid"）
         │
         ▼（并行）
    ④ 加载 workspaceCtx ║ 加载已有 response（断点续答）
         │
         ▼
    ⑤ 检查 survey.status
       draft → 404
       paused → "Survey is scheduled/paused" 页
       completed → "Survey is closed" 页
         │
         ▼
    ⑥ 检查 singleUse response 是否已完成
       finished → "You've already completed" 页
         │
         ▼
    ⑦ 渲染可交互调查
```

### 5.3 session 创建与进度恢复

- **Formbricks**：无显式 session；Response 记录同时是"session"和"回答"，`finished=false` 代表进行中
- **Rallly**：无 session；Participant 记录即参与态
- **LimeSurvey**：PHP session 存储临时回答，token 记录最终状态

**对 MerismV2 的参考**：MerismV2 的 `InterviewSession` 已有独立 session 记录，比上述项目更完整。`state: in_progress` = Formbricks 的 `finished=false`。

---

## 6. 综合结论：Study 状态机建议

### 6.1 各项目状态对比

| 项目 | 状态枚举 | 定时迁移 | 副作用处理 |
|------|--------|---------|----------|
| Formbricks | draft/inProgress/paused/completed | publishOn+closeOn字段+cron | 审计日志 |
| Rallly | open/closed/scheduled/canceled | 无（手动） | 发邮件通知 |
| PostHog | 派生自时间戳 | 无（需手动） | feature flag同步 |
| LimeSurvey | inactive/running/willRun/willExpire/expired | 无（基于实时计算） | 响应表归档 |

### 6.2 推荐的 Study 状态枚举

综合以上调研，为 MerismV2 推荐以下状态机：

```
draft
  │ publish（研究者手动）
  ▼
active              ← 接受新链接签发、接受新 session
  │         │
  │ pause   │ close（研究者手动 / 自动到达 closeAt）
  ▼         ▼
paused    closed              ← 不接受新 session（进行中的 session 继续）
  │                                │
  │ resume                         │ archive（研究者手动，数据只读）
  ▼                                ▼
active                          archived              ← 终态，只读
```

**状态字段扩展（基于 Formbricks 的 publishOn/closeOn 模式）：**

```typescript
// 推荐在 SurveySchema 增加：
publishAt: z.string().datetime().optional(),  // 自动激活时间
closeAt: z.string().datetime().optional(),    // 自动关闭时间
```

### 6.3 副作用处理原则（来自 PostHog + LimeSurvey）

| 触发事件 | 副作用 |
|---------|--------|
| `draft → active` | 允许链接签发（`issueLivekitToken` 开始响应） |
| `active → paused` | **不中断**进行中的 session，**阻止**新链接签发 |
| `active/paused → closed` | **不中断**进行中的 session，阻止新链接签发，触发 survey-level 分析任务 |
| `closed → archived` | 数据只读，禁止所有写操作 |
| `any → draft`（降级） | 禁止（不支持）——已有 session/响应不可逆 |

**关键原则**：状态变更不得中断已进行中的 session（Formbricks: "Stop accepting responses" ≠ "Kill active responses"）。

---

## 7. MerismV2 落地建议

### 7.1 当前 gap 分析

**当前 `SurveyStatus`（`packages/contracts/src/entities.ts`）：**

```typescript
export const SurveyStatus = z.enum(["draft", "published", "archived"]);
```

**问题：**
- `published` 语义不清晰（是"进行中"还是"公开但不接受"？）
- 缺少 `paused`（暂停接受新 session，但不关闭）
- 缺少 `closed`（已结束，与 `archived` 混用）
- `archived` 不应是普通状态，应是终态

---

### 7.2 contracts 层修改建议

**`packages/contracts/src/entities.ts`**

```typescript
// 当前
export const SurveyStatus = z.enum(["draft", "published", "archived"]);

// 建议改为
export const SurveyStatus = z.enum([
  "draft",     // 草稿，不可访问，不签发 token
  "active",    // 进行中，接受新 session
  "paused",    // 暂停，不接受新 session，进行中 session 继续
  "closed",    // 已结束，不接受新 session，数据可读
  "archived",  // 已归档，只读，不再显示在 dashboard 主列表
]);

export const SurveyStatusTransition = z.enum([
  "publish",   // draft → active
  "pause",     // active → paused
  "resume",    // paused → active
  "close",     // active/paused → closed
  "archive",   // closed → archived
  "reopen",    // closed → active（管理员特权操作）
]);
```

**`InterviewLinkSchema` 补充字段（参考 LimeSurvey token）：**

```typescript
export const InterviewLinkSchema = z.object({
  $id: z.string(),
  surveyId: z.string(),
  token: z.string(),
  mode: LinkMode,
  maxUses: z.number().int().positive(),
  usedCount: z.number().int().nonnegative().default(0),
  expiresAt: z.string().datetime(),
  // 新增
  label: z.string().optional(),          // 链接说明（如"第一批受访者"）
  isRevoked: z.boolean().default(false), // 手动撤销（不等于过期，区分原因）
});
```

**`SurveySchema` 补充字段（参考 Formbricks）：**

```typescript
export const SurveySchema = z.object({
  $id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: SurveyStatus.default("draft"),
  flowConfig: json.default({}),
  version: z.number().int().nonnegative().default(1),
  updatedAt: z.string().datetime(),
  // 新增
  publishAt: z.string().datetime().optional(),  // 自动发布（定时 draft→active）
  closeAt: z.string().datetime().optional(),    // 自动关闭（定时 active→closed）
  targetResponses: z.number().int().positive().optional(), // 达到目标响应数自动关闭
});
```

---

### 7.3 `issueLivekitToken` Function 的 Survey Status 校验

当前 `handler.ts` 中已有链接有效期和使用次数校验，需要增加 survey status 校验：

```typescript
// apps/functions/issueLivekitToken/src/handler.ts
// 在 findLink 之后、session 创建之前增加：

// 检查 survey 状态是否允许新 session
const survey = await deps.getSurveyStatus(link.surveyId);
if (survey.status !== "active") {
  return { status: 410, body: { error: "survey_not_active" } };
}
```

**对应 `IssueDeps` 接口增加：**

```typescript
getSurveyStatus(surveyId: string): Promise<{ status: string }>;
```

---

### 7.4 研究者 Dashboard 状态操作 UI 模式

参考 Formbricks 状态 dropdown + PostHog 专属 action button 的混合模式：

**推荐 UI 模式（`/studies/[id]` 页面顶部状态栏）：**

```
状态标签 [active ▾]    主操作按钮          次要操作
                       [Pause study]      [⋯ Close / Archive]
```

**各状态对应的 UI 操作：**

| 当前状态 | 主操作按钮 | 危险操作（需确认） |
|---------|----------|----------------|
| `draft` | `Publish →` | — |
| `active` | `Pause` | `Close study` |
| `paused` | `Resume` | `Close study` |
| `closed` | — | `Archive` |
| `archived` | — | — |

**状态 badge 颜色（遵循 Mauve Quiet 单色规范——不用颜色传递状态，用图标+文字）：**

```typescript
const statusConfig = {
  draft:    { icon: "pencil-line",    label: "Draft" },
  active:   { icon: "radio-button",   label: "Active" },
  paused:   { icon: "pause-circle",   label: "Paused" },
  closed:   { icon: "check-circle",   label: "Closed" },
  archived: { icon: "archive",        label: "Archived" },
};
```

**关闭时的副作用提示对话框（参考 Formbricks/LimeSurvey 的明确告知模式）：**

```
Close this study?

Closing will:
• Stop new interview sessions from starting
• Keep X ongoing sessions running until they finish
• Allow you to view all collected transcripts and reports

This cannot be undone (you can archive it later).

[Cancel]  [Close Study]
```

---

### 7.5 `issueLivekitToken` 与链接状态的完整校验矩阵

```
受访者 POST /issueLivekitToken { linkToken, alias }
                │
                ▼
        findLink(token)
                │ null → 404 link_not_found
                ▼
        link.expiresAt < now → 410 link_expired
                │
                ▼
        link.isRevoked → 410 link_revoked （新增）
                │
                ▼
        link.usedCount >= effectiveMax → 410 link_exhausted
                │
                ▼
        getSurveyStatus(link.surveyId)    （新增）
                │ status != "active" → 410 survey_not_active
                ▼
        createSession (concurrency-safe slot claim)
                │
                ▼
        createRoom + signToken
                │
                ▼
        200 { sessionId, token, livekitUrl, surveyMeta }
```

---

### 7.6 优先级建议

| 优先级 | 工作项 | 参考项目 |
|--------|--------|---------|
| P0 | 在 `entities.ts` 扩展 `SurveyStatus` 枚举（5 个值） | Formbricks |
| P0 | `issueLivekitToken` 增加 survey status 校验 | PostHog 的 flag active 同步 |
| P1 | 研究者 dashboard `/studies/[id]` 状态操作 UI | Formbricks + Rallly |
| P1 | `InterviewLinkSchema` 增加 `isRevoked` + `label` 字段 | LimeSurvey token |
| P2 | `SurveySchema` 增加 `closeAt`/`publishAt` 定时字段 | Formbricks scheduling |
| P2 | Appwrite Function 或 cron 实现定时状态迁移 | Formbricks reconciliation |

---

*报告基于直接阅读源码生成，所有代码引用均来自本地克隆的仓库文件。*
