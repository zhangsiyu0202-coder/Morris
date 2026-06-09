/**
 * Morris 进程内错误计数器 (R4 / morris-agent-hardening).
 *
 * 当前实现:进程内 Map,Next.js 单进程下足以做诊断与统计。后续若上 Prom/OTel,
 * 把 morrisErrorCounter 替换成新实现即可 (接口稳定)。
 *
 * 设计意图: route.ts::onError 把分类后的 kind 喂给 inc(); 运维或本地调试时
 * 通过 getCounts() 一眼看到各类错误的累积。绝不持久化,绝不上报到任何外部。
 */

import type { MorrisErrorKind } from "./errors";

export interface MorrisErrorCounter {
  inc(kind: MorrisErrorKind): void;
}

const counts: Record<MorrisErrorKind, number> = {
  client: 0,
  api: 0,
  transient: 0,
  transport: 0,
  unknown: 0,
};

export const morrisErrorCounter: MorrisErrorCounter = {
  inc(kind: MorrisErrorKind) {
    counts[kind] = (counts[kind] ?? 0) + 1;
  },
};

/** 当前各类错误累计计数 (返回快照,不暴露内部引用)。 */
export function getCounts(): Record<MorrisErrorKind, number> {
  return { ...counts };
}

/** 仅给单测使用,正常代码路径不该调用。 */
export function resetCounts(): void {
  counts.client = 0;
  counts.api = 0;
  counts.transient = 0;
  counts.transport = 0;
  counts.unknown = 0;
}
