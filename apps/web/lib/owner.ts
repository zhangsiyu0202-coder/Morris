/**
 * 研究员 owner 解析(无登录 UI)。
 *
 * 本产品研究员侧暂无登录界面(按产品决定不做)。编辑器与工作台的读写仍以
 * `ownerUserId` 作用域(与 `lib/queries/*` 的所有权闸门一致),但 owner 不来自
 * 会话 cookie,而是服务端固定解析:env `MERISM_OWNER_USER_ID`,缺省 dev 值。
 *
 * 仅服务端使用(server action / RSC / route handler)。
 */
export function getOwnerUserId(): string {
  return process.env.MERISM_OWNER_USER_ID || "researcher-dev";
}
