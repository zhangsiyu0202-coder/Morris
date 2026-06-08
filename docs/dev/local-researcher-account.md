# 本地开发 · 研究员测试账号

> **给 AI / 开发者的速查**：本地 Docker Appwrite + `pnpm dev` 时，用下面账号登录研究者工作台做手工测试。  
> 这不是 Appwrite 控制台管理员，也不是产品内的「管理员角色」——MerismV2 架构上只有**单研究者**（无团队/无 RBAC），此账号即 `ownerUserId` 的来源。

## 登录入口

- Web：`http://localhost:3000/login`
- 注册页：`http://localhost:3000/signup`（一般不需要，账号已预建）

## 测试账号（本地 stack）

| 字段 | 值 |
|------|-----|
| 邮箱 | `researcher@merism.local` |
| 密码 | `MerismDev1` |
| 显示名 | Merism 研究员 |
| Appwrite Account `$id` | `6a26605d003b8aedfa9e` |
| 邮箱已验证 | 是（已用 API 标记，登录后无验证拦截） |

密码规则（注册/改密时）：至少 8 位，含一个大写字母和一个数字。`MerismDev1` 满足。

## 与数据所有权的关系

- 登录后 session cookie 中的用户 id = **`6a26605d003b8aedfa9e`**
- 所有 `ownerUserId` 作用域的调研/链接/洞察，都应挂在这个 id 下
- 种子脚本 `scripts/seed-survey.ts`、`scripts/seed-sessions.ts` 读取环境变量：

```bash
MERISM_OWNER_USER_ID=6a26605d003b8aedfa9e
```

已在项目根 `.env` 中配置（勿提交到公开仓库；本地私有即可）。

## 前置条件

```bash
pnpm stack:up          # Appwrite http://localhost:8080
pnpm schema:apply      # 同步 collections / enum
pnpm dev               # Web http://localhost:3000
```

`.env` 中 Appwrite 连接（本地默认）：

```bash
APPWRITE_ENDPOINT=http://localhost:8080/v1
APPWRITE_PROJECT_ID=merism
APPWRITE_API_KEY=<你的本地 API Key>
APP_URL=http://localhost:3000
```

## 重建账号（可选）

若 `stack:reset` 清库后账号丢失，在项目根执行：

```bash
set -a && . ./.env && set +a
node -e "
const { Client, Users, ID, Query } = require('node-appwrite');
const EMAIL = 'researcher@merism.local';
const PASSWORD = 'MerismDev1';
const NAME = 'Merism 研究员';
const u = new Users(new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));
(async () => {
  const ex = await u.list([Query.equal('email', EMAIL), Query.limit(1)]);
  const user = ex.users[0] ?? await u.create(ID.unique(), EMAIL, undefined, PASSWORD, NAME);
  if (!user.emailVerification) await u.updateEmailVerification(user.\$id, true);
  console.log('id:', user.\$id, 'email:', user.email);
})();
"
```

创建后把新的 `$id` 更新到本文档和 `.env` 的 `MERISM_OWNER_USER_ID`。

## 安全说明

- 仅用于**本地开发**；不要在生产环境使用此邮箱/密码
- 受访者（访谈链接）**永不**使用此账号，他们只拿 LiveKit 短期 token
