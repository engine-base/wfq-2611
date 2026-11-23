// K-1119「決定が 1 つでもあるチケットは、詳細の頁に決定ログの区画が必ず出る」の画面の試験（実 Chrome・実装より先に積む）。
//   区画の行（ticket_sections の鍵 decisions）が無い詳細は、K-397 の共通の道具 decisions-mock.ts の intro: "none"（読むだけ・替えない）。
//   やり取りの口はこの試験で差し替える（1 件の作り方は K-392 の道具 thread-mock.ts・形は K-383 の答え）。
//   期待は決定（D-150.41：決定ログは出来たときだけ詳細に現れる・D-149.24：区画の行が在れば作るときの字を上に残す）とチケットの表から書く。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  D0,
  D1,
  D2,
  D3,
  FOUR,
  MSG_ID,
  TICKET,
  addDialog,
  dec,
  decisionsApi,
  detailWithDecisions,
  items,
  logSec,
  openDetail,
} from "./decisions-mock";
import { idOf, item as listItem, mockList, ok, open as openList } from "./list-mock";
import { SUZU_W, TAKA_W, meta, post as postItem, system, type TimelineItem } from "./thread-mock";

test.use({ timezoneId: "Asia/Tokyo" });

const EMPTY = "まだ決定はありません。決めたことと理由を残すと、あとから根拠として引けます";
const FAILED = "決定を読み込めませんでした";
/** 生きている決定 1 件（元の書き込みなし） */
const ONE = dec({ id: "0193c5a0-0000-7000-8000-0000000d0009", text: "請求書は PDF で送る" });

const heading = (page: Page) => page.locator("#sec-decisions");
const addBtns = (page: Page) => page.getByRole("button", { name: "＋ 決定を足す" });
const row = (page: Page, text: string) => items(page).filter({ has: page.locator(".k-dec-text", { hasText: text }) });
const reviseDialog = (page: Page) => page.getByRole("dialog", { name: "決定を改める" });
const cancelDialog = (page: Page) => page.getByRole("alertdialog", { name: "この決定を取り消しますか？" });
const fromDialog = (page: Page) => page.getByRole("dialog", { name: "決定にする" });
const panel = (page: Page) => page.getByRole("complementary", { name: "チケットのパネル" });
const over = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** 区画の行が無い詳細で、ほかの区画（目的）が出ている＝詳細は描けている */
const detailShown = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#sec-purpose")).toBeVisible();
};

test("K1119-UI-001 区画の行が無い・決定 4 件：見出し「決定ログ（2）」の区画が 1 つ・本文の区画の最後・行 4 つ（生きている → 改められた → 取り消した）・作るときの字の行は無い・「＋ 決定を足す」1 つ・決定の一覧の口は 1 回", async ({
  page,
}) => {
  const d = await decisionsApi(page, { intro: "none", list: FOUR });
  await openDetail(page);
  await detailShown(page);
  await expect(heading(page)).toHaveCount(1);
  await expect(heading(page)).toHaveText("決定ログ（2）");
  // 本文の区画の入れ物の最後の子が決定ログの区画
  await expect(page.locator(".k-detail-doc > :last-child #sec-decisions")).toHaveCount(1);
  await expect(items(page)).toHaveCount(4);
  await expect(items(page).locator(".k-dec-text")).toHaveText([D3.text, D2.text, D1.text, D0.text]);
  await expect(items(page).nth(2).locator(".k-dec-tag")).toHaveText("改められた");
  await expect(items(page).nth(3).locator(".k-dec-tag")).toHaveText("取り消した");
  await expect(page.locator(".k-dec-intro")).toHaveCount(0);
  await expect(page.getByText("作るときに書いた字：")).toHaveCount(0);
  await expect(addBtns(page)).toHaveCount(1);
  expect(d.reads).toBe(1);
});

test("K1119-UI-002 区画の行が無い・決定 0 件：決定の一覧の口が答えた後も、見出し・「＋ 決定を足す」・空の文は 0 個（場所ごと出さない）。ほかの区画は出ている", async ({
  page,
}) => {
  const d = await decisionsApi(page, { intro: "none", list: [] });
  const answered = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/tickets/${TICKET}/decisions`) && r.request().method() === "GET",
  );
  await openDetail(page);
  await (await answered).finished();
  await detailShown(page);
  await expect(heading(page)).toHaveCount(0);
  await expect(addBtns(page)).toHaveCount(0);
  await expect(page.getByText(EMPTY)).toHaveCount(0);
  expect(d.reads).toBe(1);
});

test("K1119-UI-003 区画の行が無い・生きている決定 1 件：取り消す（口 1 回・区画は残り数なしの見出し・「取り消した」の札）→「＋ 決定を足す」（口 1 回・見出し（1））→ 改める（口 1 回・「改められた」「改めた」の札・見出し（1））", async ({
  page,
}) => {
  const d = await decisionsApi(page, { intro: "none", list: [ONE] });
  await openDetail(page);
  await expect(heading(page)).toHaveText("決定ログ（1）");
  // 取り消す
  await row(page, ONE.text).getByRole("button", { name: "取り消す" }).click();
  await cancelDialog(page)
    .getByRole("textbox", { name: /取り消す理由/ })
    .fill("先方が取り下げた");
  await cancelDialog(page).getByRole("button", { name: "取り消す" }).click();
  await expect(cancelDialog(page)).toHaveCount(0);
  expect(d.patches).toEqual([{ id: ONE.id, body: { action: "cancel", reason: "先方が取り下げた" } }]);
  // 生きている決定が 0 になっても、取り消した行が在るので区画は残る
  await expect(heading(page)).toHaveText("決定ログ");
  await expect(items(page)).toHaveCount(1);
  await expect(row(page, ONE.text).locator(".k-dec-tag")).toHaveText("取り消した");
  // 足す
  await addBtns(page).click();
  await addDialog(page)
    .getByRole("textbox", { name: /決めたこと/ })
    .fill("請求書はメールで送る");
  await addDialog(page).getByRole("button", { name: "決定を足す" }).click();
  await expect(addDialog(page)).toHaveCount(0);
  expect(d.posts).toHaveLength(1);
  expect(d.posts[0]!["text"]).toBe("請求書はメールで送る");
  await expect(heading(page)).toHaveText("決定ログ（1）");
  // 改める
  await row(page, "請求書はメールで送る").getByRole("button", { name: "改める" }).click();
  await reviseDialog(page)
    .getByRole("textbox", { name: /新しい決定/ })
    .fill("請求書はメールと郵送で送る");
  await reviseDialog(page).getByRole("button", { name: "改める" }).click();
  await expect(reviseDialog(page)).toHaveCount(0);
  expect(d.patches).toHaveLength(2);
  expect(d.patches[1]!.body).toMatchObject({ action: "revise", text: "請求書はメールと郵送で送る" });
  await expect(heading(page)).toHaveText("決定ログ（1）");
  await expect(row(page, "請求書はメールと郵送で送る").locator(".k-dec-tag")).toHaveText("改めた");
  await expect(
    items(page)
      .filter({ has: page.locator(".k-dec-text", { hasText: /^請求書はメールで送る$/ }) })
      .locator(".k-dec-tag"),
  ).toHaveText("改められた");
});

test("K1119-UI-004 区画の行が無い・決定 0 件：書き込みを「決定にする」と、決定の一覧の読み直しで区画が現れ（見出し（1）・「改める」「取り消す」）、書き込みは「✓ 決定にした」。詳細の口は読み直さない", async ({
  page,
}) => {
  const d = await decisionsApi(page, { intro: "none", list: [] });
  const body = "10/19 の追加対応は先方の都合で無償にした件、反映が要るかもしれません。";
  let tl: TimelineItem[] = [
    system(TAKA_W, "2026-10-30 17:44", "高本 がチケットを作った"),
    postItem(SUZU_W, "2026-11-01 10:20", body, { id: MSG_ID }),
  ];
  d.afterWrite = (x) => {
    const src = x.posts.at(-1)?.["source_message_id"];
    tl = tl.map((it) => (it.id === src && it.message ? { ...it, message: { ...it.message, decided: true } } : it));
  };
  await page.route(new RegExp(`/api/v1/tickets/${TICKET}/timeline/seen$`), (route: Route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { ticket_id: TICKET, seen_at: new Date().toISOString() } }),
    }),
  );
  await page.route(new RegExp(`/api/v1/tickets/${TICKET}/timeline(\\?|$)`), (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: tl, meta: meta({ post_count: 1 }) }),
    }),
  );
  // 詳細の口（getTicket）を呼んだ回数
  let detailReads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === `/api/v1/tickets/${TICKET}`) detailReads++;
  });
  await openDetail(page);
  await detailShown(page);
  await panel(page)
    .getByRole("navigation", { name: "パネルのタブ" })
    .getByRole("button", { name: /^やり取り/ })
    .click();
  const suzu = panel(page).getByRole("article", { name: /^鈴木 一郎 / });
  await expect(suzu).toBeVisible();
  await expect(heading(page)).toHaveCount(0);
  const before = detailReads;
  expect(before).toBeGreaterThan(0);
  await suzu.getByRole("button", { name: "決定にする" }).click();
  await expect(fromDialog(page)).toBeVisible();
  await fromDialog(page)
    .getByRole("textbox", { name: /決めたこと/ })
    .fill("10/19 の追加対応は無償");
  await fromDialog(page).getByRole("button", { name: "決定にする" }).click();
  await expect(fromDialog(page)).toHaveCount(0);
  expect(d.posts).toHaveLength(1);
  expect(d.posts[0]!["source_message_id"]).toBe(MSG_ID);
  // 区画が現れる（本文の区画の最後）
  await expect(heading(page)).toHaveText("決定ログ（1）");
  await expect(page.locator(".k-detail-doc > :last-child #sec-decisions")).toHaveCount(1);
  const made = row(page, "10/19 の追加対応は無償");
  await expect(made.getByRole("button", { name: "改める" })).toBeVisible();
  await expect(made.getByRole("button", { name: "取り消す" })).toBeVisible();
  await expect(suzu).toContainText("✓ 決定にした");
  // 現れた区画から「取り消す」の確かめまで届く
  await made.getByRole("button", { name: "取り消す" }).click();
  await expect(cancelDialog(page)).toBeVisible();
  expect(detailReads).toBe(before);
});

test("K1119-UI-005 区画の行が無い・決定 4 件：幅 320・375・768・1024・1440 で区画が出て横溢れ 0", async ({ page }) => {
  await decisionsApi(page, { intro: "none", list: FOUR });
  for (const w of [320, 375, 768, 1024, 1440]) {
    await openDetail(page, w);
    await expect(heading(page), `幅 ${w}`).toHaveText("決定ログ（2）");
    await expect(items(page), `幅 ${w}`).toHaveCount(4);
    expect(await over(page), `幅 ${w} の横溢れ`).toBe(0);
  }
});

test("K1119-UI-006 区画の行が無い・決定 4 件・閲覧のみ：区画は出る（見出し（2）・行 4 つ）。「＋ 決定を足す」「改める」「取り消す」は 0 個", async ({
  page,
}) => {
  await decisionsApi(page, { intro: "none", list: FOUR, canWrite: false });
  await openDetail(page);
  await expect(heading(page)).toHaveText("決定ログ（2）");
  await expect(items(page)).toHaveCount(4);
  await expect(addBtns(page)).toHaveCount(0);
  await expect(logSec(page).getByRole("button", { name: "改める" })).toHaveCount(0);
  await expect(logSec(page).getByRole("button", { name: "取り消す" })).toHaveCount(0);
});

for (const [name, fail] of [
  ["503", { status: 503, body: { error: "maintenance", code: "E-PAGE-004" } }],
  ["網の切れ", "abort"],
] as const) {
  test(`K1119-UI-007 区画の行が無い・決定の一覧が読めない（${name}）：区画も「決定を読み込めませんでした」も 0 個。題名とほかの区画は出ている`, async ({
    page,
  }) => {
    const d = await decisionsApi(page, { intro: "none", list: FOUR });
    d.failRead.push(fail);
    const done =
      fail === "abort"
        ? page.waitForEvent("requestfailed", (r) => r.url().endsWith(`/api/v1/tickets/${TICKET}/decisions`))
        : page.waitForResponse((r) => r.url().endsWith(`/api/v1/tickets/${TICKET}/decisions`));
    await openDetail(page);
    await done;
    await detailShown(page);
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByText(FAILED)).toHaveCount(0);
    await expect(addBtns(page)).toHaveCount(0);
    expect(d.reads).toBe(1);
  });
}

test("K1119-UI-008 区画の行が無い・決定ありのチケットを一覧の右に開く（幅 1440）：決定ログの見出し・「＋ 決定を足す」は 0 個・決定の一覧の口は 0 回", async ({
  page,
}) => {
  await mockList(page, { list: () => ok([listItem(1)], { next_cursor: null }) });
  let reads = 0;
  await page.route(`**/api/v1/tickets/${idOf(1)}/decisions`, (route: Route) => {
    reads++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: FOUR, meta: { can_write: true } }),
    });
  });
  await page.route(`**/api/v1/tickets/${idOf(1)}`, (route: Route) => {
    const t = detailWithDecisions({ intro: "none" }) as { ticket: Record<string, unknown> };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...t, ticket: { ...t.ticket, id: idOf(1), number: "EG-101" } } }),
    });
  });
  await openList(page, "/tickets?view=all&open=EG-101");
  const side = page.getByRole("complementary", { name: "チケットの詳細" });
  await expect(side.locator("#sec-purpose")).toBeVisible();
  await expect(side.locator("#sec-decisions")).toHaveCount(0);
  await expect(side.getByRole("button", { name: "＋ 決定を足す" })).toHaveCount(0);
  expect(reads).toBe(0);
});

test("K1119-UI-009 区画の行が在る（作るときの字あり）：決定 4 件でも 0 件でも区画はちょうど 1 つ・作るときの字が出る。0 件は空の文と「＋ 決定を足す」", async ({
  page,
}) => {
  await decisionsApi(page, { list: FOUR });
  await openDetail(page);
  await expect(heading(page)).toHaveCount(1);
  await expect(heading(page)).toHaveText("決定ログ（2）");
  await expect(logSec(page).locator(".k-dec-intro")).toHaveText("作るときに書いた字：支払いは銀行振込");
  await expect(items(page)).toHaveCount(4);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await decisionsApi(page, { list: [] });
  await openDetail(page);
  await expect(heading(page)).toHaveCount(1);
  await expect(heading(page)).toHaveText("決定ログ");
  await expect(logSec(page).locator(".k-dec-intro")).toHaveText("作るときに書いた字：支払いは銀行振込");
  await expect(page.getByText(EMPTY)).toHaveCount(1);
  await expect(addBtns(page)).toHaveCount(1);
});
