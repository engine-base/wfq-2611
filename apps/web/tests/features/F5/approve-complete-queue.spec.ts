// K-161「承認待ちを見る（一覧と 1 件）」の画面の試験（実 Chrome）。親 K-63 の画面の試験を孫ごとに分けたもの（行 ID と中身は分ける前のまま）。
//   操作要素 1 つ＝仕様の 1 行（07_qa/test-specs/k/approve-complete.md・タスクの列が K-161）＝試験 1 本。口は網の手前で差し替える。土台は ./approve-complete.harness.ts。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { expect, row } from "../../_lib/row";
import { WIDTHS } from "../../_lib/api";
import {
  R,
  TICKET,
  TICKET_B,
  TICKET_C,
  MSG,
  jst,
  qrow,
  QUEUE,
  mockApi,
  menuCount,
  openQueue,
  rowOf,
  noOverflow,
  titleLink,
} from "./approve-complete.harness.js";

row(R["K63-UI-001"], async (page) => {
  await mockApi(page);
  for (const w of WIDTHS) {
    await openQueue(page, w);
    if (w >= 768) {
      const order = await page
        .getByRole("main")
        .getByText(/^(期限切れ|今日|7 日以内|それより後|期限なし)$/)
        .allInnerTexts(); // 外枠の「今日」（左のメニュー・下タブ）に当てない
      expect(order).toEqual(["期限切れ", "今日", "期限なし"]);
    } else {
      // 767 以下は 1 件 1 枚のカードを期限の順に（区切りの見出しは無い・D-148.26・K-412 が切る段で替えた 2026-11-20）
      const titles = await page.locator("#k-main .k-hnd-mcard .k-hnd-mcard-title").allInnerTexts();
      expect(titles).toEqual(["見積を出す", "11 月分の請求書を送る", "応募文を出す"]);
    }
    await expect(page.getByRole("main").getByText("3 件", { exact: true })).toBeVisible();
    if (w >= 1440) await menuCount(page, 3); // 左のメニューの数は 1440 で見る。ほかの幅は見出しの横の数だけ
    await noOverflow(page, w);
  }
});
row(R["K63-UI-011"], async (page) => {
  const m = await mockApi(page);
  m.on.queue = () => ({ status: 200, body: { data: [], meta: { limit: 20, counts: { total: 0 } } } });
  await openQueue(page);
  await expect(page.getByText("いま決めるものはありません")).toBeVisible();
  await expect(page.getByRole("main").getByText("0 件", { exact: true })).toBeVisible(); // 見出しの横の数は 0
  // 1440 の左のメニュー（新しい外枠）の「承認待ち」は、0 件のとき数を出さない（決める人の答え answer=3efd1b287ec3）
  const item = page.getByRole("navigation", { name: "メニュー", exact: true }).getByRole("link", { name: /^承認待ち/ });
  await expect(item).toBeVisible();
  await expect(item.locator(".k-nav-badge")).toHaveCount(0);
  await expect(item).not.toContainText("0");
});
row(R["K63-UI-016"], async (page) => {
  await mockApi(page);
  await openQueue(page);
  const r = rowOf(page, "11 月分の請求書を送る");
  await expect(r).toContainText(MSG.checkNone);
  await expect(r).toContainText("山田のAI");
});
titleLink("K63-UI-046", "11 月分の請求書を送る", TICKET);
titleLink("K63-UI-047", "見積を出す", TICKET_B);
titleLink("K63-UI-048", "応募文を出す", TICKET_C);
row(R["K63-UI-050"], async (page) => {
  // 25 件：1 回目は 20 件と cursor（鍵の文字列）。「もっと見る」で cursor つきに 1 回届き、残り 5 件を読み足す。数は 25 のまま
  const m = await mockApi(page);
  const ids = Array.from({ length: 25 }, (_, i) => `0193c5a0-0000-7000-8000-0000000a01${String(i).padStart(2, "0")}`);
  const rowsOfPage = (from: number, to: number) =>
    ids.slice(from, to).map((id, i) => qrow(id, { title: `続きの請求書 ${from + i + 1}`, due_on: jst(from + i) }));
  const CURSOR = Buffer.from(`${jst(19)}|2026-11-09T00:00:00Z|${ids[19]}`).toString("base64url");
  const cursors: (string | null)[] = [];
  m.on.queue = (req) => {
    const c = new URL(req.url()).searchParams.get("cursor");
    cursors.push(c);
    return c
      ? { status: 200, body: { data: rowsOfPage(20, 25), meta: { limit: 20, counts: { total: 25 } } } }
      : { status: 200, body: { data: rowsOfPage(0, 20), meta: { limit: 20, cursor: CURSOR, counts: { total: 25 } } } };
  };
  await openQueue(page);
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: "続きの請求書" })).toHaveCount(20);
  await expect(page.getByRole("main").getByText("25 件", { exact: true })).toBeVisible();
  const more = page.getByRole("button", { name: "もっと見る" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: "続きの請求書" })).toHaveCount(25);
  expect(cursors.filter(Boolean)).toEqual([CURSOR]); // 1 回・もらった cursor をそのまま返す
  await expect(more).toHaveCount(0); // 続きが無ければ消える
  await expect(page.getByRole("main").getByText("25 件", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: "続きの請求書 25" })).toHaveCount(1); // 重複なし
});
row(R["K63-UI-054"], async (page) => {
  // 一覧の口が 500：文と「もう一度」。行は出ない。「もう一度」で口をもう 1 回呼ぶ
  const m = await mockApi(page);
  m.on.queue = () => ({ status: 500, body: { error: "internal", code: "E-PAGE-003", message: "いま処理できません" } });
  await openQueue(page);
  await expect(page.getByRole("main").getByText(MSG.loadFail)).toBeVisible();
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: "請求書" })).toHaveCount(0);
  await expect(page.getByText("いま決めるものはありません")).toHaveCount(0); // 読めないのを「空」と見せない
  const before = m.queueReads;
  m.on.queue = () => {
    const rows = QUEUE();
    return { status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } };
  };
  await page.getByRole("main").getByRole("button", { name: "もう一度" }).click();
  await expect.poll(() => m.queueReads).toBeGreaterThan(before);
  await expect(rowOf(page, "11 月分の請求書を送る")).toHaveCount(1);
  await expect(page.getByRole("main").getByText(MSG.loadFail)).toHaveCount(0);
});
