// ESLint 9 flat config for apps/web (Next.js 15 + React 19 + TypeScript).
//
// 早期 `apps/web/package.json::scripts.lint` 写的是 `next lint`, 但 ESLint
// 从来没真正装过 — `next lint` 落到"do you want to set up ESLint?"的交互式
// 引导, 在 CI 与本地都跑不通。这份配置 + `eslint .` 取代之 (Next.js 15.4+ 起
// `next lint` deprecated, 16 移除; 官方迁移指南: `npx @next/codemod@canary
// next-lint-to-eslint-cli .` 也是生成这份 shape, 我们手动写出来对项目语境更
// 精确)。
//
// 借助 @eslint/eslintrc::FlatCompat 把 eslint-config-next 的 legacy
// preset (`next/core-web-vitals`, `next/typescript`) 翻译进 flat config —
// 这是 Next.js 官方 docs/eslint 推荐的桥接形态:
// https://nextjs.org/docs/app/api-reference/config/eslint
//
// Rule overrides 解释:
//  - `@typescript-eslint/no-unused-vars` 允许 `_` 前缀的未用变量 (TS 社区
//    通行写法), `argsIgnorePattern` / `varsIgnorePattern` / `caughtErrorsIgnorePattern`
//    全开 `^_`。
//  - 测试文件 (`**/*.test.*`, `**/__tests__/**`) 关掉 `@typescript-eslint/no-explicit-any`:
//    测试里用 `as any` 构造 fixture / 探测运行时行为是合理 ergonomics, 真错
//    在 typecheck (`tsc --noEmit`) 那一关已经守住, 不让 lint 重复加压。
//
// Ignore 列表:
//  - `.next` / build artifacts: Next.js 自己产物
//  - `e2e`: Playwright 测试在独立 tsconfig 下编译, 用自己一套 lint 规则
//  - `node_modules`: 标准
//
// 这份配置只覆盖 `apps/web`; 工作区其它包 (packages/*, apps/functions/*,
// apps/agent) 各自决定。

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "build/**",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // `_` 前缀 = "intentionally unused" 是 TS/Node 社区惯例; 默认 unused-vars
      // 规则不识别, 显式开 ignorePattern 让它降级 (warning → 沉默)。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          // 允许同名 destructure 旁路, 例: `const { a: _a, ...rest } = obj`
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // 测试文件: 关 no-explicit-any 与 ban-ts-comment, 它们与测试 ergonomics 冲突。
    files: [
      "**/__tests__/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
];
