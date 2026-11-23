// K-313 再設定のメールを頼む（契約の口 requestPasswordReset・POST /api/v1/auth/password/forgot・誰でも呼べる）。
//   答えはいつも 201 { data: { accepted: true } }。登録の有無・確認していない申し込みだけ・60 秒の内・送れなかった・背景で DB が落ちた の
//   どれでも同じ（D-042）。違うのは形の違うメール（422・E-VAL-004）と送りすぎ（429・契約の入口）だけ。
//   送るのは答えの後（afterReply）。待つと登録されている人だけ遅くなり、時間で有無が分かる。
//   送れた／送れなかったときは、本人が今いる会社ごとに security_events（password_reset_requested・detail は sent だけ）を残す（関門 C2）。
//   ログにメールアドレス・手がかりを出さない。宛先は mailTag の印（D-128.146）
// K-314 新しいパスワードを決める（契約の口 resetPassword・POST /api/v1/auth/password/reset・リンクを持つ人）。
//   中身は packages/auth の resetWithLink（リンクを見る → 長さ → 漏れ → 取る → 切る → 変える）。ここは形と答えの写しだけ。
//   ログに手がかり・パスワード・メールを出さない（失敗の名前と番号だけ）
import type { Auth } from "@kaname/auth";
import type { ActionGateway } from "@kaname/actions";
import type { TenantContext } from "@kaname/db/context";
import { EMAIL_RE, mailTag, normalizeEmail } from "@kaname/auth/signup";
import { requestReset, resetWithLink, type LeakCheck, type ResetMailer } from "@kaname/auth/reset";
import type pg from "pg";
import { kanameError } from "@kaname/errors";
import { OPS_TENANT_ID } from "../sign-up/index.js";
import { checkPwned, registerPwned } from "../sign-up/pwned.js";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { afterReply } from "./after-reply.js";

export { resetWorkIdle } from "./after-reply.js";

/** 頼んだ出来事（security_events.kind_id） */
export const RESET_REQUESTED = "password_reset_requested";

export interface PasswordResetDeps {
  /** 認証の部品（新しいパスワードを部品と同じ形でハッシュにする・K-314） */
  auth: Auth;
  /** 外への口（関門 C1）。漏れたパスワードの照合（K-51 の行為をそのまま使う・K-314） */
  actions: ActionGateway;
  /** 認証の接続（kaname_auth の表） */
  authPool: pg.Pool;
  /** 業務の接続（記録の関数 app.record_security_event_for_auth_user） */
  appPool: pg.Pool;
  /** メールの送出（関門 C6・server.ts の 1 か所） */
  mailer?: ResetMailer;
  config: { baseUrl: string; webBaseUrl: string | null };
}

const accepted = (): HookReply => ({ status: 201, body: { data: { accepted: true } } });
const invalidEmail = (): HookReply => {
  const e = kanameError("E-VAL-004", { field: "email" });
  return { status: e.status, body: e.toJSON() };
};
/** 失敗の名前と番号だけ（中身の文に値が入ることがあるので出さない） */
const errSummary = (e: unknown): string => {
  const x = e as { name?: string; code?: string } | null;
  return `${x?.name ?? "Error"}${x?.code ? `（${x.code}）` : ""}`;
};

/** 照合の証跡は運営のテナントに残す（再設定の前は会社の文脈が無い・登録と同じ） */
const OPS_CTX: TenantContext = { tenantId: OPS_TENANT_ID, userId: null, role: "anonymous" };
/** 欄が無い・形が違う（契約の形の 422） */
const missing = (field: string): HookReply => ({
  status: 422,
  body: { error: "validation_failed", code: "VALIDATION_ERROR", details: [{ field, message: `${field} が要る` }] },
});
/** 正本のエラーを答えにする。状態の番号は口が決める（410・409 は種類の既定と違うことがある） */
const reply = (status: number, code: string, field?: string): HookReply => ({
  status,
  body: kanameError(code, field ? { field } : {}).toJSON(),
});

export function passwordResetFeature(d: PasswordResetDeps) {
  const web = d.config.webBaseUrl ?? d.config.baseUrl;
  registerPwned(d.actions);

  /** 答えの後の仕事：送って、送った／送れなかったを記録する。失敗は宛先の印つきで残し、投げない */
  const work = async (email: string): Promise<void> => {
    const tag = mailTag(email);
    let r: Awaited<ReturnType<typeof requestReset>>;
    try {
      r = await requestReset(
        { authPool: d.authPool, ...(d.mailer ? { mailer: d.mailer } : {}), webBaseURL: web },
        email,
      );
    } catch (e) {
      console.error(`[reset] 再設定のリンクを作れなかった → ${tag}: ${errSummary(e)}`);
      return;
    }
    if (r.result === "skipped" || !r.userId) return;
    try {
      await d.appPool.query("select app.record_security_event_for_auth_user($1, $2, $3::jsonb)", [
        r.userId,
        RESET_REQUESTED,
        JSON.stringify({ sent: r.result === "sent" }),
      ]);
    } catch (e) {
      console.error(`[reset] 頼んだ記録を残せなかった → ${tag}: ${errSummary(e)}`);
    }
  };

  /** requestPasswordReset：形を確かめ、仕事を答えの後に回して、すぐ同じ答えを返す */
  const request = async (a: HookArgs): Promise<HookReply> => {
    const raw = a.input["email"];
    const email = typeof raw === "string" ? normalizeEmail(raw) : "";
    if (!EMAIL_RE.test(email)) return invalidEmail();
    afterReply(work(email));
    return accepted();
  };

  /** 漏れの照合。照合のサービスが落ちている間は通す（D-128.134・代表の答え ⑩）。理由にパスワードは入らない */
  const checkLeaked = async (password: string): Promise<LeakCheck> => {
    const r = await checkPwned(d.actions, OPS_CTX, password);
    if (r.kind === "unavailable") console.warn(`[reset] 漏れの照合が使えないので、照合せずに通す: ${r.reason}`);
    return r.kind;
  };
  const hashPassword = async (password: string): Promise<string> => (await d.auth.$context).password.hash(password);

  /** resetPassword：形を確かめ、決めて、答えに写す */
  const reset = async (a: HookArgs): Promise<HookReply> => {
    // パスワードは契約の入口が表記ゆらぎを直す前の値を使う（打ったとおりに預ける・登録と同じ）
    const raw = (await a.c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = a.input["token"];
    const newPassword = typeof raw["new_password"] === "string" ? raw["new_password"] : a.input["new_password"];
    if (typeof token !== "string") return missing("token");
    if (typeof newPassword !== "string") return missing("new_password");
    let r: Awaited<ReturnType<typeof resetWithLink>>;
    try {
      r = await resetWithLink(
        { authPool: d.authPool, appPool: d.appPool, hashPassword, checkLeaked },
        { token, newPassword },
      );
    } catch (e) {
      console.error(`[reset] 新しいパスワードを決められなかった（リンクを見る所）: ${errSummary(e)}`);
      return reply(503, "E-PAGE-003");
    }
    switch (r.result) {
      case "done":
        for (const e of r.followUpErrors)
          console.error(`[reset] 決めた後の片付け・ロック・記録のどれかが落ちた: ${errSummary(e)}`);
        return { status: 201, body: { data: { reset: true } } };
      case "expired":
        return reply(410, "E-AUTH-006");
      case "invalid":
        // リンクが DB に無い（でたらめ・空・空白だけ）。形どおりの入力が DB の中身で断られる所なので 422・410 にしない（K-638）
        return reply(409, "E-PAGE-006");
      case "short":
        return reply(422, "E-VAL-005", "new_password");
      case "long":
        return reply(422, "E-VAL-026", "new_password");
      case "leaked":
        return reply(422, "E-VAL-011", "new_password");
      case "down":
        console.error(
          `[reset] 端末を切る所かパスワードを変える所で落ちた（リンクは残す）: ${errSummary(r.error)}` +
            (r.restoreError ? `／リンクを戻せなかった: ${errSummary(r.restoreError)}` : ""),
        );
        return reply(503, "E-PAGE-003");
    }
  };

  return { request, reset };
}
