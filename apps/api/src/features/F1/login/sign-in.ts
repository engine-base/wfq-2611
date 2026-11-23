// K-301 パスワードで入る（契約の口 signInWithPassword・POST /api/v1/auth/sign-in）。
//   上限（1 分に 10 回・IP ごと）と入力の形（strict）は契約の入口（op.ts）が先に確かめる。ここは前処理（空）と振る舞い。
//   5 回違えたら 15 分ロック（app.login_attempts・D-042）。無いメールも違うパスワードと同じ答え・同じくらいの時間（部品が無いメールでもハッシュを計算する）。
//   2 段階を付けた人は、まだ入らず待ちの印（pending・5 分）を受け取る。6 けたで入るのは K-302。
//   ログインの部品（better-auth）・生の DB・外への送信は直に使わない（部品は @kaname/auth の中だけ・境界 B2・関門 C2）。
//   ログにメール・パスワード・ログインの印・待ちの印を出さない（K301-API-021）
import { countryOf } from "@kaname/auth/device";
import { EMAIL_RE, normalizeEmail, signInWithLock, type SignInResult } from "@kaname/auth/signup";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { kindOf, memberGoneCheck, reply, type LoginDeps } from "./shared.js";

export type { LoginDeps } from "./shared.js";

/** ロックの長さ（秒）。app.login_failed の 15 分と同じ（待つ秒数をこれより大きく言わない） */
const LOCK_SEC = 15 * 60;

const filled = (v: unknown): boolean => typeof v === "string" && v !== "";

/** 失敗の答え：ロック（429）か残り回数つきの 401。登録していないメールも同じ形（有る無しを漏らさない・D-042） */
function failed(r: SignInResult): HookReply {
  if (r.lockedUntil) {
    const sec = Math.ceil((r.lockedUntil.getTime() - Date.now()) / 1000);
    return reply(429, "E-AUTH-002", { retry_after_sec: Math.min(LOCK_SEC, Math.max(1, sec)), remaining: 0 });
  }
  const remaining = r.remaining ?? 0;
  return reply(401, "E-AUTH-001", {
    message: `メールアドレスかパスワードが違います。あと ${remaining} 回で 15 分ロックします`,
    remaining,
  });
}

export function loginFeature(d: LoginDeps) {
  /** 前処理（入口の strict な形の確かめより前）：メールかパスワードが無い・空なら 422・E-VAL-008（DB を引かない・失敗に数えない） */
  const input = (raw: unknown): { input: Record<string, unknown> } | { reply: HookReply } => {
    const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    if (!filled(b["email"]) || !filled(b["password"])) return { reply: reply(422, "E-VAL-008") };
    return { input: b };
  };

  /** 止めで断られた：人・会社の止めは 403 と目録の文、抜けたは 403・E-AUTH-007（運営の連絡先つき）、止めの確かめができなかったは 503・E-PAGE-003 */
  const blocked = (b: { code: string; status: number }): HookReply =>
    reply(b.status, b.code, b.code === "E-AUTH-007" ? { detail: { ops_email: d.config.opsEmail } } : {});

  /** 入ったのに会社の人が 1 人も無い：その場で閉じて 403・E-AUTH-007（ログインの印を渡さない）。
   *  抜けた人は止めの 1 か所（K-303）が先に断るので、ここに来るのは会社に属していない利用者（登録の途中など）だけ */
  const memberGone = memberGoneCheck(d);

  const signIn = async (a: HookArgs): Promise<HookReply> => {
    // パスワードは入口の正規化（前後の空白を落とす）の前の値を使う（打ったとおりに比べる・K301-API-012）
    const raw = (await a.c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const password = typeof raw["password"] === "string" ? raw["password"] : String(a.input["password"] ?? "");
    const email = normalizeEmail(String(a.input["email"] ?? ""));
    if (!EMAIL_RE.test(email)) return reply(422, "E-VAL-004", { detail: { field: "email" } });
    const ua = a.c.req.header("user-agent");
    try {
      const r = await signInWithLock(d.auth, d.appPool, email, password, ua, {
        authPool: d.authPool,
        country: countryOf(a.c.req.raw.headers),
      });
      if (r.invalidEmail) return reply(422, "E-VAL-004", { detail: { field: "email" } });
      // 止めの 1 か所（K-303・ログインの部品の session.create.before）が断った：その status と id と目録の文をそのまま返す（印は渡さない）
      if (r.blocked) return blocked(r.blocked);
      if (!r.ok) return failed(r);
      if (r.twoFactor) {
        if (!r.pending) throw new Error("2 段階の待ちの印が無い");
        return { status: 201, body: { data: { token: null, two_factor: true, pending: r.pending } } };
      }
      if (!r.token) throw new Error("ログインの印が無い");
      if (await memberGone(r.token, ua)) return reply(403, "E-AUTH-007", { detail: { ops_email: d.config.opsEmail } });
      return { status: 201, body: { data: { token: r.token, two_factor: false, pending: null } } };
    } catch (e) {
      // DB が落ちた・セッションを写す所で失敗した：パスワードの失敗には数えず 503（K-1106・部品の側で半分だけ入ったセッションは消してある）
      console.error(`[login] パスワードのログインの途中で落ちた（${kindOf(e)}）`);
      return reply(503, "E-PAGE-003");
    }
  };

  return { input, signIn };
}
