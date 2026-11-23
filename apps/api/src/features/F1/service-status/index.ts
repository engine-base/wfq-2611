// K-307 いまの様子（getServiceStatus・誰でも）：直っていない障害（運営が公開したお知らせに結んだもの）と、いま中のメンテナンスだけを返す。
//   中身は DB の関数 app.public_service_status()（security definer・障害とお知らせの表の行の守りは変えない）が決める。口はそれをそのまま返す。
//   ログイン中の頭が付いていても答えは同じ（誰の分も足さない）。上限（10 回／分／IP）と一覧の引数の形は契約の入口（op.ts）が先に確かめる。
//   読めないときは「ふつう」（空）を返さず 503・E-PAGE-003（G-15・K-1106）。答えに表の名前や中身を出さない
import { withTenant } from "@kaname/db/context";
import { kanameError } from "@kaname/errors";
import type { HookArgs, HookReply } from "../../../contract/deps.js";

/** 関門 C2 の withTenant に渡す業務の接続（kaname_app） */
export type AppPool = Parameters<typeof withTenant>[0];
export interface ServiceStatusDeps {
  appPool: AppPool;
}

const errName = (e: unknown) => (e as Error)?.name ?? "Error";
const serverDown = (): HookReply => {
  const e = kanameError("E-PAGE-003").toJSON() as { message?: string; action?: string };
  return {
    status: 503,
    body: { error: "unavailable", code: "E-PAGE-003", message: e.message ?? "", action: e.action ?? "" },
  };
};

export function serviceStatusFeature(d: ServiceStatusDeps) {
  const read = async (a: HookArgs): Promise<HookReply> => {
    try {
      const s = await withTenant(d.appPool, a.ctx, async (cl) => {
        const r = await cl.query<{ s: unknown }>("select app.public_service_status() as s");
        return r.rows[0]?.s;
      });
      if (!s || typeof s !== "object") throw new Error("稼働状況の答えが空");
      return { status: 200, body: { data: s } };
    } catch (e) {
      // 表の名前はログにだけ出す（答えには出さない）
      console.error(`[service-status] 障害とお知らせ（status_incidents・notices）を読めなかった: ${errName(e)}`);
      return serverDown();
    }
  };
  return { read };
}
