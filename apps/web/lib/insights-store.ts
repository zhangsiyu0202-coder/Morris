"use client";

import { useSyncExternalStore } from "react";
import type { GeneratedInsight } from "./insights";

/**
 * 洞察的客户端持久化层(sessionStorage)。
 *
 * 洞察是用户在前端一次性生成的展示型数据,无需数据库;用 sessionStorage
 * 让「列表页 → 详情页」跳转后数据仍在,并通过 useSyncExternalStore 让
 * 多个组件实时同步。
 */

export type StoredInsight = {
  id: string;
  studyId: string;
  studyTitle: string;
  question: string;
  insight: GeneratedInsight;
  createdAt: number;
};

const KEY = "merism.insights.v1";
const listeners = new Set<() => void>();

function read(): StoredInsight[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredInsight[]) : [];
  } catch {
    return [];
  }
}

function write(items: StoredInsight[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 忽略写入失败(如隐私模式) */
  }
  listeners.forEach((l) => l());
}

// useSyncExternalStore 需要稳定的快照引用,这里做缓存避免无限重渲染。
let cache: StoredInsight[] = [];
let cacheRaw = "";
function getSnapshot(): StoredInsight[] {
  const raw = typeof window === "undefined" ? "" : window.sessionStorage.getItem(KEY) ?? "";
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = raw ? (JSON.parse(raw) as StoredInsight[]) : [];
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addInsight(input: Omit<StoredInsight, "id" | "createdAt">): StoredInsight {
  const item: StoredInsight = {
    ...input,
    id: `ins_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };
  write([item, ...read()]);
  return item;
}

export function removeInsight(id: string) {
  write(read().filter((i) => i.id !== id));
}

export function getInsight(id: string): StoredInsight | undefined {
  return read().find((i) => i.id === id);
}

export function useInsights(): StoredInsight[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => []);
}
