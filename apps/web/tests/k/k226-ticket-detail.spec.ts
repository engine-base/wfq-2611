// K-226「チケットの詳細の本文をキャンバス（TicketDetail）に合わせる」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：04_design/canvas/TicketDetail.dc.html。口は網の手前で差し替える（前からの土台 tests/features/F5/approve-complete.harness.ts）。
//   画面の形（実装の役が作る）：
//     .k-detail の中に 本文の箱 section.k-page（左）と 右のパネル aside[aria-label="チケットのパネル"]（幅 380）
//     本文の箱の中：article.k-detail-card（頭の行 .k-detail-meta・題名の行 header.k-page-head・帯・本文の道具の帯・区画）と
//       section[aria-label="子チケット・つながり"]
//     頭の行の部品：[data-part="kind"]（種別の札）・[data-part="number"]・番号をコピー・[data-part="created"]・[data-part="start"]・
//       [data-part="due"]・[data-part="stage"]（段の札）
//   キャンバスに在ってまだ使えない物は出し、グレーで押せない（D-145.9）。本当の値が無い字は空（嘘の値を書かない）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  TICKET,
  mockApi,
  openTicket,
  pending,
  ticketOf,
  withBand,
  type Band,
} from "../features/F5/approve-complete.harness";
import {
  DETAIL_INERT,
  DISABLED_OPACITY,
  DOC_TOOLS,
  LINE,
  RED_TEXT,
  ROOT,
  WHITE,
  WIDTHS,
  box,
  countWrites,
  cssOf,
  detailRows,
  expectInert,
  fidelityCompareTests,
  fidelityConfigTest,
  firstCharLeft,
  leftOf,
  opacityOf,
  overflowX,
} from "./detail-kit";
import { controlsOf } from "../_lib/row";

const SCOPE = "22222222-0000-4000-8000-000000000001";
const jst = (days = 0) => new Date(Date.now() + 9 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
/** 日本時間の日付 YYYY-MM-DD → 「MM/DD」（キャンバスどおり 2 桁・実行の記録の「11/01 09:00」と同じ書き方） */
const md = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;
const STAGE_NAME: Record<string, string> = {
  todo: "未着手",
  doing: "作業中",
  hold: "保留",
  checking: "確認中",
  awaiting_approval: "承認待ち",
  running: "実行中",
  done: "完了",
};
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const mdw = (ymd: string) => `${md(ymd)}（${WEEK[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}）`;

const card = (page: Page) => page.locator("article.k-detail-card");
const meta = (page: Page) => page.locator(".k-detail-meta");
const panel = (page: Page) => page.getByRole("complementary", { name: "チケットのパネル" });
const part = (page: Page, name: string) => meta(page).locator(`[data-part="${name}"]`);

/** 詳細の答え（前からの土台の ticketOf に、頭の行・パネルが読む値を重ねる） */
function detail(b: Band, ticket: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const base = ticketOf(b) as unknown as Record<string, Record<string, unknown>>;
  return withBand(b, {
    ...base,
    ticket: {
      ...base["ticket"],
      scope_id: SCOPE,
      created_at: "2026-10-30T08:44:00Z", // 日本時間 10/30 17:44
      start_on: "2026-10-30",
      ...ticket,
    },
    kind: { id: "k1", name: "タスク", color: "#186F69" },
    stage: { key: b.stage, name: STAGE_NAME[b.stage] ?? b.stage },
    ...extra,
  });
}

/** 前からの土台で開く。グループ（listScopes）だけ足す */
async function open(
  page: Page,
  b: Band = { stage: "doing" },
  ticket: Record<string, unknown> = {},
  width = 1440,
  runList?: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
  scopesFail = false,
) {
  const m = await mockApi(page, b);
  if (runList) await runs(page, runList); // 土台の差し替えより後に足す（後に足した差し替えが先に効く）
  m.on.ticket = () => ({ status: 200, body: { data: detail(b, ticket, extra) } });
  await page.route(/\/api\/v1\/scopes(\?|$)/, (route) =>
    route.fulfill(
      scopesFail
        ? {
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "internal", code: "E-PAGE-003" }),
          }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [{ id: SCOPE, name: "営業", ticket_prefix: "EG" }], meta: { limit: 200 } }),
          },
    ),
  );
  await openTicket(page, width);
  return m;
}

/** 実行の一覧の答えを差し替える（新しい順） */
async function runs(page: Page, list: Record<string, unknown>[]) {
  await page.route(`**/api/v1/tickets/${TICKET}/runs`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: list, meta: { limit: 50 } }),
    }),
  );
}
const run = (o: Record<string, unknown>) => ({
  id: "0193c5a0-0000-7000-8000-0000000e0101",
  ticket_id: TICKET,
  phase: "make",
  status: "done",
  by: { display_name: "高本" },
  pc: "live",
  silent: false,
  progress: null,
  stopped_reason: null,
  started_at: "2026-11-01T00:00:00Z", // 日本時間 11/01 09:00
  finished_at: "2026-11-01T00:12:00Z", // 日本時間 09:12
  checks: { state: "none" },
  ...o,
});

test("K226-UI-001 幅 1440：本文の箱（.k-page）と右のパネル（幅 380・左に 1px の線）が横に並び、本文は白いカード（線 #DDE2E9・角丸 8）", async ({
  page,
}) => {
  await open(page);
  const body = await box(page.locator(".k-detail > section.k-page"));
  const side = await box(panel(page));
  expect(Math.round(side.width)).toBe(380);
  expect(side.x).toBeGreaterThanOrEqual(body.x + body.width - 1);
  expect(await cssOf(panel(page), "border-left-color")).toBe(LINE);
  expect(await cssOf(panel(page), "border-left-width")).toBe("1px");
  expect(await cssOf(card(page), "background-color")).toBe(WHITE);
  expect(await cssOf(card(page), "border-top-color")).toBe(LINE);
  expect(await cssOf(card(page), "border-top-left-radius")).toBe("8px");
});

test("K226-UI-002 頭の行：種別の札（種別の色の塗り・白字・11px）・番号・番号をコピー・作成の時刻（日本時間）・開始日・期限・段の札が 1 行に並ぶ", async ({
  page,
}) => {
  await open(page, { stage: "doing" }, { due_on: jst(3) });
  await expect(part(page, "kind")).toHaveText("タスク");
  expect(await cssOf(part(page, "kind"), "background-color")).toBe("rgb(24, 111, 105)");
  expect(await cssOf(part(page, "kind"), "color")).toBe(WHITE);
  expect(await cssOf(part(page, "kind"), "font-size")).toBe("11px");
  await expect(part(page, "number")).toHaveText("EG-133");
  await expect(meta(page).getByRole("button", { name: "番号をコピー" })).toBeVisible();
  await expect(part(page, "created")).toHaveText("作成 10/30 17:44");
  await expect(part(page, "start")).toContainText("開始日 10/30");
  await expect(part(page, "due")).toContainText(`期限 ${md(jst(3))}`);
  await expect(part(page, "stage")).toHaveText("作業中");
  const ys = await Promise.all(
    ["kind", "number", "stage"].map(async (n) => {
      const b = await box(part(page, n));
      return b.y + b.height / 2;
    }),
  );
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(3);
});

test("K226-UI-003 題名 h1：20px・700・行の高さ 1.45。h1 は 1 つ。題名の行の右に 複製・〈見ている人〉のAI と話す（担当者が山田でも高本のAI）・ほかの操作", async ({
  page,
}) => {
  await open(page, { stage: "doing" }, {}, 1440, undefined, { assignee: { id: "m2", display_name: "山田" } });
  const h1 = page.locator("header.k-page-head h1");
  await expect(h1).toHaveText("11 月分の請求書を送る");
  expect(await cssOf(h1, "font-size")).toBe("20px"); // 正本の h1（K-254 で絵の 22px を 20px に寄せた）
  expect(await cssOf(h1, "font-weight")).toBe("700");
  expect(await cssOf(h1, "line-height")).toBe("29px"); // 20px × 1.45（絵の行の高さのまま）
  await expect(page.locator("h1")).toHaveCount(1);
  const acts = page.locator("header.k-page-head .k-page-acts");
  for (const n of ["複製", "高本のAI と話す", "ほかの操作"])
    await expect(acts.getByRole("button", { name: n, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "山田のAI と話す" })).toHaveCount(0);
  expect((await box(acts)).x).toBeGreaterThan((await box(h1)).x);
});

test("K226-UI-004 段の札の色：段ごとの塗り（未着手 #6B7585・作業中 #2F4B7C・保留 #4A5563・確認中 #6D4AA6・承認待ち #B45309・実行中 #1D4ED8・完了 #166534）に白字・12px・500", async ({
  page,
}) => {
  const colors: Record<string, [string, string]> = {
    todo: ["未着手", "rgb(107, 117, 133)"],
    doing: ["作業中", "rgb(47, 75, 124)"],
    hold: ["保留", "rgb(74, 85, 99)"],
    checking: ["確認中", "rgb(109, 74, 166)"],
    awaiting_approval: ["承認待ち", "rgb(180, 83, 9)"],
    running: ["実行中", "rgb(29, 78, 216)"],
    done: ["完了", "rgb(22, 101, 52)"],
  };
  const m = await open(page);
  const bad: string[] = [];
  for (const [key, [name, bg]] of Object.entries(colors)) {
    const b: Band = { stage: key };
    m.on.ticket = () => ({ status: 200, body: { data: detail(b, {}, { stage: { key, name } }) } });
    await page.reload();
    await expect(part(page, "stage")).toHaveText(name);
    const got = [
      await cssOf(part(page, "stage"), "background-color"),
      await cssOf(part(page, "stage"), "color"),
      await cssOf(part(page, "stage"), "font-size"),
      await cssOf(part(page, "stage"), "font-weight"),
    ].join(" ");
    if (got !== `${bg} ${WHITE} 12px 500`) bad.push(`${key}：${got}`);
  }
  expect(bad).toEqual([]);
});

test("K226-UI-005 期限：過ぎた期限は「M/D（N 日過ぎ）」を赤（#B91C1C）、過ぎていない期限は「M/D」を赤でなく。開始日は「M/D」", async ({
  page,
}) => {
  const m = await open(page, { stage: "doing" }, { due_on: jst(-1) });
  await expect(part(page, "due")).toContainText(`期限 ${md(jst(-1))}（1 日過ぎ）`);
  expect(await cssOf(part(page, "due").locator("b"), "color")).toBe(RED_TEXT);
  m.on.ticket = () => ({ status: 200, body: { data: detail({ stage: "doing" }, { due_on: jst(2) }) } });
  await page.reload();
  await expect(part(page, "due")).toContainText(`期限 ${md(jst(2))}`);
  await expect(part(page, "due")).not.toContainText("過ぎ");
  expect(await cssOf(part(page, "due").locator("b"), "color")).not.toBe(RED_TEXT);
  await expect(part(page, "start")).toContainText("開始日 10/30");
});

test("K226-UI-006 期限・開始日・作成の時刻が無い（null）：値は空で、「—」も日付も出さない", async ({ page }) => {
  await open(page, { stage: "doing" }, { due_on: null, start_on: null, created_at: null });
  for (const n of ["due", "start"]) {
    const t = (await part(page, n).innerText()).replace(/期限|開始日/, "").trim();
    expect(t, n).toBe("");
  }
  expect((await part(page, "created").innerText()).replace("作成", "").trim()).toBe("");
  await expect(meta(page)).not.toContainText("—");
});

test("K226-UI-007 番号をコピー：押すとクリップボードに番号「EG-133」が入り、「番号をコピーしました」が読み上げに出る（role=status）", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await meta(page).getByRole("button", { name: "番号をコピー" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("EG-133");
  await expect(page.getByRole("status").filter({ hasText: "番号をコピーしました" })).toHaveCount(1);
});

test("K226-UI-030 番号をコピーできない（クリップボードが断る）：「番号をコピーできませんでした」が読み上げに出て、「コピーしました」は出ない", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
  });
  await open(page);
  await meta(page).getByRole("button", { name: "番号をコピー" }).click();
  await expect(page.getByRole("status").filter({ hasText: "番号をコピーできませんでした" })).toHaveCount(1);
  await expect(page.getByText("番号をコピーしました")).toHaveCount(0);
});

test("K226-UI-008 まだ使えない操作（複製・ほかの操作・本文の道具 14 個・版と差分・パネルの AI・子を足す・つながりを足す・AI と話す）：在る・aria-disabled・薄さ 0.55・押しても Enter でも何も起きない。パネルのやり取りは押せる（K-392）", async ({
  page,
}) => {
  const writes = countWrites(page);
  await open(page);
  const main = page.locator(".k-detail");
  for (const n of [...DETAIL_INERT, "高本のAI と話す", "高本のAI"])
    await expectInert(page, main.getByRole("button", { name: n, exact: true }), n, writes);
  // K-392：パネルのタブ「やり取り」は押せる形（aria-disabled が無い・tabIndex で飛ばさない）
  const talk = panel(page)
    .getByRole("navigation", { name: "パネルのタブ" })
    .getByRole("button", { name: "やり取り", exact: true });
  await expect(talk).not.toHaveAttribute("aria-disabled", "true");
  await expect(talk).not.toHaveAttribute("tabindex", "-1");
});

test("K226-UI-009 本文の道具の帯：14 個がキャンバスの順に並び、右に「「/」で部品を入れる ・ 本文の版 4」（区画の版のいちばん大きい数）と 版と差分。帯の見た目（地・上下の線・左右 20px・上に貼り付く（幅 1440 は外枠の上の帯の下の top 48・幅 375 は top 0）・高さ 28 で幅 30 以上・中の字があふれない・押せないグレー）はキャンバスどおり（部品 DocTools が生まれるこのチケットで見る）", async ({
  page,
}) => {
  await open(page);
  const bar = card(page).getByRole("toolbar", { name: "本文の道具" });
  const names = await bar.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(names.slice(0, DOC_TOOLS.length)).toEqual([...DOC_TOOLS]);
  await expect(bar).toContainText("「/」で部品を入れる ・ 本文の版 4");
  await expect(bar.getByRole("button", { name: "版と差分" })).toHaveCount(1);
  // 帯の見た目（キャンバス TicketDetail・Create で同じ：地は表の頭の色・下に薄い線・道具の高さ 28・押せない物は薄さ 0.55）
  expect(await cssOf(bar, "background-color")).toBe("rgb(250, 251, 252)");
  expect(await cssOf(bar, "border-bottom-color")).toBe("rgb(237, 240, 244)");
  // 詳細の帯だけの値（キャンバス TicketDetail：上に 1px #DDE2E9 の線・左右 20px・本文を送っても上に貼り付く）
  expect(await cssOf(bar, "border-top-color")).toBe(LINE);
  expect(await cssOf(bar, "border-top-width")).toBe("1px");
  expect(await cssOf(bar, "padding-left")).toBe("20px");
  expect(await cssOf(bar, "padding-right")).toBe("20px");
  expect(await cssOf(bar, "position")).toBe("sticky");
  // 貼り付く位置：幅 768 以上は外枠の上の帯（48px・上に貼り付く）の下。帯の下に隠れない（レビューの指摘）
  expect(await cssOf(bar, "top")).toBe("48px");
  for (const name of DOC_TOOLS) {
    const b = bar.getByRole("button", { name, exact: true });
    await expect(b, name).toHaveAttribute("aria-disabled", "true");
    expect(Math.round((await box(b)).height), name).toBe(28);
    expect((await box(b)).width, name).toBeGreaterThanOrEqual(30);
    // 幅を width で 30 に固めると「見出し」などの字があふれる。最小の幅 30 で、中の字はあふれない
    expect(await b.evaluate((e) => e.scrollWidth <= e.clientWidth), `${name} の字があふれない`).toBe(true);
    expect(await opacityOf(b), name).toBeCloseTo(DISABLED_OPACITY, 3);
  }
  // 幅 767 以下は外枠が上の帯を出さない（K-138）ので、画面の上の端（0）に貼り付く
  await page.setViewportSize({ width: 375, height: 1000 });
  expect(await cssOf(bar, "top")).toBe("0px");
  expect(await cssOf(bar, "position")).toBe("sticky");
});

test("K226-UI-010 区画の見出し h2：16px・700・下に 1px #DDE2E9・下の余白 6px。2 つめの見出しは前の本文から 28px 下", async ({
  page,
}) => {
  await open(page);
  const h2 = card(page).locator("section.k-section h2");
  await expect(h2).toHaveCount(3);
  expect(await cssOf(h2, "font-size")).toBe("16px");
  expect(await cssOf(h2, "font-weight")).toBe("700");
  expect(await cssOf(h2, "border-bottom-color")).toBe(LINE);
  expect(await cssOf(h2, "border-bottom-width")).toBe("1px");
  expect(await cssOf(h2, "padding-bottom")).toBe("6px");
  const firstBody = await box(card(page).locator("section.k-section").first().locator(".k-pre"));
  const second = await box(h2.nth(1));
  expect(Math.abs(second.y - (firstBody.y + firstBody.height) - 28)).toBeLessThanOrEqual(1);
});

test("K226-UI-011 区画の本文：改行を残す（実施事項の 2 行が 2 行に出る）。HTML の字は字のまま（スクリプトを動かさない）", async ({
  page,
}) => {
  await open(page, { stage: "doing", todo: '- 請求書を作る\n- <img src=x onerror="window.__k226=1">' });
  const todo = card(page).getByRole("region", { name: "実施事項" }).locator(".k-pre");
  await expect(todo).toContainText('<img src=x onerror="window.__k226=1">');
  const lh = parseFloat(await cssOf(todo, "line-height"));
  expect((await box(todo)).height).toBeGreaterThanOrEqual(lh * 2 - 1);
  expect(await page.evaluate(() => (window as unknown as { __k226?: number }).__k226)).toBeUndefined();
});

test("K226-UI-012 空白の無い長い字（300 字）の区画も、本文の箱の中で折り返す（幅 375・1440 で横溢れ 0）", async ({
  page,
}) => {
  const long = "あ".repeat(150) + "a".repeat(150);
  for (const w of [375, 1440]) {
    await open(page, { stage: "doing", todo: long }, {}, w);
    const todo = card(page).getByRole("region", { name: "実施事項" }).locator(".k-pre");
    const c = await box(card(page));
    const t = await box(todo);
    expect(t.x + t.width, `幅 ${w}`).toBeLessThanOrEqual(c.x + c.width + 1);
    expect(await overflowX(page), `幅 ${w}`).toBe(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("K226-UI-013 パネルのタブ：属性（今いる）・やり取り・高本のAI。属性の中は 担当・日付と時間・分類・本文の目次・実行の記録（最新）の順", async ({
  page,
}) => {
  await open(page);
  const tabs = panel(page).getByRole("navigation", { name: "パネルのタブ" });
  await expect(tabs.getByRole("button")).toHaveText(["属性", "やり取り", "高本のAI"]);
  await expect(tabs.getByRole("button", { name: "属性" })).toHaveAttribute("aria-current", "page");
  const heads = await panel(page).locator("h2").allInnerTexts();
  expect(heads.map((x) => x.trim())).toEqual(["担当", "日付と時間", "分類", "本文の目次", "実行の記録（最新）"]);
});

/** パネルの区画の「項目名 → 値」 */
async function fieldsOf(page: Page, section: string) {
  return panel(page)
    .getByRole("region", { name: section })
    .locator("dl")
    .evaluate((dl) => {
      const out: Record<string, string> = {};
      const dts = dl.querySelectorAll("dt");
      dts.forEach((dt) => {
        // 値の字だけ（頭文字の丸など aria-hidden の飾りと、値の横のボタンは除く）
        const dd = dt.nextElementSibling?.cloneNode(true) as Element | undefined;
        dd?.querySelectorAll('[aria-hidden="true"], button').forEach((x) => x.remove());
        out[dt.textContent!.trim()] = (dd?.textContent ?? "").trim();
      });
      return out;
    });
}

test("K226-UI-014 担当：担当者は名前・承認する人は承認待ちの承認する人の名前・業務の型は空。承認待ちでなければ承認する人は空", async ({
  page,
}) => {
  const m = await open(page, { stage: "awaiting_approval", approval: pending({ approver_name: "佐藤" }) });
  expect(await fieldsOf(page, "担当")).toEqual({ 担当者: "高本", 業務の型: "", 承認する人: "佐藤" });
  m.on.ticket = () => ({ status: 200, body: { data: detail({ stage: "doing" }) } });
  await page.reload();
  expect(await fieldsOf(page, "担当")).toEqual({ 担当者: "高本", 業務の型: "", 承認する人: "" });
});

test("K226-UI-015 日付と時間：開始日と期限は「MM/DD（曜）」・過ぎた期限は赤で「N 日過ぎ」と押せない「期限を変える」（▾）・予定と実績は空", async ({
  page,
}) => {
  const writes = countWrites(page);
  await open(page, { stage: "doing" }, { due_on: jst(-2) });
  const f = await fieldsOf(page, "日付と時間");
  expect(f).toEqual({ 開始日: mdw("2026-10-30"), 期限: `${mdw(jst(-2))}2 日過ぎ`, 予定: "", 実績: "" });
  const due = panel(page).getByRole("region", { name: "日付と時間" }).locator("dd").nth(1);
  expect(await cssOf(due, "color")).toBe(RED_TEXT);
  await expectInert(page, due.getByRole("button", { name: "期限を変える" }), "期限を変える", writes);
});

test("K226-UI-016 分類：グループは名前と接頭辞「営業（EG）」・優先度は中（high は高）・分類・節目・取引先・親は空。グループの口が 500 ならグループだけ空", async ({
  page,
}) => {
  const m = await open(page);
  expect(await fieldsOf(page, "分類")).toEqual({
    グループ: "営業（EG）",
    分類: "",
    節目: "",
    取引先: "",
    優先度: "中",
    親: "",
  });
  // 優先度が high なら「高」
  m.on.ticket = () => ({ status: 200, body: { data: detail({ stage: "doing" }, { priority: "high" }) } });
  await page.reload();
  expect((await fieldsOf(page, "分類"))["優先度"]).toBe("高");
  // グループの口が 500：グループは空で、ほかの値は出る（嘘の値を出さない・画面は壊れない）
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await open(page, { stage: "doing" }, {}, 1440, undefined, {}, true);
  const f = await fieldsOf(page, "分類");
  expect(f["グループ"]).toBe("");
  expect(f["優先度"]).toBe("中");
  await expect(page.locator("header.k-page-head h1")).toHaveText("11 月分の請求書を送る");
});

test("K226-UI-017 本文の目次：区画の名前が区画の順にリンクで並び、押すとその区画の見出しが画面の中に来る", async ({
  page,
}) => {
  await open(page);
  await page.setViewportSize({ width: 1440, height: 500 });
  const toc = panel(page).getByRole("navigation", { name: "本文の目次" });
  await expect(toc.getByRole("link")).toHaveText(["目的", "完了の条件", "実施事項"]);
  await toc.getByRole("link", { name: "実施事項" }).click();
  const h = card(page).getByRole("region", { name: "実施事項" }).locator("h2");
  await expect(h).toBeInViewport();
});

test("K226-UI-018 実行の記録（最新）：いちばん新しい 1 件だけを「高本のAI ・ 11/01 09:00 → 09:12（12 分）」で。走っている実行は終わりの時刻が空。実行が無いと「まだ AI に任せていません」", async ({
  page,
}) => {
  const two = [run({}), run({ id: "0193c5a0-0000-7000-8000-0000000e0100", by: { display_name: "佐藤" } })];
  await open(page, { stage: "doing" }, {}, 1440, two);
  const sec = panel(page).getByRole("region", { name: "実行の記録（最新）" });
  await expect(sec).toContainText("高本のAI ・ 11/01 09:00 → 09:12（12 分）");
  await expect(sec).not.toContainText("佐藤のAI");
  await expect(sec).toHaveAttribute("data-runs", "2");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await open(page, { stage: "doing" }, {}, 1440, [run({ status: "running", finished_at: null })]);
  await expect(sec).toContainText("高本のAI ・ 11/01 09:00 →");
  await expect(sec).not.toContainText("分）");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await open(page, { stage: "doing" }, {}, 1440, []);
  await expect(sec).toContainText("まだ AI に任せていません");
  await expect(sec).toHaveAttribute("data-runs", "0");
});

test("K226-UI-019 「実行の記録をすべて見る」：押すと小窓「実行の記録」に全部の実行が新しい順で出る。絞り込みの札は在るが押せない。Esc で閉じる", async ({
  page,
}) => {
  const writes = countWrites(page);
  const two = [run({}), run({ id: "0193c5a0-0000-7000-8000-0000000e0100", by: { display_name: "佐藤" } })];
  await open(page, { stage: "doing" }, {}, 1440, two);
  await panel(page).getByRole("button", { name: "実行の記録をすべて見る" }).click();
  const dlg = page.getByRole("dialog", { name: "実行の記録" });
  await expect(dlg).toBeVisible();
  const items = dlg.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("高本のAI");
  await expect(items.nth(1)).toContainText("佐藤のAI");
  const chips = dlg.getByRole("group", { name: "絞り込み" }).getByRole("button");
  expect(await chips.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await chips.count()); i++) {
    await expect(chips.nth(i)).toHaveAttribute("aria-disabled", "true");
  }
  expect(writes.n).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
});

test("K226-UI-020 子チケット・つながり：本文のカードの下に別のカード（白・線・角丸 8）・見出し 14px・子を足す と つながりを足す（押せない）・中に嘘の行を出さない", async ({
  page,
}) => {
  await open(page);
  const sec = page.locator(".k-detail > section.k-page").getByRole("region", { name: "子チケット・つながり" });
  expect((await box(sec)).y).toBeGreaterThan((await box(card(page))).y + (await box(card(page))).height - 1);
  expect(await cssOf(sec, "background-color")).toBe(WHITE);
  expect(await cssOf(sec, "border-top-color")).toBe(LINE);
  expect(await cssOf(sec, "border-top-left-radius")).toBe("8px");
  expect(await cssOf(sec.getByRole("heading", { name: "子チケット・つながり" }), "font-size")).toBe("14px");
  await expect(sec.getByRole("link")).toHaveCount(0);
  await expect(sec.locator("[data-ticket-link]")).toHaveCount(0);
});

test("K226-UI-021 戻る道：本文に「チケットへ戻る」が無い。上の帯のいまの場所の「チケット」を押すと /tickets", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("link", { name: "チケットへ戻る" })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "いまの場所" })
    .getByRole("link", { name: "チケット", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tickets$/);
});

for (const w of [768, 375]) {
  test(`K226-UI-022 幅 ${w}：右のパネルは本文の下に出る（画面に被さらない・固定でない）`, async ({ page }) => {
    await open(page, { stage: "doing" }, {}, w);
    expect(await cssOf(panel(page), "position")).not.toBe("fixed");
    const body = await box(page.locator(".k-detail > section.k-page"));
    const side = await box(panel(page));
    expect(side.y).toBeGreaterThanOrEqual(body.y + body.height - 1);
  });
}

test("K226-UI-023 幅 320・375・768・1024・1440：横溢れ 0。題名 h1 の箱と 1 文字目の左の端が画面の中", async ({
  page,
}) => {
  const bad: string[] = [];
  for (const w of WIDTHS) {
    await open(page, { stage: "doing" }, {}, w);
    const o = await overflowX(page);
    if (o !== 0) bad.push(`幅 ${w}：横溢れ ${o}px`);
    const h1 = page.locator("header.k-page-head h1");
    if ((await leftOf(h1)) < 0) bad.push(`幅 ${w}：h1 の左が画面の外`);
    if ((await firstCharLeft(h1)) < 0) bad.push(`幅 ${w}：h1 の 1 文字目が画面の外`);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
  expect(bad).toEqual([]);
});

test("K226-UI-024 幅 375・1440：本文とパネルの押せるものは 24px 以上", async ({ page }) => {
  for (const w of [375, 1440]) {
    await open(page, { stage: "doing" }, {}, w);
    const small = await page.$$eval(".k-detail a[href], .k-detail button", (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
        })
        .map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim()),
    );
    expect(small, `幅 ${w}`).toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

const SPEC_ROWS = ["create-ticket", "delegate", "approve-complete"].flatMap((f) =>
  readFileSync(join(ROOT, `07_qa/test-specs/k/${f}.md`), "utf8")
    .split("\n")
    .map((ln) => /（([a-z]+)）「(.+?)」/.exec(ln))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => `${x[1]}|${x[2]}`),
);

test("K226-UI-025 操作要素の漏れ：詳細の本文と右のパネルの操作要素（帯と小窓の中を除く）が全部、K-226 の一覧か K-60・K-62・K-63 の表に在る", async ({
  page,
}) => {
  await open(page, { stage: "awaiting_approval", approval: pending() }, {}, 1440, [run({})]);
  const have = new Set([
    ...SPEC_ROWS,
    ...detailRows(["目的", "完了の条件", "実施事項"]).map((r) => `${r.role}|${r.name}`),
  ]);
  const inBands = new Set(
    (
      await Promise.all(
        ["承認と実行", "AI に任せる"].map(async (n) => {
          const r = page.getByRole("region", { name: n });
          return (await r.count()) ? controlsOf(page, `section[aria-label="${n}"]`) : [];
        }),
      )
    )
      .flat()
      .map((c) => `${c.role}|${c.name}`),
  );
  const leak = (await controlsOf(page, ".k-detail"))
    .map((c) => `${c.role}|${c.name}`)
    .filter((k) => !inBands.has(k) && !have.has(k));
  expect(leak).toEqual([]);
});

test("K226-UI-026 台帳と流用：class_ledger に詳細の画面のファイル（ticket-detail.tsx・run-log.tsx）の行が無く、詳細に外枠の右のパネルの決まり（.k-panel）が無い", async ({
  page,
}) => {
  const ledger = JSON.parse(readFileSync(join(ROOT, "scripts/ci/class_ledger.json"), "utf8")) as {
    entries: { cls: string; file: string }[];
  };
  const left = ledger.entries.filter((e) => /ticket-detail\.tsx|run-log\.tsx/.test(e.file));
  expect(left).toEqual([]);
  await open(page);
  await expect(page.locator(".k-detail .k-panel")).toHaveCount(0);
});

test("K226-UI-029 右のパネルの「パネルを閉じる」：押すとパネルが消えて本文の箱が広がり、「パネルを開く」で戻る（書く口は呼ばない）", async ({
  page,
}) => {
  const writes = countWrites(page);
  await open(page);
  const before = await box(page.locator(".k-detail > section.k-page"));
  await panel(page).getByRole("button", { name: "パネルを閉じる" }).click();
  await expect(panel(page)).toBeHidden();
  const wide = await box(page.locator(".k-detail > section.k-page"));
  expect(wide.width).toBeGreaterThan(before.width + 300);
  await page.locator(".k-detail").getByRole("button", { name: "パネルを開く" }).click();
  await expect(panel(page)).toBeVisible();
  expect(Math.round((await box(panel(page))).width)).toBe(380);
  expect(writes.n).toBe(0);
});

test("K226-UI-031 パネルを閉じるとキーボードの場所が「パネルを開く」に移り、開く（Enter）と「パネルを閉じる」に戻る", async ({
  page,
}) => {
  await open(page);
  await panel(page).getByRole("button", { name: "パネルを閉じる" }).click();
  const reopen = page.locator(".k-detail").getByRole("button", { name: "パネルを開く" });
  await expect(reopen).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "パネルを閉じる" })).toBeFocused();
});

test("K226-UI-032 「実行の記録」の小窓は右から出る板（キャンバス TdRunLog）：右の端に寄せて幅 540・上から下まで画面いっぱい。幅 375 は画面の幅", async ({
  page,
}) => {
  for (const w of [1440, 375]) {
    await open(page, { stage: "doing" }, {}, w, [run({})]);
    await panel(page).getByRole("button", { name: "実行の記録をすべて見る" }).click();
    const dlg = page.getByRole("dialog", { name: "実行の記録" });
    await expect(dlg).toBeVisible();
    const b = await box(dlg);
    const vp = page.viewportSize()!;
    expect(Math.round(b.width), `幅 ${w}`).toBe(Math.min(540, vp.width));
    expect(Math.round(b.x + b.width), `幅 ${w} の右の端`).toBe(vp.width);
    expect(Math.round(b.y), `幅 ${w} の上の端`).toBe(0);
    expect(Math.round(b.height), `幅 ${w} の高さ`).toBe(vp.height);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

fidelityConfigTest(
  "K226-UI-027 突き合わせの設定：ticket-detail が enrolled・持ち主 K-226・画面を整える道具に鍵・画面の側のセレクタに .k-panel が無い",
  ["ticket-detail"],
  "K-226",
);
fidelityCompareTests("K226-UI-028", "ticket-detail", "TicketDetail");
