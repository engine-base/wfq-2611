// 段 9（F8 渡す・配る）の中間テストの道具（K-416 が持ち込む・K-417 も読む）：同じ会社の 2 人目を自分のブラウザで入れる・子チケットを口で作る・
//   画面で「引き継いでもらう」「受ける／断る」を通す 1 歩・DB を読む（渡しの行・担当者・受け箱の行）・返事の期限を DB で動かす。
//   口は網の手前で差し替えない。人の 1 人目は newcomer.ts（画面とメール）、2 人目は prep.ts の teammate（招待の行 → 受ける口）にメールを足してブラウザを持たせる。
//   探したが無かった：目録（03_architecture/catalog.json）と apps/web/tests/_lib に、2 人目をブラウザで動かす道具・渡しの行を読む道具は無い。
//   似たもの：prep.ts の teammate（ブラウザもメールも返さない）・api.ts の loginAs（印を持たせるだけ）。prep.ts・api.ts は変えない（読む試験が多い・K-64 の申し送り）。
//   画面の字は K-411・K-412・K-413 の仕様の表とモック /dev/mock/f8 から（実装から書かない）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, type Browser, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
import { admin, loginAs } from "./api";
import type { Newcomer } from "./newcomer";
import { asPerson, teammate, type TicketSections } from "./prep";

/** 2 人目（同じ会社のメンバー）。自分のブラウザ（別の印・別の文脈）を持つ */
export interface Mate {
  memberId: string;
  token: string;
  email: string;
  name: string;
  ctx: BrowserContext;
  page: Page;
}
/** 同じ会社の 2 人目を作り、別のブラウザの文脈でログインした画面を返す（送り元の付け替えはしない：印を出した口と同じ送り元で使う） */
export async function mateOf(browser: Browser, me: Newcomer, name: string): Promise<Mate> {
  const t = await teammate(me, name);
  const [u] = await admin<{ email: string }>(
    `select u.email from members m join kaname_auth."user" u on u.id = m.auth_user_id where m.id = $1`,
    [t.memberId],
  );
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, t.token);
  expect((await page.goto("/tickets"))?.status(), "2 人目がチケットの画面を開ける").toBe(200);
  return { memberId: t.memberId, token: t.token, email: u!.email, name, ctx, page };
}

/** 子チケットを口で 1 枚作る（親を付ける・担当は assignee）。作る画面は K-60 が持つ */
export async function childOf(
  page: Page,
  me: Newcomer,
  parentId: string,
  title: string,
  assigneeMemberId: string,
  sections: TicketSections,
): Promise<string> {
  const [s] = await admin<{ s: string }>("select scope_id as s from tickets where id = $1", [parentId]);
  const kinds = await asPerson(page, me.token, "GET", "/ticket_kinds");
  const kind = ((kinds.data as unknown as { id: string; name: string }[] | null) ?? []).find(
    (k) => k.name === "タスク",
  );
  if (!kind) throw new Error(`チケットの種類「タスク」が無い（口は ${kinds.status}）`);
  const due = new Date(Date.now() + 9 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 10);
  const r = await asPerson(page, me.token, "POST", "/tickets", {
    scope_id: s!.s,
    kind_id: kind.id,
    title,
    assignee_member_id: assigneeMemberId,
    parent_ticket_id: parentId,
    due_on: due,
    sections,
  });
  if (r.status !== 201) throw new Error(`子チケットを作る口が ${r.status}`);
  const id = (r.data?.["id"] ?? (r.data?.["ticket"] as Record<string, unknown> | undefined)?.["id"]) as
    string | undefined;
  if (!id) throw new Error("作った子チケットの id が答えに無い");
  return id;
}

// ---------------------------------------------------------------- 画面の 1 歩
/** 画面の「〇〇さん」の〇〇（姓と名の間の空白の前・空白が無ければ全部。K-411 の帯の字の出し方） */
export const shortOf = (name: string): string => name.split(/[\s\u3000]/)[0] ?? name;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 「〇〇さん」（姓でも名前全部でもよい） */
export const san = (name: string): RegExp => new RegExp(`(${esc(name)}|${esc(shortOf(name))})さん`);

export const openTicket = async (page: Page, ticketId: string, title: string): Promise<void> => {
  expect((await page.goto(`/tickets/${ticketId}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
};
export const openQueue = async (page: Page): Promise<void> => {
  expect((await page.goto("/approvals"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "承認待ち" })).toBeVisible();
};
/** 題名の下の帯（題で選ぶ） */
export const bandOf = (page: Page, title: RegExp): Locator =>
  page.locator(".k-detail-bands .k-band").filter({ has: page.locator(".k-band-title", { hasText: title }) });
/** 渡しの帯だけ（入れ物の直下の帯。「AI に任せる」「承認と実行」の帯は section の中にあるので数えない） */
export const handoverBands = (page: Page): Locator => page.locator(".k-detail-bands > .k-band");
/** 承認待ちの渡しの行（題名で選ぶ） */
export const queueRow = (page: Page, title: string): Locator => page.locator("tr.k-hnd-row").filter({ hasText: title });
export const panelAssignee = (page: Page): Locator =>
  page.locator('aside[aria-label="チケットのパネル"] .k-hnd-assignee');

/** 口の答えを待つ（押した後に DB を読むと、口が書く前に読んでしまう・時間では待たない） */
export const answered = (page: Page, method: string, re: RegExp): Promise<Response> =>
  page.waitForResponse((r) => r.request().method() === method && re.test(new URL(r.url()).pathname));
export const CREATE_RE = /^\/api\/v1\/tickets\/[^/]+\/handovers$/;
export const ANSWER_RE = /^\/api\/v1\/ticket_handovers\/[^/]+$/;
export const WITHDRAW_RE = /^\/api\/v1\/ticket_handovers\/[^/]+\/withdraw$/;
export const REMIND_RE = /^\/api\/v1\/ticket_handovers\/[^/]+\/remind$/;

export interface PassInput {
  reason: string;
  ask?: string;
  /** 一緒に切り替えるもの（子チケット）の印を付けるか。既定は付ける（決まりは「毎回聞く」・D-148.11） */
  children?: boolean;
}
/** 詳細の担当者 ▾ → 相手を選ぶ小窓で相手 → 引き継いでもらう小窓 → 引き継いでもらう。口の答えの番号を返す（開いている詳細の上で） */
export async function passOnScreen(page: Page, to: string, input: PassInput): Promise<number> {
  await page.getByRole("button", { name: /^担当者 .+（担当者を変える）$/ }).click();
  const pick = page.getByRole("dialog", { name: "担当者を選ぶ" });
  await pick.getByRole("button", { name: new RegExp(`^${esc(to)}`) }).click();
  const d = page.getByRole("dialog", { name: "引き継いでもらう" });
  await d.getByRole("textbox", { name: /^理由/ }).fill(input.reason);
  if (input.ask) await d.getByRole("textbox", { name: /^お願い/ }).fill(input.ask);
  const carry = d.getByRole("checkbox", { name: /^子チケット/ });
  if ((await carry.count()) > 0) await carry.setChecked(input.children ?? true);
  const res = answered(page, "POST", CREATE_RE);
  await d.getByRole("button", { name: "引き継いでもらう", exact: true }).click();
  return (await res).status();
}
/** 承認待ちの行の「受ける」（開いている承認待ちの上で）。口の答えの番号を返す */
export async function acceptInQueue(page: Page, title: string): Promise<number> {
  const res = answered(page, "PATCH", ANSWER_RE);
  await queueRow(page, title).getByRole("button", { name: "受ける", exact: true }).click();
  return (await res).status();
}
/** 承認待ちの行・詳細の帯の「断る」→ 断る小窓に理由 →「断る」。口の答えの番号を返す */
export async function declineVia(page: Page, from: Locator, reason: string): Promise<number> {
  await from.getByRole("button", { name: "断る", exact: true }).click();
  const d = page.getByRole("dialog", { name: "断る" });
  await d.getByRole("textbox", { name: /^断る理由/ }).fill(reason);
  const res = answered(page, "PATCH", ANSWER_RE);
  await d.getByRole("button", { name: "断る", exact: true }).click();
  return (await res).status();
}

// ---------------------------------------------------------------- DB を読む・動かす
export interface HandoverRow {
  id: string;
  kind: string;
  state: string;
  from_member_id: string;
  to_member_id: string | null;
  reason: string | null;
  decline_reason: string | null;
  reply_due: Date | null;
  decided_at: Date | null;
}
/** DB：そのチケットの渡しの行（古い順） */
export const handoversOf = (ticketId: string): Promise<HandoverRow[]> =>
  admin<HandoverRow & Record<string, unknown>>(
    `select id, kind, state, from_member_id, to_member_id, reason, decline_reason, reply_due, decided_at
       from ticket_handovers where ticket_id = $1 and deleted_at is null order by created_at, id`,
    [ticketId],
  );
/** DB：チケットの担当者の member id */
export const assigneeOf = async (ticketId: string): Promise<string | null> =>
  (await admin<{ a: string | null }>("select assignee_member_id as a from tickets where id = $1", [ticketId]))[0]?.a ??
  null;
/** DB：その人の受け箱の行（inapp）のうち、そのチケットの渡しの知らせの種類（古い順）。種類の名前は K-402〜K-410 が決める（handover. で始まる） */
export const handoverNotesOf = async (memberId: string, ticketId: string): Promise<string[]> =>
  (
    await admin<{ k: string }>(
      `select event_kind_id as k from notifications
        where member_id = $1 and channel_id = 'inapp' and event_kind_id like 'handover.%'
          and payload->>'ticket_id' = $2 and deleted_at is null order by created_at, id`,
      [memberId, ticketId],
    )
  ).map((r) => r.k);
/** DB：渡しの返事の期限を「いまから ago 前」に置く（期限切れを待たずに作る・D-128.130）。動かした行の数 */
export async function replyDueAgo(handoverId: string, ago: string): Promise<number> {
  return (
    await admin<{ id: string }>(
      "update ticket_handovers set reply_due = now() - $2::interval where id = $1 returning id",
      [handoverId, ago],
    )
  ).length;
}
