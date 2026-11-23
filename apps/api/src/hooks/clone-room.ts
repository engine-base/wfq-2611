// 分身の部屋の口（K-753・K-754）の登録（K-326）。振る舞いの本体は apps/api/src/features/F5/clone-room/。
//   server.ts・fuzz の的には書かない（作り手 scripts/ci/gen_ts_registries.py が一覧 all.generated.ts に入れる）
import type { Hook } from "../contract/deps.js";
import { cloneRoomOps } from "../features/F5/clone-room/index.js";
import { defineHooks, type HookDeps } from "./registry.js";

export function cloneRoomHooks(d: HookDeps): Record<string, Hook> {
  const h = cloneRoomOps(d.appPool);
  return {
    getMyClone: { ...h["getMyClone"] },
    getCloneNow: { ...h["getCloneNow"] },
    listCloneActivity: { ...h["listCloneActivity"] },
    getCloneGrowth: { ...h["getCloneGrowth"] },
  };
}

export const register = defineHooks({
  name: "cloneRoomHooks",
  make: (d) => cloneRoomHooks(d),
  fuzz: "same",
});
