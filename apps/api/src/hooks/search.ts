// 探す（⌘K の探す欄・K-468）の契約の口 search。振る舞いの本体は apps/api/src/features/F7/search/（種類ごとのファイル）。
//   ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type { Hook } from "../contract/deps.js";
import { createSearch } from "../features/F7/search/index.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function searchHooks(d: Pick<HookDeps, "appPool">): Record<string, Hook> {
  return {
    search: { before: createSearch(d.appPool) },
  };
}

export const register = defineHooks({
  name: "searchHooks",
  make: (d) => searchHooks(d),
  fuzz: "same",
});
