// 預けたらその場で 1 回ログインだけ試す（T-B-38・D-117.1・D-117.6・D-119.2）。
//   Kaname から「login_check」の仕事を受け取ったら、AI は起こさず、Bridge 自身が専用のブラウザ（本人の PC の Chrome・Bridge の置き場のログインの状態）で
//   そのサービスを開き、預けたログイン名とパスワードを入れて、入れたらそのまま出る（ほかの操作はしない）。
//   鍵は withCredential の中だけ（終わったら消える・ディスクに書かない・AI に渡さない）。結果は種類と理由だけ（値を含まない）。
//   入れなければ理由：パスワードが違う／2 段階が要る／CAPTCHA／開けない／ログインの欄が無い。何度も試さない（1 回で終わり）。
//   本人の画面で動くのが見える（headless にしない・D-119.6）。試験だけ headless
//   K-354：開く先は仕事の prompt（Kaname が使える場所から決めた URL）。取り出しは契約の口に「入れる場所＝開く先の名前」で頼み（使える場所の外なら口が断る）、
//   ログインの欄に入れる直前にも、いまの画面の名前が使える場所の中かを確かめる（外へ移っていたら入れずに止める・D-128.57 ②）
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostAllowed, hostnameOf } from "./host";
import { CredentialError, redact, withCredential, type Credential, type VaultDeps } from "./vault";
import { ANSWER_WAIT_MS, askPerson, totpCode } from "./two-factor";

export type LoginCheckState =
  "ok" | "bad_password" | "needs_2fa" | "bad_code" | "captcha" | "unreachable" | "no_form" | "stopped" | "no_answer";
export interface LoginCheckResult {
  state: LoginCheckState;
  /** 本人に見せる理由と一手（値は含まない） */
  detail: string;
}
export interface LoginCheckDeps extends VaultDeps {
  /** Bridge の置き場（ログインの状態＝browser-profile をここに残す・D-117.4） */
  dataDir: string;
  /** 試験だけ true（本人の画面では見えるように動かす） */
  headless?: boolean;
  /** 全体の上限（既定：返事を待つ上限 ＋ 2 分） */
  timeoutMs?: number;
  /** 本人の返事（コード・承認）を待つ上限（既定 10 分・D-117.5） */
  answerWaitMs?: number;
  /** 返事を取りに行く間隔（既定 2 秒） */
  pollMs?: number;
}

// playwright-core の、ここで使う分だけの型（直接の依存に足さず、@playwright/mcp が持つものを借りる）
interface Locator {
  first(): Locator;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  fill(v: string): Promise<void>;
  press(k: string): Promise<void>;
  click(o?: { timeout?: number }): Promise<void>;
  getAttribute(n: string): Promise<string | null>;
  nth(i: number): Locator;
  innerText(): Promise<string>;
}
interface Page {
  goto(url: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  locator(sel: string): Locator;
  url(): string;
  waitForLoadState(s: string, o?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  frames(): { url(): string }[];
  content(): Promise<string>;
}
interface Context {
  pages(): Page[];
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Chromium {
  launchPersistentContext(dir: string, o: Record<string, unknown>): Promise<Context>;
}
let pwCache: { chromium: Chromium } | null = null;
/** @playwright/mcp が持つ playwright-core を借りる（Bridge 専用のブラウザと同じ Chrome・同じログインの状態） */
export function playwright(): { chromium: Chromium } | null {
  if (pwCache) return pwCache;
  try {
    const mcp = require.resolve("@playwright/mcp/package.json");
    pwCache = createRequire(mcp)("playwright-core") as { chromium: Chromium };
    return pwCache;
  } catch {
    return null;
  }
}

const USER_SEL = [
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="mail" i]',
  'input[name*="account" i]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[id*="mail" i]',
  'input[type="text"]',
  'input[type="tel"]',
];
const PASS_SEL = 'input[type="password"]';
const OTP_SEL = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[name*="code" i]',
  'input[name*="token" i]',
  'input[name*="mfa" i]',
  'input[name*="2fa" i]',
  'input[id*="otp" i]',
  'input[id*="code" i]',
  'input[id*="mfa" i]',
];
const CAPTCHA_SEL = [
  'iframe[src*="recaptcha" i]',
  'iframe[src*="hcaptcha" i]',
  'iframe[src*="turnstile" i]',
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  '[id*="captcha" i]',
  '[class*="captcha" i]',
];
const CAPTCHA_FRAME = /recaptcha|hcaptcha|turnstile|captcha/i;

/** 開く先：仕事の prompt が http(s) の URL ならそのまま。名前だけなら https://<名前>/。空・ほかの形（ほかの scheme・名前に読めない）は null。
 *  字は読む前に変えない（NFKC などをかけない） */
export function targetUrl(prompt: string): string | null {
  const s = prompt.trim();
  if (/^https?:\/\//i.test(s)) return hostnameOf(s) === null ? null : s;
  if (s === "" || /[\s/]/.test(s) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null;
  return hostnameOf(s) === null ? null : `https://${s}/`;
}

async function visible(page: Page, sels: string[]): Promise<Locator | null> {
  for (const s of sels) {
    const l = page.locator(s);
    const n = await l.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 5); i++) {
      const x = l.nth(i);
      if (await x.isVisible().catch(() => false)) return x;
    }
  }
  return null;
}
async function hasCaptcha(page: Page): Promise<boolean> {
  if (page.frames().some((f) => CAPTCHA_FRAME.test(f.url()))) return true;
  return (await visible(page, CAPTCHA_SEL)) !== null;
}
/** ログイン名の欄：パスワードの欄より前にある見える文字の欄（無ければ null＝パスワードだけの画面） */
async function userField(page: Page): Promise<Locator | null> {
  return visible(page, USER_SEL);
}
/** 画面に見えている文字（script や隠れた中身を含まない。2026-10-03：page.content() は承認後も「承認」を含んでいた） */
const bodyText = async (page: Page): Promise<string> =>
  page
    .locator("body")
    .innerText()
    .catch(() => "");
const settle = async (page: Page): Promise<void> => {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
};

const TWO_FACTOR_LABEL: Record<Credential["twoFactor"], string> = {
  none: "",
  totp: "認証アプリ",
  sms: "SMS",
  email: "メール",
  push: "スマホ",
};
const PUSH_WAIT_MS = 60_000;
const PUSH_TEXT = /承認|approve|確認してください|notification|通知/i;
const NO_ANSWER = {
  state: "no_answer" as const,
  detail: "10 分返事が無かったので止めました。いるときに「もう一度試す」を押してください（勝手には試しません）",
};

/** 仕事と情報の id（頼む・待つの口に要る） */
interface CheckIds {
  jobId: string;
  credentialId: string;
}

/** 結果の文の上限（K-355 の reportCredentialCheck が detail を 400 字までで受ける。超えると 422 で結果が残らない） */
export const DETAIL_MAX = 400;
/** 文に入れる名前 1 つの上限・並べる使える場所の数 */
const NAME_MAX = 60;
const PLACES_SHOWN = 3;
/** 字（コードポイント）で数えて n 字に収める。切ったら末尾を … にする */
export function clip(s: string, n: number): string {
  const chars = [...s];
  return chars.length <= n ? s : `${chars.slice(0, n - 1).join("")}…`;
}

/** 入れる直前の確かめ：いまの画面の名前が使える場所の外なら、入れずに止める理由を返す（中なら null） */
function outside(page: Page, c: Credential): LoginCheckResult | null {
  const now = page.url();
  if (hostAllowed(now, c.destinations)) return null;
  const shown = c.destinations.slice(0, PLACES_SHOWN).map((d) => clip(d, NAME_MAX));
  const rest = c.destinations.length - shown.length;
  const places = shown.length ? `${shown.join("・")}${rest > 0 ? ` ほか ${rest} 件` : ""}` : "なし";
  const screen = clip(hostnameOf(now) ?? "名前の分からない画面", NAME_MAX);
  return {
    state: "stopped",
    detail: clip(
      `使える場所（${places}）の外の画面（${screen}）に移ったので、入れずに止めました。必要なら使える場所に足してください`,
      DETAIL_MAX,
    ),
  };
}

/** 2 段階の画面に来た（コードの欄がある・スマホの承認を待っている）ときの扱い（D-117.2〜D-117.5・D-017.2・D-017.4） */
async function secondFactor(
  page: Page,
  c: Credential,
  d: LoginCheckDeps,
  ids: CheckIds,
  otp: Locator | null,
): Promise<LoginCheckResult> {
  const service = c.name || hostnameOf(page.url()) || "サービス";
  const ask = {
    apiBase: d.apiBase,
    sessionId: d.sessionId,
    ...(d.answerWaitMs ? { answerWaitMs: d.answerWaitMs } : {}),
    ...(d.pollMs ? { pollMs: d.pollMs } : {}),
  };
  if (c.twoFactor === "none")
    return {
      state: "needs_2fa",
      detail:
        "2 段階認証のコードを求められました。2 段階の種類を選んで預け直してください（認証アプリは鍵から自動で入れます）",
    };
  if (c.twoFactor === "push") {
    // スマホで承認：本人に頼み、承認したと言ったらサービスが進むのを待つ
    const ok = await askPerson(
      ask,
      ids.jobId,
      ids.credentialId,
      "approve",
      `${service} のログインをスマホで承認してください`,
    );
    if (!ok) return NO_ANSWER;
    const until = Date.now() + PUSH_WAIT_MS;
    while (Date.now() < until) {
      await settle(page);
      const text = await bodyText(page);
      if (!(await visible(page, [PASS_SEL])) && !(await visible(page, OTP_SEL)) && !PUSH_TEXT.test(text))
        return { state: "ok", detail: "ログインできました（スマホで承認・入れたらそのまま出ました）" };
      await page.waitForTimeout(2_000);
    }
    return {
      state: "bad_code",
      detail: "承認が確認できませんでした。スマホで承認してから「もう一度試す」を押してください",
    };
  }
  if (!otp)
    return {
      state: "needs_2fa",
      detail: "2 段階認証のコードの欄が見つかりませんでした。ログイン画面の URL を入れて預け直してください",
    };
  let code: string | null;
  if (c.twoFactor === "totp") {
    if (!c.totpSecret)
      return {
        state: "needs_2fa",
        detail: "認証アプリの鍵を預かっていません。登録時に出た秘密鍵を入れて預け直してください",
      };
    code = totpCode(c.totpSecret);
  } else {
    code = await askPerson(
      ask,
      ids.jobId,
      ids.credentialId,
      "code",
      `${service} から届いた${TWO_FACTOR_LABEL[c.twoFactor]}のコードを入れてください`,
    );
    if (!code) return NO_ANSWER;
  }
  const away = outside(page, c);
  if (away) return away;
  await otp.fill(code);
  await otp.press("Enter");
  await settle(page);
  if (await visible(page, OTP_SEL))
    return c.twoFactor === "totp"
      ? { state: "bad_code", detail: "認証アプリのコードが通りませんでした。鍵（秘密鍵）を確かめて預け直してください" }
      : {
          state: "bad_code",
          detail: "入れたコードが通りませんでした。届いたコードを確かめて「もう一度試す」を押してください",
        };
  if (await visible(page, [PASS_SEL]))
    return {
      state: "bad_password",
      detail: "ログイン名かパスワードが違うようです（サービスが受け付けませんでした）。確かめて預け直してください",
    };
  return {
    state: "ok",
    detail:
      c.twoFactor === "totp"
        ? "ログインできました（認証アプリのコードは自動で入れました）"
        : "ログインできました（入れてもらったコードで通りました）",
  };
}

/** 1 回だけ入ってみる。値は c の中にだけある。戻り値・例外の文に値を混ぜない */
async function attempt(
  page: Page,
  url: string,
  c: Credential,
  d: LoginCheckDeps,
  ids: CheckIds,
): Promise<LoginCheckResult> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    return {
      state: "unreachable",
      detail: "サービスのページを開けませんでした。宛先（URL）を確かめて預け直してください",
    };
  }
  await settle(page);
  // ログインの欄が無ければ、ログインへのリンクを 1 回だけ押してみる
  if (!(await visible(page, [PASS_SEL])) && !(await userField(page))) {
    const link = page
      .locator(
        `a:has-text("ログイン"), a:has-text("Login"), a:has-text("Log in"), a:has-text("Sign in"), button:has-text("ログイン")`,
      )
      .first();
    if (await link.isVisible().catch(() => false)) {
      await link.click({ timeout: 5_000 }).catch(() => undefined);
      await settle(page);
    }
  }
  if (await hasCaptcha(page))
    return {
      state: "captcha",
      detail: "CAPTCHA（ロボットでない確認）が出るサービスです。一度ご自身でログインしてから預け直してください",
    };
  let pass = await visible(page, [PASS_SEL]);
  const user = await userField(page);
  if (!pass && !user)
    return {
      state: "no_form",
      detail: "ログインの欄が見つかりませんでした。ログイン画面の URL を入れて預け直してください",
    };
  const away = outside(page, c);
  if (away) return away;
  if (user) {
    await user.fill(c.login);
    if (!pass) {
      // 2 段の画面（先にログイン名 → 次へ → パスワード）
      await user.press("Enter");
      await settle(page);
      if (await hasCaptcha(page))
        return {
          state: "captcha",
          detail: "CAPTCHA（ロボットでない確認）が出るサービスです。一度ご自身でログインしてから預け直してください",
        };
      pass = await visible(page, [PASS_SEL]);
      if (!pass)
        return {
          state: "no_form",
          detail: "パスワードの欄が見つかりませんでした。ログイン画面の URL を入れて預け直してください",
        };
    }
  }
  const before = page.url();
  const moved = outside(page, c);
  if (moved) return moved;
  await pass!.fill(c.password);
  await pass!.press("Enter");
  await settle(page);
  if (await hasCaptcha(page))
    return {
      state: "captcha",
      detail: "CAPTCHA（ロボットでない確認）が出るサービスです。一度ご自身でログインしてから預け直してください",
    };
  const otp = await visible(page, OTP_SEL);
  if (otp) return secondFactor(page, c, d, ids, otp);
  const stillPass = await visible(page, [PASS_SEL]);
  if (stillPass && (page.url() === before || !(await visible(page, OTP_SEL))))
    return {
      state: "bad_password",
      detail: "ログイン名かパスワードが違うようです（サービスが受け付けませんでした）。確かめて預け直してください",
    };
  // スマホで承認のサービスは、パスワードの後に「承認してください」の画面で止まる（コードの欄は無い）
  if (c.twoFactor === "push" && PUSH_TEXT.test(await bodyText(page))) return secondFactor(page, c, d, ids, null);
  return { state: "ok", detail: "ログインできました（入れたらそのまま出ました）" };
}

/** Chrome のパスワードの保存を切る（D-117.6：鍵をディスクに書かない）。置き場の Preferences に書いてから開く */
function noPasswordManager(profileDir: string): void {
  const dir = join(profileDir, "Default");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "Preferences");
  let prefs: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      prefs = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      prefs = {};
    }
  }
  const profile = (prefs["profile"] ?? {}) as Record<string, unknown>;
  const next = {
    ...prefs,
    credentials_enable_service: false,
    credentials_enable_autosignin: false,
    profile: { ...profile, password_manager_enabled: false },
  };
  writeFileSync(file, JSON.stringify(next));
}

const NO_TARGET: LoginCheckResult = {
  state: "unreachable",
  detail: "開く先（使える場所）がありません。使える場所を確かめてください",
};

/** Kaname から受け取った login_check の仕事を 1 回だけこなす。target は仕事の prompt（開く先）。鍵は use の中だけ。ブラウザは必ず閉じる。
 *  開く先が無ければ Chrome を開かず、取り出しも頼まない。結果の文は必ず DETAIL_MAX 字に収める（Kaname の文を含む道も） */
export async function runLoginCheck(
  d: LoginCheckDeps,
  jobId: string,
  credentialId: string,
  target: string,
): Promise<LoginCheckResult> {
  const r = await checkOnce(d, jobId, credentialId, target);
  return { state: r.state, detail: clip(r.detail, DETAIL_MAX) };
}

async function checkOnce(
  d: LoginCheckDeps,
  jobId: string,
  credentialId: string,
  target: string,
): Promise<LoginCheckResult> {
  const url = targetUrl(target);
  const destination = hostnameOf(target);
  if (!url || !destination) return NO_TARGET;
  const pw = playwright();
  if (!pw) return { state: "stopped", detail: "専用のブラウザの部品が見つかりません。Bridge を入れ直してください" };
  const profileDir = join(d.dataDir, "browser-profile"); // AI の専用ブラウザと同じ置き場（通したログインを残す・D-117.4）
  mkdirSync(profileDir, { recursive: true });
  noPasswordManager(profileDir);
  const limit = d.timeoutMs ?? (d.answerWaitMs ?? ANSWER_WAIT_MS) + 120_000;
  let ctx: Context | null = null;
  try {
    return await withCredential(d, { jobId, credentialId, destination }, async (c) => {
      try {
        ctx = await pw.chromium.launchPersistentContext(profileDir, {
          channel: "chrome",
          headless: d.headless ?? false,
          viewport: null,
          timeout: 30_000,
          args: ["--no-first-run", "--no-default-browser-check"],
        });
      } catch {
        return {
          state: "stopped" as const,
          detail: "Chrome を開けませんでした。Chrome が入っているか、Bridge の自己診断で確かめてください",
        };
      }
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const timer = new Promise<LoginCheckResult>((r) =>
        setTimeout(
          () =>
            r({ state: "unreachable", detail: "ログインの画面が時間内に進みませんでした。もう一度預け直してください" }),
          limit,
        ),
      );
      const r = await Promise.race([attempt(page, url, c, d, { jobId, credentialId }), timer]);
      // 入れた欄を画面に残さない（タブの復元・保存の確認に値を渡さない）。ログインの状態（Cookie）は残る
      await page.goto("about:blank", { timeout: 5_000 }).catch(() => undefined);
      // 文の中に値が紛れていないことを最後に確かめる（無いはずだが、最後の砦）
      return { state: r.state, detail: redact(r.detail, c) };
    });
  } catch (e) {
    if (e instanceof CredentialError)
      return {
        state: "stopped",
        detail: `ログイン情報を受け取れませんでした（${clip(e.message, NAME_MAX * 2)}）${e.handoff ? `。${clip(e.handoff, NAME_MAX)}` : ""}`,
      };
    return { state: "stopped", detail: "ログインを試している途中で止まりました。預け直すともう一度試します" };
  } finally {
    if (ctx) await (ctx as Context).close().catch(() => undefined);
  }
}
