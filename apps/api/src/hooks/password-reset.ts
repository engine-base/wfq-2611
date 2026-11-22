// 再設定のメールを頼む（K-313）・新しいパスワードを決める（K-314）の契約の口の振る舞い。中身は apps/api/src/features/F1/password-reset/。上限・入力の形は契約の入口（op.ts）が先に確かめる
import type { Hook } from "../contract/deps.js";
import { passwordResetFeature, type PasswordResetDeps } from "../features/F1/password-reset/index.js";
import { defineHooks } from "./registry.js";

export function passwordResetHooks(d: PasswordResetDeps): Record<string, Hook> {
  const f = passwordResetFeature(d);
  // 冪等キーは使わない：答えは誰にでも同じで、器に残すものが無い（登録の有無を残さない）
  // 決める口も冪等キーを使わない：リンクは 1 回だけ使え、2 回目は 410（器に残すと 2 回目に 201 を返してしまう）。リンクが DB に無い（でたらめ・空）は 409 E-PAGE-006（K-638）
  return {
    requestPasswordReset: { before: f.request, noIdempotency: true },
    resetPassword: { before: f.reset, noIdempotency: true },
  };
}

export const register = defineHooks({
  name: "passwordResetHooks",
  make: (d) =>
    passwordResetHooks({
      auth: d.auth,
      actions: d.actions,
      authPool: d.authPool,
      appPool: d.appPool,
      ...(d.mailer ? { mailer: d.mailer } : {}),
      config: d.config,
    }),
  // fuzz の的は送出先を差さず（外に送らずログの道）、画面の住所を持たない（基の住所に落ちる道を回る）
  fuzz: (d) =>
    passwordResetHooks({
      auth: d.auth,
      actions: d.actions,
      authPool: d.authPool,
      appPool: d.appPool,
      config: { baseUrl: d.config.baseUrl, webBaseUrl: null },
    }),
});
