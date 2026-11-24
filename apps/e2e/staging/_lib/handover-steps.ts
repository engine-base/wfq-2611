// 統合テスト（staging）の段 9 の画面の 1 歩（K-418）：メールのリンクで入る（付けるまで進めないの 2 段階を画面で付ける）・人を招く（K-420）・
//   招待のリンクで参加する（K-335）・担当者を選んでチケットを作る・引き継いでもらう（K-411）・承認待ちで受ける（K-412）・配る（K-415）。
//   操作と選び方は中間テスト（apps/web/tests/skeleton の k416・k417 と _lib/f8-flow.ts）と同じ。写しを置いた訳は steps.ts と同じ
//   （あちらは DB・手元の受け箱・送り元の付け替えを前提にする。staging では DB を読まない・PM の決め 2）。
//   環境の値は読まない（住所と鍵は site.ts と resend.ts だけが読む）。ここは進むための 1 歩だけを持ち、行の期待結果の確かめは試験に書く。
//   画面の名前は K-319・K-335・K-411・K-412・K-415・K-420 の仕様の表とモックから（実装から書かない）。staging の最初の回で違えば、ここを直す
import { createHmac } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { countTo, latestTo, readMail, type MailRecord } from "./resend";
import { h1, pathOf, type Person } from "./steps";

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const apiPath = (url: string): string => new URL(url).pathname;

// ---------------------------------------------------------------- メール（Resend の記録）
/** その宛先に n 通目が記録に出るまで待ち（一覧は 2 秒おき・K-65 の決め）、新しいほうの 1 通を読む */
export async function nthMailTo(to: string, n: number): Promise<MailRecord> {
  await expect
    .poll(() => countTo(to), {
      message: `その宛先への ${n} 通目が Resend の記録に出る`,
      timeout: 90_000,
      intervals: [2_000],
    })
    .toBeGreaterThanOrEqual(n);
  const hit = await latestTo(to);
  if (!hit) throw new Error("Resend の記録にその宛先の 1 通が無い");
  return readMail(hit.id);
}
/** 本文の中の招待のリンク（/invite/<印>）。無ければ null（印は記録に出さない：伏せる台本 scrub.mjs が /invite/ の形で伏せる） */
export function inviteLink(m: Pick<MailRecord, "text" | "html">): string | null {
  const hit = /https?:\/\/[^\s"'<>]+\/invite\/[A-Za-z0-9_-]+/.exec(`${m.text}\n${m.html}`);
  return hit ? hit[0] : null;
}

// ---------------------------------------------------------------- 付けるまで進めない（K-319・K-321）
/** 認証アプリの 6 けた（RFC 6238・SHA-1・30 秒）。鍵は画面に出た字（4 字ずつの空白を除く）。どこにも書き出さない */
export function totpOf(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretBase32.replace(/[\s=]/g, "").toUpperCase();
  let bits = "";
  for (const c of clean) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const num = (mac.readUInt32BE(off) & 0x7fffffff) % 1_000_000;
  return String(num).padStart(6, "0");
}
/** /mfa-setup に止まったら、認証アプリを画面で付けてから先へ進む（staging は DB で入り方を足せない）。止まらなければ何もしない */
export async function throughTwoFactor(page: Page, p: Person): Promise<void> {
  if (pathOf(page) !== "/mfa-setup") return;
  await page.locator(".k-auth-choice", { hasText: "認証アプリ" }).click();
  const check = page.getByRole("dialog", { name: "本人か確かめます" });
  await check.getByLabel("パスワード", { exact: true }).fill(p.password);
  await check.getByRole("button", { name: "確かめる" }).click();
  const totp = page.getByRole("dialog", { name: "2 段階認証を付ける" });
  const secret = (await totp.locator(".k-auth-secret").innerText()).trim();
  await page.getByLabel("確認のコード 1 けた目").click();
  await page.keyboard.type(totpOf(secret));
  await page
    .getByRole("dialog", { name: "バックアップコード" })
    .getByRole("button", { name: "保存したので閉じる" })
    .click();
  await expect
    .poll(() => pathOf(page), { message: "付けるまで進めないの画面を離れる", timeout: 30_000 })
    .not.toBe("/mfa-setup");
}
/** メールのリンクを開く →「登録できました」→「続ける」→（2 段階を付ける）→ 使い始めの画面（/tickets） */
export async function enterWithTwoFactor(page: Page, link: string, p: Person): Promise<void> {
  expect((await page.goto(link))?.status(), "リンクの先が開ける").toBe(200);
  await expect(h1(page, "登録できました")).toBeVisible();
  await page.getByRole("button", { name: "続ける", exact: true }).click();
  await expect.poll(() => pathOf(page), { message: "続けた先へ移る", timeout: 30_000 }).not.toBe("/verify-email");
  await throughTwoFactor(page, p);
  await expect.poll(() => pathOf(page), "使い始めの画面（チケットの画面）へ入る").toBe("/tickets");
}

// ---------------------------------------------------------------- 招く・参加する（K-420・K-335）
export type InviteRole = "メンバー" | "マネージャー";
/** メンバーの画面の「＋ 招く」→ メールを足す → 役割 →「招く」。「〇〇 に招待を送りました」が出るまで待つ */
export async function inviteOnScreen(page: Page, email: string, role: InviteRole): Promise<void> {
  expect((await page.goto("/members"))?.status(), "メンバーの画面が開ける").toBe(200);
  await page.getByRole("button", { name: "＋ 招く", exact: true }).click();
  const d = page.getByRole("dialog", { name: "招く" });
  await d.getByRole("textbox", { name: /^メール/ }).fill(email);
  await d.getByRole("button", { name: "足す", exact: true }).click();
  await d.getByRole("combobox", { name: "役割" }).selectOption({ label: role });
  await d.getByRole("button", { name: "招く", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `${email} に招待を送りました` })).toBeVisible();
}
/** 招待のリンクを開き、名前とパスワードで「参加する」→（2 段階を付ける）→ 中の画面へ入る */
export async function joinByInvite(page: Page, link: string, p: Person): Promise<void> {
  expect((await page.goto(link))?.status(), "招待のリンクの先が開ける").toBe(200);
  await page.getByLabel("名前", { exact: true }).fill(p.name);
  await page.getByLabel("パスワード", { exact: true }).fill(p.password);
  await page.getByRole("button", { name: "参加する" }).click();
  await expect.poll(() => pathOf(page), { message: "招待の画面を離れる", timeout: 30_000 }).not.toMatch(/^\/invite\//);
  await throughTwoFactor(page, p);
  await expect.poll(() => pathOf(page), "中の画面へ入る").toMatch(/^\/(tickets|setup)/);
}

// ---------------------------------------------------------------- チケット・渡す・受ける・配る（K-411・K-412・K-415）
const jst = (days: number): string => new Date(Date.now() + 9 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
/** 左のメニューの「チケットを作る」から、担当者を選んで作る → 詳細へ。できたチケットの id を返す */
export async function createTicketFor(page: Page, title: string, assignee: string, purpose: string): Promise<string> {
  await page.goto("/tickets");
  await page
    .getByRole("navigation", { name: "メニュー", exact: true })
    .getByRole("button", { name: "チケットを作る" })
    .click();
  await expect(page.getByRole("region", { name: "チケットを作る" })).toBeVisible();
  await page.getByRole("textbox", { name: "題名", exact: true }).fill(title);
  await page.getByRole("combobox", { name: "担当者", exact: true }).click();
  await page.getByRole("option", { name: assignee, exact: true }).click();
  await page.getByRole("textbox", { name: "期限", exact: true }).fill(jst(3));
  await page.getByRole("textbox", { name: "目的", exact: true }).fill(purpose);
  await page.getByRole("textbox", { name: "完了の条件", exact: true }).fill("先方が受け取った");
  await page.getByRole("button", { name: "作る", exact: true }).click();
  await expect.poll(() => pathOf(page), "作ったら詳細へ移る").toMatch(/^\/tickets\/[0-9a-f-]{36}$/);
  await expect(h1(page, title)).toBeVisible();
  return pathOf(page).split("/").pop()!;
}
export const openTicket = async (page: Page, id: string, title: string): Promise<void> => {
  expect((await page.goto(`/tickets/${id}`))?.status()).toBe(200);
  await expect(h1(page, title)).toBeVisible();
};
export const openQueue = async (page: Page): Promise<void> => {
  expect((await page.goto("/approvals"))?.status()).toBe(200);
  await expect(h1(page, "承認待ち")).toBeVisible();
};
export const bandOf = (page: Page, title: RegExp): Locator =>
  page.locator(".k-detail-bands .k-band").filter({ has: page.locator(".k-band-title", { hasText: title }) });
export const queueRow = (page: Page, title: string): Locator => page.locator("tr.k-hnd-row").filter({ hasText: title });
/** 押して、その口（method・道が re に合う）の答えの番号を返す */
async function pressAndAnswer(page: Page, button: Locator, method: string, re: RegExp): Promise<number> {
  const res = page.waitForResponse((r) => r.request().method() === method && re.test(apiPath(r.url())));
  await button.click();
  return (await res).status();
}
export const CREATE_RE = /^\/api\/v1\/tickets\/[^/]+\/handovers$/;
export const ANSWER_RE = /^\/api\/v1\/ticket_handovers\/[^/]+$/;
export const CLAIM_RE = /^\/api\/v1\/ticket_handovers\/[^/]+\/claim$/;
/** 担当者 ▾ → 相手を選ぶ小窓で人かグループ（"group" は最初のグループ）を押す（開いている詳細の上で） */
async function pickTarget(page: Page, to: string | "group"): Promise<void> {
  await page.getByRole("button", { name: /^担当者 .+（担当者を変える）$/ }).click();
  const pick = page.getByRole("dialog", { name: "担当者を選ぶ" });
  if (to === "group")
    await pick.getByRole("list", { name: "グループ", exact: true }).getByRole("button").first().click();
  else await pick.getByRole("button", { name: new RegExp(`^${esc(to)}`) }).click();
}
/** 引き継いでもらう（渡す）。渡す口の答えの番号を返す */
export async function passOnScreen(page: Page, to: string, reason: string): Promise<number> {
  await pickTarget(page, to);
  const d = page.getByRole("dialog", { name: "引き継いでもらう" });
  await d.getByRole("textbox", { name: /^理由/ }).fill(reason);
  return pressAndAnswer(page, d.getByRole("button", { name: "引き継いでもらう", exact: true }), "POST", CREATE_RE);
}
/** 配る（人かグループ）。配る口の答えの番号を返す */
export async function distributeOnScreen(page: Page, to: string | "group", reason: string): Promise<number> {
  await pickTarget(page, to);
  const d = page.getByRole("dialog", { name: "配る" });
  await d.getByRole("textbox", { name: /^理由/ }).fill(reason);
  return pressAndAnswer(page, d.getByRole("button", { name: "配る", exact: true }), "POST", CREATE_RE);
}
/** 承認待ちの行の右の主のボタン（受ける・自分が持つ）。口の答えの番号を返す */
export async function answerInQueue(page: Page, title: string, label: "受ける" | "自分が持つ"): Promise<number> {
  const re = label === "受ける" ? ANSWER_RE : CLAIM_RE;
  return pressAndAnswer(
    page,
    queueRow(page, title).getByRole("button", { name: label, exact: true }),
    label === "受ける" ? "PATCH" : "POST",
    re,
  );
}
