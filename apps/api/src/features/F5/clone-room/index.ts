// 分身の部屋の口の一覧（K-753）：getMyClone（部屋の頭）・getCloneNow（ようす）。本体は DB の関数 app.clone_me・app.clone_now（20261125023300）。
//   K-754 が同じ一覧に listCloneActivity（やったこと）・getCloneGrowth（育ち具合）を足した（本体 activity.ts・app.clone_activity・app.clone_growth）
import type pg from "pg";
import type { Hook } from "../../../contract/deps.js";
import { activityHook, growthHook } from "./activity.js";
import { readOne } from "./read.js";

export function cloneRoomOps(pool: pg.Pool): Record<string, Hook> {
  return {
    getMyClone: { before: (a) => readOne(pool, a, "getMyClone", "clone_me") },
    getCloneNow: { before: (a) => readOne(pool, a, "getCloneNow", "clone_now") },
    listCloneActivity: { before: (a) => activityHook(pool, a) },
    getCloneGrowth: { before: (a) => growthHook(pool, a) },
  };
}
