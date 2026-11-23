// ナレッジのページを書き終える口（K-680）の契約の登録。振る舞いの本体は apps/api/src/features/F9/knowledge/publish.ts。
//   持ち主の表は features/F9/knowledge/ops.ts
import type { Hook } from "../contract/deps.js";
import { createPublishKnowledgePage } from "../features/F9/knowledge/publish.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function knowledgePublishHooks(d: HookDeps): Record<string, Hook> {
  return {
    publishKnowledgePage: { before: createPublishKnowledgePage(d.appPool) },
  };
}

export const register = defineHooks({
  name: "knowledgePublishHooks",
  make: (d) => knowledgePublishHooks(d),
  fuzz: "same",
});
