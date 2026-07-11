import { redirect } from "next/navigation";

// 根路径不挂内容,直接送到研究者首页;未登录请求由 middleware 先截到 /login。
export default function RootPage(): never {
  redirect("/home");
}
