# 登录（Auth）与用户（User）模块调研报告

> 调研日期：2026-06-08
> 调研方式：本地 `git clone`（或 sparse checkout）后直接阅读源码，逐项标注来源文件
> 调研对象：Formbricks v5.x（NextAuth v4）、Rallly v4.x（Better-Auth）、PostHog（Django + DRF）、LimeSurvey master（Yii1 插件式）
> 关注范围：**研究者 / 管理员账户的认证与用户模块**，不含匿名受访者链接（受访者机制见 `link-and-study-state-research.md`）

---

## 目录

1. [Formbricks（NextAuth v4 + 数据库 session）](#1-formbricksnextauth-v4--数据库-session)
2. [Rallly（Better-Auth + 邮箱 OTP）](#2-ralllybetter-auth--邮箱-otp)
3. [PostHog（Django session + DRF）](#3-posthogdjango-session--drf)
4. [LimeSurvey（Yii1 插件式认证）](#4-limesurveyyii1-插件式认证)
5. [综合结论：认证方式选择](#5-综合结论认证方式选择)
6. [综合结论：User 数据模型](#6-综合结论user-数据模型)
7. [综合结论：安全实践清单](#7-综合结论安全实践清单)
8. [MerismV2 落地建议（基于 Appwrite Account API）](#8-merismv2-落地建议基于-appwrite-account-api)

---

## 1. Formbricks（NextAuth v4 + 数据库 session）

**栈**：Next.js 16 + NextAuth.js v4 + Prisma adapter。与 MerismV2（Next.js App Router）栈最接近，参考价值最高。

### A. 框架与 Provider

来源：`apps/web/modules/auth/lib/authOptions.ts`

```typescript
export const authOptions: NextAuthOptions = {
  adapter: getNextAuthAdapter(prisma),
  providers: [
    CredentialsProvider({ id: "credentials", /* email/password/totp/backup */ }),
    CredentialsProvider({ id: "token", /* 邮箱验证 JWT */ }),
    ...(ENTERPRISE_LICENSE_KEY ? getSSOProviders() : []), // GitHub/Google/Azure/OIDC/SAML
  ],
  session: { strategy: "database", maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/auth/login", signOut: "/auth/logout", error: "/auth/login" },
};
```

关键点：
- **session 策略是 `database`**（不是 JWT），cookie 里存的是不透明的 `sessionToken`，对应 `Session` 表一行；可服务端吊销。
- **没有用 NextAuth 的 EmailProvider（magic link）**；邮箱验证是自研 JWT + 一个叫 `token` 的 credentials provider。
- SSO（GitHub/Google/Azure/OIDC/SAML）是企业版特性，社区版只有邮箱密码。

### B. User 数据模型

来源：`packages/database/schema.prisma`

```prisma
model User {
  id            String    @id @default(cuid())
  createdAt     DateTime  @default(now())
  name          String
  email         String    @unique
  emailVerified DateTime?
  password                  String?            // bcrypt hash（SSO 用户为 null）
  identityProvider          IdentityProvider   @default(email) // email/github/google/azuread/openid/saml
  twoFactorSecret           String?            // AES 加密
  twoFactorEnabled          Boolean            @default(false)
  backupCodes               String?            // AES 加密的 10 个一次性码
  notificationSettings      Json               @default("{}")
  locale                    String             @default("en-US")
  lastLoginAt               DateTime?
  isActive                  Boolean            @default(true) // 软停用
  // 关联：accounts(OAuth)、sessions、passwordResetToken、memberships
}
```

**角色不在 User 上**——组织角色（owner/manager/member/billing）在 `Membership` 表（多租户）。对 MerismV2 而言这是要砍掉的部分（单研究者、无团队）。

### C. 注册 / 登录 / 邮箱验证 / 找回密码

- **密码哈希**：bcrypt（`bcryptjs`），cost = 12（`apps/web/lib/auth.ts`）。
- **登录 authorize**（`authOptions.ts`）：常量时间比对（用户不存在时用 dummy hash 防枚举）、检查 `isActive`、检查 `emailVerified`、2FA。
- **邮箱验证**：自研 JWT（`apps/web/lib/jwt.ts` `createToken`，1 天过期）→ 邮件链接 `/auth/verify?token=<jwt>` → `signIn("token")` 校验后 `emailVerified = now`。
- **找回密码**（`modules/auth/forgot-password/lib/password-reset-service.ts`）：
  - `crypto.randomBytes(32).base64url` 生成原始 token，**只存 SHA 哈希**（`PasswordResetToken` 表，per-user upsert）。
  - 邮件发原始 token；**总是返回成功**（防邮箱枚举）。
  - 重置完成后**删除该用户所有 session**（`deleteSessionsByUserId`）。

### D. session 读取与路由保护

- 服务端读 session：`getServerSession(authOptions)`（RSC、server action 里）。
- server action 统一闸门：`authenticatedActionClient`（`lib/utils/action-client/index.ts`）——未登录抛 `AuthenticationError`。
- 边缘层粗粒度保护：Next.js 16 `proxy.ts`（旧 `middleware.ts`）直接查 DB session，未登录访问受保护前缀 → 重定向 `/auth/login?callbackUrl=...`。
- 细粒度授权下沉到页面级（`getWorkspaceAuth`）和 action client。

### E. 账户设置

来源：`app/(app)/workspaces/[workspaceId]/settings/account/`

| 区块 | 可编辑 |
|------|--------|
| Profile | name、email（改邮箱需密码 + 重新验证）、locale、触发改密、2FA、删除账户 |
| Notifications | per-survey 提醒开关 |

- **改邮箱**：要求当前密码，改后发验证邮件。
- **删除账户**：邮箱二次确认 + 密码/SSO 重新认证。
- **登出**：`use-sign-out.ts` → 先写审计日志 → `signOut()`（NextAuth 删 DB session + 清 cookie）。

### Formbricks 核心发现

1. **数据库 session（可吊销）** 优于无状态 JWT session——重置密码/停用账户能立刻让所有会话失效。
2. **防枚举三连**：登录用 dummy hash 常量时间比对、找回密码总返回成功、token 只存哈希。
3. **`isActive` 软停用**：不删用户，进 app 时检测到 `isActive=false` 强制登出。
4. **角色挂在 Membership 而非 User**——MerismV2 单用户应直接省掉这一层。

---

## 2. Rallly（Better-Auth + 邮箱 OTP）

**栈**：Next.js + Better-Auth 1.6（v4 已彻底移除 NextAuth）。代表"现代极简 Next.js auth"路线。

### A. 框架与认证方式

来源：`apps/web/src/lib/auth.ts`

```typescript
export const authLib = betterAuth({
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  plugins: [
    admin(),
    anonymous({ /* 访客 session */ }),
    emailOTP({ disableSignUp: true, expiresIn: 15 * 60 /* 15min */ }),
    // 可选：captcha、genericOAuth(OIDC)
  ],
  socialProviders: { google: {...}, microsoft: {...} },
  session: { expiresIn: 60d, updateAge: 1d, cookieCache: { maxAge: 5min } },
});
```

| 方式 | 说明 |
|------|------|
| **邮箱 OTP（6 位验证码）** | 主力无密码路径，**不是点击式 magic link**，发的是 6 位数字码 |
| 邮箱 + 密码 | 需邮箱验证；只有已设置 credential 账户的用户才显示密码框 |
| Google / Microsoft / 通用 OIDC | 按 env 开启 |
| 匿名访客 | `anonymous` 插件，DB 里 `isAnonymous=true` |

**精妙处：登录页先探测方式**（`trpc.auth.getLoginMethod`）：若该邮箱已有 verified 的 credential 账户 → 显示密码框；否则走 OTP。**同一个入口框，自适应。**

### B. User 数据模型

来源：`packages/database/prisma/models/user.prisma`

```prisma
model User {
  id              String    @id @default(cuid())
  name            String
  email           String    @unique @db.Citext  // 大小写不敏感
  emailVerified   Boolean?
  image           String?
  timeZone        String?
  locale          String?
  role            UserRole  @default(user)       // 仅 admin | user
  lastLoginMethod String?
  isAnonymous     Boolean   @default(false)      // 访客标志
  banned          Boolean   @default(false)
  // accounts、sessions、Verification
}
```

- **session 存 Postgres**（+ 可选 Redis 二级存储/限流），60 天过期、cookieCache 5 分钟（减少 DB 查询）。
- 计费 tier 不在 User 上（在 Space 上）。

### C. session 读取与路由保护

- `getSession = cache(async () => authLib.api.getSession({ headers }))`——`React.cache` 包裹，单次请求只查一次。
- **没有全局 middleware**；用三档 SSR helper：
  - `createPublicSSRHelper`（可选 session）
  - `createPrivateSSRHelper`（访客/未登录 → 重定向 `/login`）
  - `createAdminSSRHelper`（要求 `role === "admin"`）
- tRPC 层：`privateProcedure` 拒绝访客；客户端遇到 `UNAUTHORIZED` 自动登出 + 跳 `/login`。

### D. 访客 → 注册用户迁移（亮点）

来源：`apps/web/src/auth/helpers/merge-user.ts`

匿名插件 `onLinkAccount` 回调里，事务性地把访客的 Poll / Participant / Comment 全部 `userId` 改为新注册用户。**这正是 MerismV2 受访者匿名模型的同类思路**——不过 MerismV2 受访者永不转正（按架构），所以这块只作概念参考。

### Rallly 核心发现

1. **无密码默认走 OTP 验证码而非 magic link**——邮件客户端预取链接会误消费 magic link，OTP 更稳。
2. **单入口自适应**：先探测邮箱已有的认证方式，再决定显示密码框还是发 OTP，登录 UX 极简。
3. **无全局 middleware**，用 `cache()` 包裹的 `getSession` + 分档 SSR helper + tRPC procedure 分级。
4. `email` 字段用 citext **大小写不敏感唯一**（PostHog 也是），避免 `A@x.com` / `a@x.com` 重复注册。

---

## 3. PostHog（Django session + DRF）

**栈**：Django + DRF 后端、React(Kea) 前端。栈与我们差异大，但**安全实践与多因子方案**值得抄。（仓库是 sparse checkout，auth 代码从 git 对象库读出。）

### A. User 模型

来源：`posthog/models/user.py`

```python
class User(AbstractUser, ...):
    USERNAME_FIELD = "email"          # 用 email 当登录名，去掉 username
    email = models.EmailField(unique=True)
    pending_email = models.EmailField(null=True)        # 改邮箱时的待确认地址
    is_email_verified = models.BooleanField(null=True)  # 三态：None/False/True
    requested_password_reset_at = models.DateTimeField(null=True)
    passkeys_enabled_for_2fa = models.BooleanField(default=False)
    # 密码哈希：Django 默认 PBKDF2；密码强度用 zxcvbn 校验
```

- **`is_email_verified` 三态**：`None`=历史用户放行、`False`=拦截、`True`=已验证。迁移期友好。
- **改邮箱用 `pending_email`**：新地址先存 pending，验证通过才落地（Formbricks 也是类似两步）。

### B. 登录 / session / 安全

来源：`posthog/api/authentication.py`

- 登录走 `POST /api/login`，`authenticate()` → Django session cookie（`sessionid`，14 天）。
- **暴力破解防护：django-axes**（IP/账户级锁定）。
- **CSRF**：mutating 请求带 `X-CSRFToken`（cookie `posthog_csrftoken`）。
- 编程访问另有 Personal API Key / OAuth token，与浏览器 session 分离。
- **密码找回总返回 204**（不泄露用户是否存在）；reset token 把"用户密码哈希 + `requested_password_reset_at`"算进哈希值，**改密后旧链接自动失效**。

### C. 多因子（最完整的 MFA 三层）

| 层 | 机制 |
|----|------|
| TOTP | `django-otp` + `django-two-factor-auth`，10 个 backup code |
| Passkey 2FA | WebAuthn，`passkeys_enabled_for_2fa` |
| 邮箱 MFA | 没配 TOTP/passkey 的密码用户登录时发邮件码，带"记住设备"30 天 cookie |

组织级可强制 2FA（`enforce_2fa`）；SSO session 跳过（信任 IdP 的 MFA）。

### PostHog 核心发现

1. **`is_email_verified` 三态** + **`pending_email` 两步改邮箱**，是处理历史数据和敏感变更的成熟做法。
2. **多因子要分层**：TOTP 为主、passkey 进阶、**邮箱码兜底**（适合没装 authenticator app 的用户）。
3. **session 优先于 JWT** 做浏览器登录；API/编程访问用独立的 key。
4. reset token 绑定密码哈希，**一旦改密历史 token 全失效**，零额外存储。

---

## 4. LimeSurvey（Yii1 插件式认证）

**栈**：PHP/Yii1。栈最远，但**可插拔认证架构**与**账户过期/锁定**对企业自托管场景有参考意义。

### A. User 模型与哈希

来源：`application/models/User.php`（表 `{{users}}`）

- 字段：`users_name`（用户名，唯一）、`password`、`full_name`、`email`、`expires`（账户过期）、`user_status`（1 启用/0 停用）、`validation_key` + `validation_key_expiration`（设密/重置链接，48h）、`last_login`、`last_forgot_email_password`（5 分钟限频）。
- **哈希**：`password_hash(PASSWORD_DEFAULT)`（bcrypt/argon）；**`checkPassword` 兼容旧 SHA-256 并在登录成功时自动 rehash**（平滑迁移范例）。
- **登录资格**：`canLogin() = isActive() && !isExpired()`。

### B. 可插拔认证（亮点）

来源：`application/core/plugins/{Authdb,AuthLDAP,Authwebserver}`

LimeSurvey 把认证做成插件，订阅事件链：`beforeLogin → newLoginForm → afterLoginFormSubmit → newUserSession`。

| 插件 | 机制 |
|------|------|
| Authdb | DB 用户名/密码（不可停用，兜底） |
| AuthLDAP | LDAP bind |
| Authwebserver | 读反代头 `REMOTE_USER`，可跳过登录表单（SSO/企业内网） |

多插件激活时登录页出现"认证方式选择器"。

### C. 锁定 / 重置 / 权限

- **失败锁定**：`FailedLoginAttempt`，**IP 级**（非账户级），默认 3 次/10 分钟，支持 IP 白名单。
- **找回密码**：随机延迟（防枚举）+ 用户名 + 邮箱匹配 + 始终同一句成功提示 + `validation_key`（48h）。
- **权限**：扁平 CRUD 行 `(uid, entity, entity_id, permission, create_p/read_p/...)` + 命名角色模板（`Permissiontemplates`）。比 RBAC 对象更简单。

### LimeSurvey 核心发现

1. **可插拔认证 + 认证方式选择器**——自托管/企业内网常见诉求（LDAP、反代 SSO）。
2. **账户 `expires` 过期 + IP 级失败锁定**，学术/机构场景刚需。
3. **登录成功时自动 rehash 旧算法密码**，是无感迁移哈希算法的标准手法。

---

## 5. 综合结论：认证方式选择

| 项目 | 主认证 | 无密码 | OAuth/SSO | session | MFA |
|------|--------|--------|-----------|---------|-----|
| Formbricks | 邮箱+密码 | 无（验证靠 JWT） | 企业版 GitHub/Google/Azure/OIDC/SAML | **DB session（可吊销）** | TOTP+backup（企业版） |
| Rallly | **邮箱 OTP** | OTP 6 位码 | Google/Microsoft/OIDC | DB session(+Redis) | 无内置 |
| PostHog | 邮箱+密码 | passkey | GitHub/GitLab/Google/SAML | Django session | **TOTP+passkey+邮箱码** |
| LimeSurvey | 用户名+密码 | 一次性密码 | LDAP/反代 | PHP session | 一次性密码 |

**共识：**
1. **email 作为唯一身份**（去 username），大小写不敏感唯一。
2. **浏览器端用可吊销的服务端 session**，不用裸 JWT（重置密码/停用要能立刻失效会话）。
3. **无密码优先 OTP 验证码**而非 magic link（邮件预取会误消费链接）。
4. **MFA 分层**：TOTP 为主、邮箱码兜底。
5. 密码统一 **bcrypt/argon**，登录时机会性 rehash。

---

## 6. 综合结论：User 数据模型

把四个项目的 User 字段去掉多租户/计费后取交集：

| 字段 | 来源共识 | MerismV2 是否需要 |
|------|---------|------------------|
| `email`（唯一，大小写不敏感） | 全部 | ✅（Appwrite Account 自带） |
| `name` / `full_name` | 全部 | ✅（自带） |
| `emailVerified`（三态优先） | 全部 | ✅（自带 `emailVerification`） |
| `password`(hash) | 全部 | ✅（Appwrite 内部管理，不落业务表） |
| `locale` | Formbricks/Rallly | ✅（放 prefs） |
| `timeZone` | Rallly | ⚠️ 可选（放 prefs） |
| `notificationSettings`(JSON) | Formbricks | ⚠️ 可选（放 prefs） |
| `lastLoginAt` | Formbricks/Rallly/LS | ✅（Appwrite session 自带 `$createdAt`/accessedAt） |
| `isActive`/`user_status` | Formbricks/LS | ⚠️ 单用户场景可不做 |
| `twoFactor*` | Formbricks/PostHog | ⚠️ 进阶（Appwrite MFA 自带） |
| `role` | Rallly(admin/user)/PostHog | ❌ 单研究者无需角色（scope guard） |
| `Membership`/`Space`/`Organization` | Formbricks/Rallly | ❌ 团队/组织——架构禁止 |

**结论**：MerismV2 不需要自建大部分字段，Appwrite Account 已覆盖；`locale`/`timeZone`/`notificationSettings` 这类放进 Account **prefs（JSON）**即可。

---

## 7. 综合结论：安全实践清单

四个项目反复出现、值得照搬的安全要点：

1. **防邮箱枚举**：注册/找回密码无论用户是否存在，返回一致的"已发送"提示与时延。
2. **密码找回 token 绑定密码哈希**（PostHog）或**只存哈希 + 单次消费 + 改密删全部 session**（Formbricks）。
3. **失败登录锁定**：IP 级（LimeSurvey）或账户级（PostHog axes）。
4. **改邮箱两步走**：`pending_email` + 重新验证（PostHog/Formbricks）。
5. **CSRF 保护** mutating 请求（PostHog）。
6. **可吊销 session**：服务端 session 表，删账户/改密即时失效。
7. **密码强度校验**：zxcvbn（PostHog）/正则（Formbricks 要求大写+数字、8–128）。
8. **审计日志**：登录/登出/删账户写审计（Formbricks）。

---

## 8. MerismV2 落地建议（基于 Appwrite Account API）

### 8.1 核心判断：不要重造，直接用 Appwrite Account

上面四个项目花大力气实现的东西（邮箱密码、OTP、magic URL、OAuth、邮箱验证、密码找回、MFA、session 管理、用户 prefs），**Appwrite 的 Account / Users API 全部内置**。MerismV2 的 AGENTS.md 也明确"Appwrite 是唯一后端平台"。所以"抄 PostHog 等的登录模块"，对我们意味着：

> **抄它们的_流程编排、UX 形态、安全默认值、数据模型决策_，用 Appwrite Account API 实现，而不是引入 NextAuth/Better-Auth 或自建 user 表。**

Appwrite Account API 能力映射：

| 调研里的能力 | Appwrite Account API |
|--------------|----------------------|
| 邮箱+密码注册/登录 | `account.create` / `account.createEmailPasswordSession` |
| 邮箱 OTP（Rallly 主力） | `account.createEmailToken` → `account.createSession(userId, secret)` |
| Magic link | `account.createMagicURLToken` → `updateMagicURLSession` |
| OAuth（Google/GitHub…） | `account.createOAuth2Token` / `createOAuth2Session` |
| 邮箱验证 | `account.createVerification` → `updateVerification` |
| 密码找回（防枚举内置） | `account.createRecovery` → `updateRecovery` |
| MFA（TOTP/邮箱/recovery code） | `account.createMfaAuthenticator` + MFA challenge API |
| 可吊销 session | `account.listSessions` / `deleteSession` / `deleteSessions` |
| locale/timeZone/通知设置 | `account.updatePrefs`（JSON prefs） |
| 改名/改邮箱/改密 | `account.updateName` / `updateEmail` / `updatePassword` |

### 8.2 当前 gap 分析

| 现状 | 问题 |
|------|------|
| `lib/owner.ts` `getOwnerUserId()` 写死 `MERISM_OWNER_USER_ID`/`researcher-dev` | 没有真实登录；所有所有权闸门基于固定假用户 |
| `lib/queries/auth.ts` `getCurrentUserId()` 读 `a_session_<projectId>` cookie | 已实现但**无人生成该 cookie**（没有登录页/登录动作） |
| `packages/contracts` `UserSchema` + `appwrite-schema` `users` 集合 | **与 Appwrite 内置 Account/Users 重复**：email/name/createdAt 全是 Account 已有字段 |
| 无 `/login` 页、无 middleware、无 `.env` | 整个研究者认证链路缺失 |
| 13 处文件依赖 `getOwnerUserId()` | 迁移到真实 session 需统一替换为 `getCurrentUserId()` |

### 8.3 关键设计决策：`users` 集合怎么办

**建议：废弃自定义 `users` 集合，研究者身份完全由 Appwrite Account 承载。**

- `email`/`name` → Account 原生字段；`createdAt` → `$createdAt`；`locale`/`timeZone`/通知 → Account `prefs`。
- 所有业务集合的 `ownerUserId` 直接用 Account 的 `$id`（无需再维护一张映射表）。
- 这样消除"内置 auth user vs 业务 user 表"的双写与一致性问题（这是四个项目里 Prisma/Django 因为没有内置 account 服务才不得不自己建表，我们不必照抄表结构）。

> 若未来确有"研究者扩展档案"需求（超出 prefs JSON 能装的），再引入一张 `researcher_profiles`（`$id == accountId`，1:1），但**当前不需要**。

### 8.4 Next.js + Appwrite SSR session 模式（落地要点）

研究者侧用 **server-action 驱动 + httpOnly session cookie** 的 SSR 模式（比纯 Web SDK cookie 更可控）：

1. 登录 server action 里用 node-appwrite 创建 session，拿到 `session.secret`。
2. 写入 httpOnly、secure、sameSite=strict 的 cookie（沿用现有 `a_session_<projectId>` 名或自定义名）。
3. RSC/server action 用 `client.setSession(secret)` 还原会话，`account.get()` 拿当前用户。
4. `getCurrentUserId()` 已是这个形状，**只需把 `getOwnerUserId()` 的调用点逐步切到 `getCurrentUserId()`**，未登录则重定向 `/login`。

> 注意 AGENTS.md：受访者**永不**走这套，受访者只通过 `issueLivekitToken` 拿短期 LiveKit token。这套认证只服务研究者。

### 8.5 分阶段实施方案

| 优先级 | 工作项 | 抄自 | 说明 |
|--------|--------|------|------|
| **P0** | `/login` 页（邮箱+密码 登录）+ 登录 server action 写 session cookie | Formbricks login-form | 单入口、表单校验用 `@merism/contracts` |
| **P0** | `/signup` 页 + 注册 server action（`account.create`）→ 自动发验证邮件 | Formbricks signup | 密码强度校验（8–128、大写+数字） |
| **P0** | 把 13 处 `getOwnerUserId()` 切换为 `getCurrentUserId()`，未登录重定向 | Rallly `createPrivateSSRHelper` | 受保护路由统一闸门 |
| **P0** | `proxy.ts`/middleware：未登录访问 `/home /studies /insights /reports` → `/login?callbackUrl=` | Formbricks `proxy.ts` | 粗粒度边缘保护 |
| **P1** | 邮箱验证页 `/auth/verify`（`updateVerification`）+ 未验证拦截 | PostHog 三态 | Account `emailVerification` 字段 |
| **P1** | 找回密码 `/auth/forgot` + `/auth/reset`（`createRecovery`/`updateRecovery`） | Formbricks/PostHog | Appwrite 内置防枚举 |
| **P1** | 账户设置页 `/settings/account`：改名/改邮箱/改密/登出 | Formbricks settings | 改邮箱需重新验证 |
| **P1** | 登出 server action（`deleteSession("current")`）+ 清 cookie | 全部 | |
| **P2** | 邮箱 OTP 无密码登录（单入口自适应：先探测方式） | **Rallly**（最佳 UX） | `createEmailToken` |
| **P2** | OAuth（Google/GitHub）登录 | PostHog/Rallly | `createOAuth2Token` |
| **P2** | MFA（TOTP 为主 + 邮箱码兜底）+ 设置页管理 | PostHog 分层 | Appwrite MFA API |
| **P2** | locale/timeZone/通知设置写入 Account prefs | Formbricks/Rallly | `updatePrefs` |

### 8.6 contracts 层调整建议

```typescript
// packages/contracts/src/entities.ts
// 当前 UserSchema 与 Appwrite Account 重复，建议：
// 1) 保留一个"研究者视图"类型用于前端展示（从 account.get() 投影），
//    而非数据库实体；
// 2) prefs 形状用 zod 固化，作为 account.updatePrefs 的契约。

export const ResearcherPrefsSchema = z.object({
  locale: z.string().default("zh-CN"),
  timeZone: z.string().optional(),
  notifications: z.object({
    sessionCompleted: z.boolean().default(true),
    reportReady: z.boolean().default(true),
  }).default({}),
});

// 当前用户的只读视图（来自 Appwrite Account，不是 DB 行）
export const CurrentResearcherSchema = z.object({
  id: z.string(),            // account $id == ownerUserId
  email: z.string().email(),
  name: z.string(),
  emailVerified: z.boolean(),
  prefs: ResearcherPrefsSchema,
});
```

> `appwrite-schema` 的 `users` 集合：建议在落地 P0 时标记为废弃（保留迁移期），新代码不再写它；`ownerUserId` 一律取 Account `$id`。

### 8.7 设计系统约束（前端 UI）

登录/注册/设置页必须遵循 `.kiro/steering/design-system.md`（Mauve Quiet）：
- 主按钮用 mauve 填充（`primary`），不得用黑底实心按钮。
- 表单用 React Hook Form + `@merism/contracts` 的 zod schema。
- 状态/错误用 图标+文案 传达，不靠颜色（无红/绿）。
- 字体角色固定（`font-ui`/`font-display` 等），不写裸 `font-['...']`。

---

## 附：四个项目源码定位速查

| 关注点 | Formbricks | Rallly | PostHog | LimeSurvey |
|--------|-----------|--------|---------|-----------|
| auth 配置 | `modules/auth/lib/authOptions.ts` | `src/lib/auth.ts` | `posthog/api/authentication.py` | `core/plugins/Authdb/Authdb.php` |
| User 模型 | `packages/database/schema.prisma` | `prisma/models/user.prisma` | `posthog/models/user.py` | `models/User.php` |
| 登录页 | `modules/auth/login/` | `app/[locale]/(auth)/login/` | `scenes/authentication/login/` | `controllers/admin/Authentication.php` |
| 找回密码 | `modules/auth/forgot-password/` | `settings/security` | `api/authentication.py PasswordReset` | `services/PasswordManagement.php` |
| session 读取 | `getServerSession` | `getSession=cache(...)` | `request.user`(Django) | `LSUserIdentity` |
| 路由保护 | `proxy.ts` + action client | SSR helper 分档 | DRF SessionAuthentication | 全局权限校验 |
| 账户设置 | `settings/account/` | `settings/profile\|security` | `scenes/settings/user/` | `controllers/admin/UserAction.php` |
| MFA | `modules/ee/two-factor-auth/` | 无 | `api/two_factor*` | 一次性密码 |

*本报告基于直接阅读各项目克隆源码生成，代码引用均来自本地仓库文件；Appwrite 能力映射依据 Appwrite Account/Users API。*
