// ナレッジのフォルダを足す・直す・消す口 3 本（K-678）の契約の登録。振る舞いの本体は apps/api/src/features/F9/knowledge/folder-*.ts。
//   ナレッジのほかの口は、それぞれの葉が自分の hooks のファイルを作る（持ち主の表は features/F9/knowledge/ops.ts）
import type { Hook } from "../contract/deps.js";
import { createCreateKnowledgeFolder } from "../features/F9/knowledge/folder-create.js";
import { createUpdateKnowledgeFolder } from "../features/F9/knowledge/folder-update.js";
import { createDeleteKnowledgeFolder } from "../features/F9/knowledge/folder-delete.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function knowledgeFoldersHooks(d: HookDeps): Record<string, Hook> {
  return {
    createKnowledgeFolder: { before: createCreateKnowledgeFolder(d.appPool) },
    updateKnowledgeFolder: { before: createUpdateKnowledgeFolder(d.appPool) },
    deleteKnowledgeFolder: { before: createDeleteKnowledgeFolder(d.appPool) },
  };
}

export const register = defineHooks({
  name: "knowledgeFoldersHooks",
  make: (d) => knowledgeFoldersHooks(d),
  fuzz: "same",
});
