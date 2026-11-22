// K-302 確認のコードで入る（契約の口 verifySignInCode・POST /api/v1/auth/two-factor/verify）。
//   パスワードの段（K-301）で受け取った待ちの印（pending・5 分）と、認証アプリの 6 けたかバックアップコードのどちらか 1 つで入る。
//   上限（1 分に 10 回・IP ごと）と入力の形（strict・trust_device を含むほかの欄は 422）は契約の入口（op.ts）が先に確かめる。
//   確かめの順：待ちの印が生きているか（E-AUTH-013）→ 同じ 30 秒の使い回し（E-AUTH-004）→ 部品の確かめ（違う E-AUTH-004・5 回で 15 分止める E-AUTH-014）。
//   「この端末を信頼する」は使わない（D-128.60）。ログインの部品・生の DB は直に使わない（部品は @kaname/auth の中だけ・境界 B2・関門 C2）。
//   ログに 6 けた・バックアップコード・待ちの印・ログインの印を出さない（K302-API-019）
import { countryOf } from "@kaname/auth/device";
import { verifySignInCode, type SignInCodeOutcome } from "@kaname/auth/two_factor";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { kindOf, reply, type LoginDeps } from "./shared.js";

/** コードの長さの上限（E-VAL-009） */
const CODE_MAX = 64;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const blank = (v: string | undefined): boolean => v === undefined || v.trim() === "";

export function signInCodeFeature(
  d: LoginDeps,
  memberGone: (token: string, ua: string | undefined) => Promise<boolean>,
) {
  /** 前処理（入口の strict な形の確かめより前）：待ちの印が無い・コードが 1 つでない・文字でない（null・数・真偽）・空・64 文字を超えるは 422（部品を呼ばない・失敗の数に入れない）。
   *  コードは「どちらか 1 つだけが文字」で来る（契約の oneOf と同じ・K-638）。null は「無い」と見ない（本物の code と null の backup_code を通さない） */
  const input = (raw: unknown): { input: Record<string, unknown> } | { reply: HookReply } => {
    const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const has = (k: string) => b[k] !== undefined;
    if (blank(str(b["pending"]))) return { reply: { status: 422, body: validation("pending", "待ちの印が要る") } };
    if (has("code") === has("backup_code"))
      return { reply: { status: 422, body: validation("code", "code と backup_code のどちらか 1 つ") } };
    const field = has("code") ? "code" : "backup_code";
    const code = str(b[field]);
    if (code === undefined) return { reply: { status: 422, body: validation(field, `${field} は文字で渡す`) } };
    // 長さは文字（コードポイント）で数える（契約の maxLength と同じ。UTF-16 の長さだと絵文字 33 個を断ってしまう）
    if (blank(code) || [...code].length > CODE_MAX) return { reply: reply(422, "E-VAL-009") };
    return { input: b };
  };

  const answer = async (r: SignInCodeOutcome, ua: string | undefined): Promise<HookReply> => {
    if (r.ok) {
      if (await memberGone(r.token, ua)) return reply(403, "E-AUTH-007", { detail: { ops_email: d.config.opsEmail } });
      return { status: 201, body: { data: { token: r.token, backup_codes_left: r.backupCodesLeft } } };
    }
    switch (r.reason) {
      case "expired":
        return reply(401, "E-AUTH-013");
      case "wrong":
        return reply(401, "E-AUTH-004");
      case "locked":
        return reply(429, "E-AUTH-014", { retry_after_sec: r.retryAfterSec });
      case "refused":
        // 止め（K-303 の hook）に断られた：部品の状態コードと code をそのまま、文は目録から。抜けたは運営の連絡先つき（パスワードの口と同じ）
        return reply(r.status, r.code, r.code === "E-AUTH-007" ? { detail: { ops_email: d.config.opsEmail } } : {});
    }
  };

  const verify = async (a: HookArgs): Promise<HookReply> => {
    const ua = a.c.req.header("user-agent");
    try {
      const r = await verifySignInCode(d.auth, d.appPool, d.authPool, {
        pending: String(a.input["pending"]),
        ...(a.input["code"] !== undefined ? { code: String(a.input["code"]) } : {}),
        ...(a.input["backup_code"] !== undefined ? { backupCode: String(a.input["backup_code"]) } : {}),
        ...(ua ? { userAgent: ua } : {}),
        country: countryOf(a.c.req.raw.headers),
      });
      return await answer(r, ua);
    } catch (e) {
      // DB が落ちた・セッションを写す所で失敗した：500。部品の hook の失敗は部品が、入った後の後処理の失敗は verifySignInCode が
      //   その場でセッションを閉じてある（生きたセッションを残さない・K-322）
      console.error(`[login] 確認のコードのログインの途中で落ちた（${kindOf(e)}）`);
      return reply(500, "E-PAGE-003");
    }
  };

  return { input, verify };
}

/** 入口と同じ形の 422（項目ごとの理由） */
function validation(field: string, message: string) {
  return { error: "validation_failed", code: "VALIDATION_ERROR", details: [{ field, message }] };
}
