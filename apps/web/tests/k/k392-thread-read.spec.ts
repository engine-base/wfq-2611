// K-392「やり取りを読む（タブ・一覧・日付の区切り・絞り込み・並び・空・読めない・前の書き込みを見る・新しい印・最後に開いた時刻を書く・スマホの飛び先）」の画面の試験
//   （実 Chrome・実装より先に積む）。正のモック：/dev/mock/f6/talk-list・talk-empty・talk-loading-failed・talk-narrow（本番と同じ部品 features/F6/thread/views.tsx）。
//   詳細は前からの土台（approve-complete.harness.ts）で開き、やり取りの口だけを共通の道具 thread-mock.ts（この葉が持つ）で差し替える。
//   モックとの見た目の比べ方は共通の道具 stage2-match.ts の matchMock だけ（base は /dev/mock/f6）。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, test, type Page } from "@playwright/test";
import { idOf, mockList, open as openList, rowsOf } from "./list-mock";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";
import {
  CREATED,
  KEN_W,
  MOCK_BASE,
  P_SATO_ID,
  P_TAKA_ID,
  READ_PAIRS,
  SATO_W,
  SUZU_W,
  TAKA_W,
  THREAD_FULL,
  TICKET,
  change,
  cssOf,
  deleted,
  err,
  feed,
  meta,
  mockThread,
  ok,
  openDetail,
  openThread,
  overflowX,
  panel,
  post,
  postOf,
  system,
  talkTab,
  tabs,
  type TimelineItem,
} from "./thread-mock";

test.use({ timezoneId: "Asia/Tokyo" });

const OLDER_14 = { older_count: 14, new_count: 1, mine_count: 1 };
const articles = (page: Page) => feed(page).getByRole("article");
const moreBtn = (page: Page) => panel(page).getByRole("button", { name: /^前の書き込みを見る/ });
const chip = (page: Page, name: RegExp | string) =>
  panel(page).getByRole("group", { name: "やり取りの絞り込み" }).getByRole("button", { name });

// ---------------------------------------------------------------- モックと本番の突き合わせ（共通の道具 matchMock）
const DRIVE: Record<string, (page: Page, w: number) => Promise<void>> = {
  "talk-list": async (page, w) => {
    await mockThread(page, { band: { stage: "hold" }, meta: OLDER_14 });
    await openThread(page, w);
  },
  "talk-empty": async (page, w) => {
    const t = await mockThread(page, { items: [CREATED()], meta: { mine_count: 0 } });
    await openThread(page, w);
    t.on.timeline = () => ok([], meta({ mine_count: 0 }) as unknown as Record<string, unknown>);
    await chip(page, "話だけ").click();
    await expect(panel(page).getByText("まだやり取りはありません")).toBeVisible();
  },
  "talk-loading-failed": async (page, w) => {
    const t = await mockThread(page);
    t.on.timeline = () => err(503, "SERVICE_UNAVAILABLE");
    await openThread(page, w);
    await expect(panel(page).getByText("やり取りを読み込めませんでした")).toBeVisible();
  },
  "talk-narrow": async (page, w) => {
    await mockThread(page, { band: { stage: "hold" }, meta: OLDER_14 });
    await openDetail(page, w);
    await page.getByRole("link", { name: /^やり取り 3/ }).click();
    await expect(talkTab(page)).toHaveAttribute("aria-current", "page");
  },
};
for (const [id, drive] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    if (id === "talk-narrow" && w === 1440) continue; // 飛び先は 1023 以下だけ（1440 は K392-UI-017 が「出ない」を見る）
    test(`K392-UI-001 ${id} 幅 ${w}：パネルのタブ・絞り込み・並び・前の書き込みを見る・日付の区切り・書き込み・変更の 1 行・AI の実行・新しい印・空・読めない・飛び先の値がモックと同じ`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(browser, id, w, (page) => drive(page, w), {
        pairs: READ_PAIRS,
        base: MOCK_BASE,
        // 書く欄（K-393）・メニューの開く印（K-394）は別の葉が比べる
      });
      expect(new Set(rows.map((r) => r.part)), "パネルのタブで比べた").toContain("talk-tabs");
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
}

// ---------------------------------------------------------------- 開く・タブ

test("K392-UI-002 詳細を開く：読む口（GET /tickets/:id/timeline?limit=20）は詳細の答えを待たずに出て、開いた間にちょうど 1 回。タブ「やり取り」に読んでいない数（1・読み上げ「まだ読んでいない書き込み 1 件」）", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: { new_count: 1 } });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const orig = t.base.on.ticket;
  t.base.on.ticket = async (req) => {
    await gate;
    return orig(req);
  };
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/v1/tickets/${TICKET}/timeline`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/tickets/${TICKET}`);
  await asked; // 詳細の答えを止めている間に出た（段 1）
  release();
  await expect(page.getByRole("heading", { level: 1, name: /11 月分の請求書を送る/ })).toBeVisible();
  const count = talkTab(page).locator(".k-talk-count");
  await expect(count).toHaveText("1");
  await expect(count).toHaveAttribute("aria-label", "まだ読んでいない書き込み 1 件");
  expect(t.reads).toHaveLength(1);
  expect(Object.fromEntries(t.reads[0]!)).toEqual({ limit: "20" });
  await talkTab(page).click();
  await expect(feed(page)).toBeVisible();
  expect(t.reads, "タブを押しても読み直さない").toHaveLength(1);
});

test("K392-UI-003 タブ「やり取り」を押す：古い順に 日付の区切り（10/28（火）・10/30（木）・11/01（土））・書き込み（名前・時刻・本文・知らせた）・変更の 1 行・仕組みの 1 行・AI の実行の 1 枚。属性に戻すと属性の中身", async ({
  page,
}) => {
  await mockThread(page);
  await openThread(page);
  await expect(talkTab(page)).toHaveAttribute("aria-current", "page");
  await expect(panel(page).locator(".k-talk-day")).toHaveText(["10/28（火）", "10/30（木）", "11/01（土）"]);
  await expect(articles(page)).toHaveCount(3);
  const taka = postOf(page, "高本 聖斗", "14:02");
  await expect(taka.locator(".k-talk-body")).toHaveText(
    "山田様から、支払期日は月末締め翌月末でよいと返事がありました。",
  );
  await expect(taka).toContainText("知らせた：鈴木");
  await expect(panel(page).locator(".k-talk-line")).toHaveText([
    /高本 がチケットを作った\s*17:44/,
    /高本 が状態を 未着手 → 作業中 に変えた\s*17:50/,
  ]);
  const run = panel(page).locator(".k-talk-run");
  await expect(run).toContainText("高本のAI が請求書を作り、確認を流した");
  await expect(run).toContainText("09:00 → 09:12 ・ 12 分 ・ 実行の記録を見る →");
  await expect(run.locator(".k-badge")).toHaveText("通った");
  await expect(postOf(page, "佐藤 花子", "10:41").locator(".k-talk-changes li")).toHaveText(["状態：作業中 → 保留"]);
  // 並びは古い順：最後が佐藤（新しい物がいちばん下）
  await expect(articles(page).last()).toHaveAttribute("aria-label", "佐藤 花子 10:41");
  await tabs(page).getByRole("button", { name: "属性", exact: true }).click();
  await expect(panel(page).getByRole("region", { name: "担当" })).toBeVisible();
  await expect(feed(page)).toHaveCount(0);
});

test("K392-UI-004 新しい印：最後に開いた時刻より後のほかの人の書き込みに「新しい」。タブを開いたら最後に開いた時刻を書く口（POST /tickets/:id/timeline/seen・seen_at＝いちばん新しい行の時刻）をちょうど 1 回。開いている間は印と数を消さない", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: { new_count: 1 } });
  const seen = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/v1/tickets/${TICKET}/timeline/seen`);
  await openThread(page);
  const req = await seen;
  expect(req.method()).toBe("POST");
  expect(req.postDataJSON()).toEqual({ seen_at: new Date("2025-11-01T10:41:00+09:00").toISOString() });
  await expect(postOf(page, "佐藤 花子", "10:41").locator(".k-talk-new")).toHaveText("新しい");
  await expect(postOf(page, "鈴木 一郎", "10:20").locator(".k-talk-new")).toHaveCount(0);
  await expect(talkTab(page).locator(".k-talk-count")).toHaveText("1");
  await tabs(page).getByRole("button", { name: "属性", exact: true }).click();
  await talkTab(page).click();
  await expect(feed(page)).toBeVisible();
  expect(t.seen, "1 回開いた画面では 1 回だけ").toBe(1);
});

test("K392-UI-005 手順 S2 の失敗：最後に開いた時刻を書く口が 500・網の切れでも、パネルに知らせは出さず一覧はそのまま（次に開いたときにもう一度書く）", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: { new_count: 1 } });
  t.on.seen = () => err(500, "INTERNAL");
  await openThread(page);
  await expect.poll(() => t.seen).toBe(1);
  await expect(articles(page)).toHaveCount(3);
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /11 月分の請求書を送る/ })).toBeVisible();
  await talkTab(page).click();
  await expect.poll(() => t.seen).toBe(2);
});

// ---------------------------------------------------------------- 前の書き込みを見る

test("K392-UI-006 前の書き込みを見る：いちばん上に「前の書き込みを見る（あと 14 件）」。押すといちばん古い行の時刻と id で前の 20 件を読み（before_at・before_id）、上に足す。答えの残りが 0 ならボタンは消える", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: OLDER_14 });
  await openThread(page);
  await expect(moreBtn(page)).toHaveText("前の書き込みを見る（あと 14 件）");
  const oldest = THREAD_FULL()[0]!;
  const older: TimelineItem[] = [post(SUZU_W, "2025-10-27 09:30", "請求の宛先を確かめます")];
  t.on.timeline = () => ok(older, { limit: 20, older_count: 0 });
  await moreBtn(page).click();
  await expect(articles(page)).toHaveCount(4);
  expect(t.reads).toHaveLength(2);
  expect(Object.fromEntries(t.reads[1]!)).toEqual({ limit: "20", before_at: oldest.at, before_id: P_TAKA_ID });
  await expect(articles(page).first()).toHaveAttribute("aria-label", "鈴木 一郎 09:30");
  await expect(panel(page).locator(".k-talk-day").first()).toHaveText("10/27（月）");
  await expect(moreBtn(page)).toHaveCount(0);
});

test("K392-UI-007 手順 S3 の失敗：前の書き込みを読む口が 503・網の切れなら「やり取りを読み込めませんでした」を出し、出ていた行はそのまま・ボタンは残る（押し直すと読める）", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: OLDER_14 });
  await openThread(page);
  t.on.timeline = () => err(503, "SERVICE_UNAVAILABLE");
  await moreBtn(page).click();
  await expect(panel(page).getByRole("alert")).toContainText("やり取りを読み込めませんでした");
  await expect(articles(page)).toHaveCount(3);
  await expect(moreBtn(page)).toHaveText("前の書き込みを見る（あと 14 件）");
  t.on.timeline = () => ok([post(SUZU_W, "2025-10-27 09:30", "前の書き込み")], { limit: 20, older_count: 0 });
  await moreBtn(page).click();
  await expect(articles(page)).toHaveCount(4);
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

// ---------------------------------------------------------------- 絞り込み・並び

test("K392-UI-008 絞り込み：すべて（既定・押されている）・話だけ（filter=talk）・自分あて N（数は答えの mine_count・filter=mine）。替えるたびに読む口を 1 回。当てはまる物が無ければ空の文", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: { mine_count: 1 } });
  await openThread(page);
  await expect(chip(page, "すべて")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, /^自分あて/)).toHaveText("自分あて 1");
  t.on.timeline = () => ok([], meta({ mine_count: 1 }) as unknown as Record<string, unknown>);
  await chip(page, "話だけ").click();
  await expect(chip(page, "話だけ")).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel(page).getByText("まだやり取りはありません。気づいたこと・聞きたいことを書いてください"),
  ).toBeVisible();
  expect(t.reads.at(-1)!.get("filter")).toBe("talk");
  t.on.timeline = () => ok([P_SUZU_LIKE()], meta({ mine_count: 1 }) as unknown as Record<string, unknown>);
  await chip(page, /^自分あて/).click();
  await expect(articles(page)).toHaveCount(1);
  expect(t.reads.at(-1)!.get("filter")).toBe("mine");
  t.on.timeline = () => ok(THREAD_FULL(), meta({ mine_count: 1 }) as unknown as Record<string, unknown>);
  await chip(page, "すべて").click();
  await expect(articles(page)).toHaveCount(3);
  expect(t.reads.at(-1)!.has("filter"), "すべては filter を付けない").toBe(false);
  expect(t.reads).toHaveLength(4);
});
const P_SUZU_LIKE = () => post(SUZU_W, "2025-11-01 10:20", "@高本 さん確認お願いします", { mentions: [TAKA_W] });

test("K392-UI-009 並び：「古い順 ▾」を押すと 古い順・新しい順。新しい順にすると新しい物がいちばん上・「前の書き込みを見る」はいちばん下。読み直さない。頁を開き直しても新しい順（その端末だけが覚える）・別の端末（別の文脈）は古い順", async ({
  page,
  browser,
}) => {
  const t = await mockThread(page, { meta: OLDER_14 });
  await openThread(page);
  await panel(page).getByRole("button", { name: "並び：古い順" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([/古い順/, /新しい順/]);
  await page.getByRole("menuitem", { name: /新しい順/ }).click();
  await expect(articles(page).first()).toHaveAttribute("aria-label", "佐藤 花子 10:41");
  const more = await moreBtn(page).boundingBox();
  const last = await articles(page).last().boundingBox();
  expect(more!.y, "前の書き込みを見るは下").toBeGreaterThan(last!.y);
  expect(t.reads).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /11 月分の請求書を送る/ })).toBeVisible();
  await talkTab(page).click();
  await expect(panel(page).getByRole("button", { name: "並び：新しい順" })).toBeVisible();
  await expect(articles(page).first()).toHaveAttribute("aria-label", "佐藤 花子 10:41");
  const other = await browser.newPage();
  await mockThread(other);
  await openThread(other);
  await expect(panel(other).getByRole("button", { name: "並び：古い順" })).toBeVisible();
  await expect(articles(other).last()).toHaveAttribute("aria-label", "佐藤 花子 10:41");
  await other.close();
});

// ---------------------------------------------------------------- 空・読めない・入っていない

test("K392-UI-010 やり取りが空（仕組みの行も無い）：「まだやり取りはありません。気づいたこと・聞きたいことを書いてください」・タブに数は出ない・前の書き込みを見るは出ない", async ({
  page,
}) => {
  await mockThread(page, { items: [], meta: { post_count: 0 } });
  await openThread(page);
  await expect(
    panel(page).getByText("まだやり取りはありません。気づいたこと・聞きたいことを書いてください"),
  ).toBeVisible();
  await expect(talkTab(page).locator(".k-talk-count")).toHaveCount(0);
  await expect(moreBtn(page)).toHaveCount(0);
});

for (const [label, r] of [
  ["503", err(503, "SERVICE_UNAVAILABLE")],
  ["500", err(500, "INTERNAL")],
  ["404", err(404, "NOT_FOUND")],
] as const) {
  test(`K392-UI-011 手順 S1 の失敗（${label}）：パネルの中に「やり取りを読み込めませんでした」と「もう一度読む」。本文と属性はそのまま使える。押すと読み直して一覧`, async ({
    page,
  }) => {
    const t = await mockThread(page);
    t.on.timeline = () => r;
    await openThread(page);
    await expect(panel(page).getByText("やり取りを読み込めませんでした")).toBeVisible();
    await expect(talkTab(page).locator(".k-talk-count")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: /11 月分の請求書を送る/ })).toBeVisible();
    t.on.timeline = () => ok(THREAD_FULL(), meta() as unknown as Record<string, unknown>);
    await panel(page).getByRole("button", { name: "もう一度読む" }).click();
    await expect(articles(page)).toHaveCount(3);
    expect(t.reads).toHaveLength(2);
  });
}

test("K392-UI-011 手順 S1 の失敗（網の切れ）：パネルの中に「やり取りを読み込めませんでした」", async ({ page }) => {
  await mockThread(page);
  await page.route(new RegExp(`/api/v1/tickets/${TICKET}/timeline(\\?|$)`), (route) => route.abort("failed"));
  await openTicketOnly(page);
  await talkTab(page).click();
  await expect(panel(page).getByText("やり取りを読み込めませんでした")).toBeVisible();
});
async function openTicketOnly(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/tickets/${TICKET}`);
  await expect(page.getByRole("heading", { level: 1, name: /11 月分の請求書を送る/ })).toBeVisible();
}

test("K392-UI-012 手順 S1 の失敗（401）：ログインへ（/login?next=%2Ftickets%2F<id>）", async ({ page }) => {
  const t = await mockThread(page);
  t.on.timeline = () => err(401, "UNAUTHENTICATED");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/tickets/${TICKET}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/tickets/${TICKET}`)}`));
});

// ---------------------------------------------------------------- 行の中身

test("K392-UI-013 消した跡：本人が消した行は「高本 が書き込みを消しました」・マネージャーが人の物を消した行は「マネージャーの 佐藤 が 鈴木 の書き込みを消しました」。消した本文はどこにも出ない", async ({
  page,
}) => {
  await mockThread(page, {
    items: [CREATED(), deleted(TAKA_W, TAKA_W, "2025-11-01 11:09"), deleted(SATO_W, SUZU_W, "2025-11-01 11:20", true)],
  });
  await openThread(page);
  await expect(panel(page).locator(".k-talk-line")).toHaveText([
    /高本 がチケットを作った/,
    /高本 が書き込みを消しました\s*11:09/,
    /マネージャーの 佐藤 が 鈴木 の書き込みを消しました\s*11:20/,
  ]);
  await expect(articles(page)).toHaveCount(0);
});

test("K392-UI-014 印：直した書き込みに「直した 11/01 11:05」・☆ の数（☆ 1・自分が押していれば押された形）・決定にした書き込みに「✓ 決定にした」・引用の頭の字（元が消えていても字は残る）", async ({
  page,
}) => {
  await mockThread(page, {
    items: [
      post(TAKA_W, "2025-11-01 11:02", "了解です。10/19 分を外して今日中に送ります", {
        edited_at: new Date("2025-11-01T11:05:00+09:00").toISOString(),
        stars: 2,
        starred: true,
        decided: true,
      }),
      post(SUZU_W, "2025-11-01 11:30", "お願いします", {
        quote: { id: P_SATO_ID, excerpt: "無償で合意済みなら外して OK です。" },
        stars: 1,
      }),
    ],
  });
  await openThread(page);
  const mine = postOf(page, "高本 聖斗", "11:02");
  await expect(mine.locator(".k-talk-post-head")).toContainText("直した 11/01 11:05");
  await expect(mine.getByRole("button", { name: "☆ 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(mine.locator(".k-talk-decided")).toHaveText("✓ 決定にした");
  const suzu = postOf(page, "鈴木 一郎", "11:30");
  await expect(suzu.locator(".k-talk-quote")).toHaveText("無償で合意済みなら外して OK です。");
  await expect(suzu.getByRole("button", { name: "☆ 1" })).toHaveAttribute("aria-pressed", "false");
  await expect(suzu.getByRole("button", { name: "決定にする" })).toBeVisible();
});

test("K392-UI-015 名前：行と知らせた先は呼ばれ方（無ければ正式な名前）・書き込みの頭は正式な名前・本文の @ は札（呼ばれ方）・外したメンバーの書き込みも名前つきで出る（D-128.96）", async ({
  page,
}) => {
  await mockThread(page, {
    items: [
      change(KEN_W, "2025-11-01 09:00", [{ field: "stage", from: "未着手", to: "作業中" }]),
      post(SUZU_W, "2025-11-01 10:20", "@高本 さん、@鈴木 健 さん確認お願いします", {
        mentions: [TAKA_W, KEN_W],
        notified: [TAKA_W, KEN_W],
      }),
    ],
  });
  await openThread(page);
  await expect(panel(page).locator(".k-talk-line").first()).toContainText("鈴木 健 が状態を 未着手 → 作業中 に変えた");
  const p = postOf(page, "鈴木 一郎", "10:20");
  await expect(p.locator(".k-talk-mention")).toHaveText(["@高本", "@鈴木 健"]);
  await expect(p).toContainText("知らせた：高本・鈴木 健");
});

test("K392-UI-016 本文は字として出す：HTML やスクリプトを動かさない・改行はそのまま", async ({ page }) => {
  await mockThread(page, {
    items: [post(SUZU_W, "2025-11-01 10:20", '<img src=x onerror="window.__k392=1"><b>太字</b>\n2 行目')],
  });
  await openThread(page);
  const body = postOf(page, "鈴木 一郎", "10:20").locator(".k-talk-body");
  await expect(body).toContainText('<img src=x onerror="window.__k392=1"><b>太字</b>');
  expect(await body.locator("img, b").count()).toBe(0);
  expect(await cssOf(body, "white-space")).toMatch(/pre-wrap|pre-line/);
  expect(await page.evaluate(() => (window as unknown as { __k392?: number }).__k392)).toBeUndefined();
});

// ---------------------------------------------------------------- 狭い幅の飛び先

for (const w of [375, 768]) {
  test(`K392-UI-017 幅 ${w}：題名の下に「やり取り 3 ↓」（書き込みの数・答えの post_count）。押すとパネルのやり取りまで動き、タブがやり取りになり、最後に開いた時刻を書く`, async ({
    page,
  }) => {
    const t = await mockThread(page, { meta: { new_count: 1 } });
    await openDetail(page, w);
    const jump = page.getByRole("link", { name: "やり取り 3 ↓" });
    await expect(jump).toBeVisible();
    await jump.click();
    await expect(talkTab(page)).toHaveAttribute("aria-current", "page");
    await expect(feed(page)).toBeInViewport();
    await expect.poll(() => t.seen).toBe(1);
  });
}
test("K392-UI-017 幅 1440 と書き込みが 0 件：飛び先は出ない", async ({ page }) => {
  await mockThread(page);
  await openDetail(page, 1440);
  await expect(page.getByRole("link", { name: /^やり取り \d+ ↓/ })).toHaveCount(0);
  const p2 = await page.context().newPage();
  await mockThread(p2, { items: [CREATED()], meta: { post_count: 0 } });
  await openDetail(p2, 375);
  await expect(p2.getByRole("link", { name: /^やり取り \d+ ↓/ })).toHaveCount(0);
  await p2.close();
});

// ---------------------------------------------------------------- 一覧の右に開く詳細・溢れ・キーボード・時刻

test("K392-UI-018 一覧の右に開く詳細（幅 1440・K-252）はパネルを描かないので、読む口を呼ばない", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (/\/timeline(\/|\?|$)/.test(new URL(r.url()).pathname)) asked.push(r.url());
  });
  await mockList(page);
  await openList(page, "/tickets");
  await rowsOf(page).first().getByRole("link", { name: "チケット 1" }).click();
  await expect(page.getByRole("complementary", { name: "チケットの詳細" })).toContainText("チケット 1");
  await page.waitForLoadState("networkidle");
  expect(asked, `一覧の右の詳細 ${idOf(1)}`).toEqual([]);
});

for (const w of [320, 375, 768, 1024, 1440]) {
  test(`K392-UI-019 幅 ${w}：長い本文（区切りの無い長い字・長い名前）でも横溢れ 0・前の書き込みを見るが溢れない`, async ({
    page,
  }) => {
    await mockThread(page, {
      items: [post(SUZU_W, "2025-11-01 10:20", `https://example.com/${"a".repeat(300)}`), ...THREAD_FULL()],
      meta: OLDER_14,
    });
    await openThread(page, w);
    expect(await overflowX(page)).toBe(0);
  });
}

test("K392-UI-020 キーボード：Tab でタブ「やり取り」に移って Enter で開く・絞り込みの札も Tab と Enter で替わる・前の書き込みを見るも Enter で読む", async ({
  page,
}) => {
  const t = await mockThread(page, { meta: OLDER_14 });
  await openDetail(page);
  await talkTab(page).focus();
  await page.keyboard.press("Enter");
  await expect(talkTab(page)).toHaveAttribute("aria-current", "page");
  t.on.timeline = () => ok([], meta() as unknown as Record<string, unknown>);
  await chip(page, "話だけ").focus();
  await page.keyboard.press("Enter");
  await expect(chip(page, "話だけ")).toHaveAttribute("aria-pressed", "true");
  t.on.timeline = () => ok(THREAD_FULL(), meta(OLDER_14) as unknown as Record<string, unknown>);
  await chip(page, "すべて").focus();
  await page.keyboard.press("Enter");
  await expect(moreBtn(page)).toBeVisible();
  t.on.timeline = () => ok([post(SUZU_W, "2025-10-27 09:30", "前の書き込み")], { limit: 20, older_count: 0 });
  await moreBtn(page).focus();
  await page.keyboard.press("Enter");
  await expect(articles(page)).toHaveCount(4);
});

test("K392-UI-021 ブラウザの時間帯が日本でなくても、日付の区切りと時刻は日本時間（10/28（火）・14:02）", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  await mockThread(page);
  await openThread(page);
  await expect(panel(page).locator(".k-talk-day").first()).toHaveText("10/28（火）");
  await expect(postOf(page, "高本 聖斗", "14:02")).toBeVisible();
  await ctx.close();
});

test("K392-UI-022 AI の実行の 1 枚を押すと「実行の記録」の板が開く（属性の「実行の記録をすべて見る」と同じ板）", async ({
  page,
}) => {
  await mockThread(page);
  await openThread(page);
  await panel(page).locator(".k-talk-run").click();
  await expect(page.getByRole("dialog", { name: "実行の記録" })).toBeVisible();
});

test("K392-UI-023 仕組みの行（system）は本文の字をそのまま 1 行で出す（AI に任せた・完了にした など F5 が書いた行）", async ({
  page,
}) => {
  await mockThread(page, {
    items: [
      system(TAKA_W, "2025-11-01 09:00", "高本のAI に任せました"),
      system(null, "2025-11-01 09:30", "承認から 24 時間を過ぎました"),
    ],
  });
  await openThread(page);
  await expect(panel(page).locator(".k-talk-line")).toHaveText([
    /高本のAI に任せました\s*09:00/,
    /承認から 24 時間を過ぎました\s*09:30/,
  ]);
});

test("K392-UI-024 変更の 1 行の字（口の葉 K-387・K-388・K-390・K-391 が書く changes の形）：名前は頭に 1 回・欄ごとの字を「・」でつなぐ。実績・開き直した・保留にした・保留の理由を直した・決定を足した／改めた／取り消した。書き込みの要素の id は msg-<書き込みの id>（K-397・K-398 の飛び先）", async ({
  page,
}) => {
  await mockThread(page, {
    items: [
      change(SATO_W, "2025-11-01 09:00", [{ field: "actual_minutes", from: null, to: "1 時間" }]),
      change(SATO_W, "2025-11-01 09:05", [
        { field: "stage", from: "完了", to: "作業中", note: "開き直した" },
        { field: "actual_minutes", from: "1 時間", to: "30 分" },
      ]),
      change(TAKA_W, "2025-11-01 09:10", [
        { field: "stage", from: "作業中", to: "保留" },
        { field: "hold_reason", from: null, to: "返事待ち" },
        { field: "resume_condition", from: null, to: "返事が来たら" },
      ]),
      change(TAKA_W, "2025-11-01 09:15", [
        { field: "hold_reason", from: "返事待ち", to: "見積の確認待ち" },
        { field: "resume_condition", from: "返事が来たら", to: "11/25 に聞き直す" },
      ]),
      change(TAKA_W, "2025-11-01 09:20", [{ field: "actual_minutes", from: "30 分", to: null }]),
      change(TAKA_W, "2025-11-01 09:25", [
        { field: "decision", from: null, to: "0193c5a0-0000-7000-8000-0000000d0001", note: "add" },
      ]),
      change(TAKA_W, "2025-11-01 09:30", [
        {
          field: "decision",
          from: "0193c5a0-0000-7000-8000-0000000d0001",
          to: "0193c5a0-0000-7000-8000-0000000d0002",
          note: "revise",
        },
      ]),
      change(TAKA_W, "2025-11-01 09:35", [
        { field: "decision", from: "0193c5a0-0000-7000-8000-0000000d0002", to: null, note: "cancel" },
      ]),
      post(SUZU_W, "2025-11-01 10:20", "確認しました", { id: P_TAKA_ID }),
    ],
  });
  await openThread(page);
  await expect(panel(page).locator(".k-talk-line")).toHaveText([
    /^\s*佐藤 が実績を 1 時間 に変えた\s*09:00\s*$/,
    /^\s*佐藤 が開き直した・実績を 30 分 に変えた\s*09:05\s*$/,
    /^\s*高本 が保留にした（理由：返事待ち・再開の条件：返事が来たら）\s*09:10\s*$/,
    /^\s*高本 が保留の理由を直した（理由：見積の確認待ち・再開の条件：11\/25 に聞き直す）\s*09:15\s*$/,
    /^\s*高本 が実績を空にした\s*09:20\s*$/,
    /^\s*高本 が決定を足した\s*09:25\s*$/,
    /^\s*高本 が決定を改めた\s*09:30\s*$/,
    /^\s*高本 が決定を取り消した\s*09:35\s*$/,
  ]);
  await expect(postOf(page, "鈴木 一郎", "10:20")).toHaveAttribute("id", `msg-${P_TAKA_ID}`);
});
