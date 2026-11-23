// K-306 ログアウトする（契約の口 signOut・POST /api/v1/auth/sign-out）。
//   上限（1 分に 60 回・人ごと）・認証（PC の印だけは 403）・入力の形（空の体だけ・strict）は契約の入口（op.ts）が先に確かめる。
//   閉じるのはその画面のセッションだけ：sessions の行を理由 logout で閉じてから認証側のセッションを消す（部品の signOut・この順なので半分だけ閉じない）。
//   同じ人の別のブラウザと PC（Bridge）のセッションは閉じない（D-125.140・D-128.121）。
//   入口で解けたのに部品のセッションがもう無い（同時に 2 回押した 2 つ目）は 401。閉じる所の失敗は 503（K-1106・ログには種類だけ・印は出さない）
import { signOut } from "@kaname/auth/resolver";
import { kanameError } from "@kaname/errors";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import type { LoginDeps } from "./sign-in.js";

const reply = (status: number, code: string): HookReply => ({ status, body: kanameError(code).toJSON() });
/** 入口（op.ts）の 401 と同じ形 */
const unauthenticated: HookReply = { status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } };
/** 例外の種類だけ（DB の番号か名前）。文や値はログに出さない */
const kindOf = (e: unknown): string => {
  const x = e as { code?: unknown; name?: unknown } | null;
  return typeof x?.code === "string" ? x.code : typeof x?.name === "string" ? x.name : "Error";
};

export function signOutFeature(d: Pick<LoginDeps, "auth" | "appPool">) {
  /** 要求の印のセッションが部品の側にまだ在るか */
  const alive = async (headers: Headers): Promise<boolean> => (await d.auth.api.getSession({ headers })) !== null;

  const signOutHook = async (a: HookArgs): Promise<HookReply> => {
    const headers = a.c.req.raw.headers;
    try {
      if (!(await alive(headers))) return unauthenticated;
      await signOut(d.auth, d.appPool, headers);
      return { status: 201, body: { data: { signed_out: true } } };
    } catch (e) {
      // 同時に押したもう一方が先に閉じた：もう無いので 401（500 にしない）
      if (!(await alive(headers).catch(() => true))) return unauthenticated;
      console.error(`[login] ログアウトの途中で落ちた（${kindOf(e)}）`);
      return reply(503, "E-PAGE-003");
    }
  };

  return { signOut: signOutHook };
}
