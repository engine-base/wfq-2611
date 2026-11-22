// PC がログイン情報を取り出す口（K-354）の契約の口。振る舞いの本体は apps/api/src/features/F3/credentials/resolve.ts。
//   ここは「作った口」の一覧（生成の試験と目録がこのフォルダを見る）
import type { Hook } from "../contract/deps.js";
import { createResolveCredential } from "../features/F3/credentials/resolve.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function credentialsResolveHooks(d: HookDeps): Record<string, Hook> {
  // 答えに封（PC の鍵でしか開けない形）が入るので、冪等の器に体の要約も答えも残さない（取り出しは毎回 1 回だけ渡す）
  return {
    resolveCredential: {
      before: createResolveCredential({ appPool: d.appPool, secrets: d.secrets }),
      noIdempotency: true,
    },
  };
}

export const register = defineHooks({
  name: "credentialsResolveHooks",
  make: (d) => credentialsResolveHooks(d),
  fuzz: "same",
});
