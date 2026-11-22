// 確認項目を読む・足す口（K-434）の契約の口。振る舞いの本体は apps/api/src/features/F4/test-spec/list.ts・create.ts。
//   直す・外す・チェックの付け外し（K-435 の test-specs-edit.ts）は、それぞれの葉が自分の hooks のファイルを持つ（このファイルに足さない）。
//   ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type { Hook } from "../contract/deps.js";
import { createCreateTestSpec } from "../features/F4/test-spec/create.js";
import { createListTestSpecs } from "../features/F4/test-spec/list.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function testSpecsCreateHooks(d: HookDeps): Record<string, Hook> {
  return {
    listTestSpecs: { before: createListTestSpecs(d.appPool) },
    createTestSpec: { before: createCreateTestSpec(d.appPool) },
  };
}

export const register = defineHooks({
  name: "testSpecsCreateHooks",
  make: (d) => testSpecsCreateHooks(d),
  fuzz: "same",
});
