// K-231「承認待ちの画面をキャンバス（Approvals・空は K-219 の ApEmpty）に合わせる」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：04_design/canvas/Approvals.dc.html・ApEmpty.dc.html（K-219・代表の OK の後に正）。口は網の手前で差し替える（前からの土台 approve-complete.harness.ts）。
//   画面の形（実装の役が作る）：header.k-page-head（h1・.k-page-sub「あなたが決めるもの <span>N 件</span>」・続けて裁く）と、
//     本文の箱の中にカード section.k-ap-card 1 つ（道具の行 .k-ap-tools・表 1 つ・下の注記 .k-ap-note）。期限の区切りは表の中の行 tr.k-ap-group。
//   期限の区切りの名前と並びは前からの決め（D-128.36：期限切れ・今日・7 日以内・それより後・期限なし）。行の「承認する」は確かめの小窓を通す（K-229）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { QUEUE, jst, mockApi, openQueue, qrow, rowOf } from "../features/F5/approve-complete.harness";
import { approveVia } from "./approve-modal";
import {
  LINE,
  RED_TEXT,
  ROOT,
  WHITE,
  WIDTHS,
  box,
  countWrites,
  cssOf,
  expectInert,
  fidelityCompareTests,
  fidelityConfigTest,
  firstCharLeft,
  overflowX,
} from "./kit";

const NAVY = "rgb(34, 52, 92)";
const INK = "rgb(19, 27, 39)";
const card = (page: Page) => page.locator("#k-main section.k-ap-card");
const head = (page: Page) => page.locator("header.k-page-head");
const HEADERS = ["", "決めること", "種別", "番号", "題名", "誰から", "確認", "期限", "その場で決める"];
const md = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;
const empty = (page: Page) =>
  mockApi(page).then((m) => {
    m.on.queue = () => ({ status: 200, body: { data: [], meta: { limit: 20, counts: { total: 0 } } } });
    return m;
  });

test("K231-UI-001 見出しの帯：白・下に 1px #DDE2E9・余白 12px 24px・h1「承認待ち」18px・700・「あなたが決めるもの 3 件」", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  expect(await cssOf(head(page), "background-color")).toBe(WHITE);
  expect(await cssOf(head(page), "border-bottom-color")).toBe(LINE);
  expect(await cssOf(head(page), "padding-top")).toBe("12px");
  expect(await cssOf(head(page), "padding-left")).toBe("24px");
  const h1 = head(page).locator("h1");
  await expect(h1).toHaveText("承認待ち");
  expect(await cssOf(h1, "font-size")).toBe("18px");
  expect(await cssOf(h1, "font-weight")).toBe("700");
  await expect(head(page).locator(".k-page-sub")).toHaveText("あなたが決めるもの 3 件");
  await expect(page.locator("h1")).toHaveCount(1);
});

test("K231-UI-002 K63-UI-088 見出しの帯の主ボタン「続けて裁く（3 件）」：紺の形で「あなたが決めるもの 3 件」のすぐ右（間 8px 前後）に在るが押せない（aria-disabled・薄さ 0.55・押しても移らず口も呼ばない）", async ({
  page,
}) => {
  const writes = countWrites(page);
  await mockApi(page);
  await openQueue(page);
  const b = head(page).getByRole("button", { name: "続けて裁く（3 件）" });
  await expect(b).toHaveAttribute("data-variant", "primary");
  const sub = await box(head(page).locator(".k-page-sub"));
  const bb = await box(b);
  expect(Math.abs(bb.x - (sub.x + sub.width) - 8)).toBeLessThanOrEqual(4); // 右の端に寄せない（キャンバスは数のすぐ右）
  await expectInert(page, b, "続けて裁く", writes);
});

test("K231-UI-003 カードは 1 つ（白・線 #DDE2E9・角丸 8）に、道具の行と表が 1 つ。期限ごとに表やカードを分けない", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  await expect(card(page)).toHaveCount(1);
  expect(await cssOf(card(page), "background-color")).toBe(WHITE);
  expect(await cssOf(card(page), "border-top-color")).toBe(LINE);
  expect(await cssOf(card(page), "border-top-left-radius")).toBe("8px");
  await expect(page.locator("#k-main table")).toHaveCount(1);
  await expect(card(page).locator(".k-ap-tools")).toHaveCount(1);
  await expect(page.locator("#k-main caption")).toHaveCount(0);
});

test("K231-UI-004 K63-UI-089 K63-UI-090 K63-UI-091 K63-UI-092 K63-UI-093 K63-UI-094 K63-UI-095 K63-UI-096 K63-UI-097 道具の行：絞り込みの札（すべて 3 は今いる・ほかの 6 つは押せない）・「期限の近い順 ▾」・選んだものをまとめて承認 と 決めた履歴（押せない）", async ({
  page,
}) => {
  const writes = countWrites(page);
  await mockApi(page);
  await openQueue(page);
  const tools = card(page).locator(".k-ap-tools");
  const chips = tools.getByRole("group", { name: "絞り込み" }).getByRole("button");
  await expect(chips).toHaveText([
    "すべて 3",
    "AI の成果物",
    "上位の承認",
    "渡された",
    "判断を仰がれた",
    "決まりの例外",
    "やり方を広げる",
  ]);
  await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
  for (let i = 1; i < 7; i++) {
    const n = (await chips.nth(i).innerText()).trim();
    await expectInert(page, chips.nth(i), n, writes);
  }
  await expect(tools).toContainText("期限の近い順 ▾");
  for (const n of ["選んだものをまとめて承認", "決めた履歴"])
    await expectInert(page, tools.getByRole("button", { name: n }), n, writes);
});

test("K231-UI-005 K63-UI-098 表の列：選ぶ・決めること・種別・番号・題名・誰から・確認・期限・その場で決める。見出しの「まとめて選べるものをすべて選ぶ」は押せない", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const ths = card(page).locator("thead th");
  expect((await ths.allInnerTexts()).map((x) => x.trim())).toEqual(HEADERS);
  const all = card(page).getByRole("checkbox", { name: "まとめて選べるものをすべて選ぶ" });
  await expect(all).toBeDisabled();
});

test("K231-UI-006 期限の区切りは表の中の行：「期限切れ 1 件」「今日 1 件」「期限なし 1 件」の順。赤（#B91C1C）は期限切れだけ・今日と期限なしは赤でない（キャンバスどおり）", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const groups = card(page).locator("tbody tr.k-ap-group");
  await expect(groups).toHaveCount(3);
  expect((await groups.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())).toEqual([
    "期限切れ 1 件",
    "今日 1 件",
    "期限なし 1 件",
  ]);
  expect(await cssOf(groups.nth(0).locator("td"), "color")).toBe(RED_TEXT);
  expect(await cssOf(groups.nth(1).locator("td"), "color")).toBe(INK);
  expect(await cssOf(groups.nth(2).locator("td"), "color")).not.toBe(RED_TEXT);
  expect(await groups.nth(0).locator("td").getAttribute("colspan")).toBe("9");
});

test("K231-UI-007 行のセル：決めること「AI の成果物」は紺の線の札・種別は空（口が返さない）・確認は 12px の字（札にしない）・誰からは「山田のAI」", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const r = rowOf(page, "11 月分の請求書を送る");
  const cells = r.locator("td");
  const kind = cells.nth(1).locator("span").first();
  await expect(kind).toHaveText("AI の成果物");
  expect(await cssOf(kind, "border-top-color")).toBe(NAVY);
  expect(await cssOf(kind, "color")).toBe(NAVY);
  expect((await cells.nth(2).innerText()).trim()).toBe("");
  expect(await cssOf(cells.nth(6), "font-size")).toBe("12px");
  await expect(cells.nth(6)).toHaveText("検査なし（まだ流していません）");
  await expect(cells.nth(6).locator(".k-badge")).toHaveCount(0); // 確認は札にしない
  await expect(cells.nth(5)).toContainText("山田のAI");
});

test("K231-UI-008 K63-UI-100 K63-UI-101 番号はリンク（そのチケットへ）・題名は太さ 500 の黒字のリンク（下線なし）。押すとその行のチケットの詳細へ移る", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const r = rowOf(page, "応募文を出す");
  const num = r.getByRole("link", { name: "EG-140", exact: true });
  await expect(num).toHaveAttribute("href", /\/tickets\/0193c5a0-0000-7000-8000-00000000c066$/);
  const title = r.getByRole("link", { name: "応募文を出す", exact: true });
  expect(await cssOf(title, "font-weight")).toBe("500");
  expect(await cssOf(title, "color")).toBe(INK);
  expect(await cssOf(title, "text-decoration-line")).toBe("none");
  await num.click();
  await expect(page).toHaveURL(/\/tickets\/0193c5a0-0000-7000-8000-00000000c066$/);
});

test("K231-UI-009 期限の書き方：今日は「MM/DD（今日）」（区切りの名前「今日」とちょうど同じ字にしない）・過ぎた期限は「MM/DD」を赤で太さ 500・期限なしは空", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const due = (title: string) => rowOf(page, title).locator("td").nth(7);
  await expect(due("11 月分の請求書を送る")).toHaveText(`${md(jst(0))}（今日）`);
  expect(await cssOf(due("11 月分の請求書を送る"), "color")).not.toBe(RED_TEXT);
  await expect(due("見積を出す")).toHaveText(md(jst(-1)));
  expect(await cssOf(due("見積を出す"), "color")).toBe(RED_TEXT);
  expect(await cssOf(due("見積を出す"), "font-weight")).toBe("500");
  expect((await due("応募文を出す").innerText()).trim()).toBe("");
});

test("K231-UI-010 行のボタン：左に「差し戻す」（白地・線・高さ 28）、右に主（取り消せる行は「承認する」・ほかは「中身を見る」のリンク・紺）で、間 6px", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const acts = (title: string) => rowOf(page, title).locator("td").nth(8);
  const ret = acts("見積を出す").getByRole("button", { name: "差し戻す" });
  const ok = acts("見積を出す").getByRole("button", { name: "承認する", exact: true });
  const a = await box(ret);
  const b = await box(ok);
  expect(b.x).toBeGreaterThan(a.x);
  expect(Math.abs(b.x - (a.x + a.width) - 6)).toBeLessThanOrEqual(1);
  expect(await cssOf(ret, "background-color")).toBe(WHITE);
  expect(Math.round(a.height)).toBe(28);
  expect(await cssOf(ok, "background-color")).toBe(NAVY);
  const open = acts("11 月分の請求書を送る").getByRole("link", { name: "中身を見る" });
  expect(await cssOf(open, "background-color")).toBe(NAVY);
  expect(await cssOf(open, "color")).toBe(WHITE);
  expect((await box(open)).x).toBeGreaterThan(
    (await box(acts("11 月分の請求書を送る").getByRole("button", { name: "差し戻す" }))).x,
  );
});

test("K231-UI-011 K63-UI-099 選ぶの列：取り消せる行は押せないチェック（まとめて承認に入れる）・取り消せない行は「—」（1 件ずつ決める）", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const pick = rowOf(page, "見積を出す").getByRole("checkbox", { name: "まとめて承認に入れる" });
  await expect(pick).toBeDisabled();
  const dash = rowOf(page, "11 月分の請求書を送る").locator("td").first();
  await expect(dash).toHaveText("—");
  await expect(dash.locator('[title="1 件ずつ決める"]')).toHaveCount(1);
  await expect(rowOf(page, "11 月分の請求書を送る").getByRole("checkbox")).toHaveCount(0);
});

test("K231-UI-012 下の注記：「— は 1 件ずつ中身を見て決めるもの（取り消せない操作・あなたが見る項目がある）。押すとチケットの詳細の承認の帯へ」（12px）", async ({
  page,
}) => {
  await mockApi(page);
  await openQueue(page);
  const note = card(page).locator(".k-ap-note");
  await expect(note).toHaveText(
    "— は 1 件ずつ中身を見て決めるもの（取り消せない操作・あなたが見る項目がある）。押すとチケットの詳細の承認の帯へ",
  );
  expect(await cssOf(note, "font-size")).toBe("12px");
});

test("K231-UI-013 空：見出しの横は「あなたが決めるもの 0 件」で続けて裁くは無い。本文は空の箱（点線・角丸 12）に ✓・「いま決めるものはありません」・説明・決めた履歴（押せない）", async ({
  page,
}) => {
  const writes = countWrites(page);
  await empty(page);
  await openQueue(page);
  await expect(head(page).locator(".k-page-sub")).toHaveText("あなたが決めるもの 0 件");
  await expect(head(page).getByRole("button", { name: /続けて裁く/ })).toHaveCount(0);
  const e = page.locator('#k-main [data-state="empty"]');
  await expect(e.getByRole("heading", { name: "いま決めるものはありません" })).toBeVisible();
  await expect(e).toContainText("AI が成果物を作り、確かめが終わると、ここに並びます");
  const mark = e.locator(".k-state-icon");
  await expect(mark).toHaveText("✓");
  expect((await box(mark)).y).toBeLessThan((await box(e.getByRole("heading"))).y); // ✓ は見出しの上（キャンバスの並び）
  expect(await cssOf(e, "border-top-style")).toBe("dashed");
  expect(await cssOf(e, "border-top-left-radius")).toBe("12px");
  await expectInert(page, e.getByRole("button", { name: "決めた履歴" }), "決めた履歴", writes);
  await expect(card(page)).toHaveCount(0);
});

test("K231-UI-014 幅 375：表のカードは出さず、1 件 1 枚のカード（.k-hnd-mcard・K-412・D-148.26）を縦に並べる。カードは画面の中、頁の横溢れ 0・見出しの 1 文字目が画面の中", async ({
  page,
}) => {
  // K-412 が切る段で替えた（2026-11-20・代表の直し：スマホの承認待ちは表を横に送らず 1 件 1 枚のカード。前は「表はカードの中で横に送れる」）
  await mockApi(page);
  await openQueue(page, 375);
  await expect(card(page)).toBeHidden();
  const cards = page.locator("#k-main .k-hnd-mcard");
  await expect(cards).toHaveCount(QUEUE().length);
  for (let i = 0; i < (await cards.count()); i++) {
    const c = await box(cards.nth(i));
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(375);
  }
  expect(await overflowX(page)).toBe(0);
  expect(await firstCharLeft(head(page).locator("h1"))).toBeGreaterThanOrEqual(0);
});

test("K231-UI-015 幅 320・375・768・1024・1440：在る・空のどちらでも横溢れ 0", async ({ page }) => {
  const bad: string[] = [];
  const m = await mockApi(page);
  for (const rows of [QUEUE(), []]) {
    m.on.queue = () => ({ status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } });
    for (const w of WIDTHS) {
      await openQueue(page, w);
      const o = await overflowX(page);
      if (o !== 0) bad.push(`${rows.length} 件・幅 ${w}：${o}px`);
    }
  }
  expect(bad).toEqual([]);
});

test("K231-UI-016 25 件で「もっと見る」：続きは同じ表に読み足され（表は 1 つのまま）、区切りの件数も増える", async ({
  page,
}) => {
  const m = await mockApi(page);
  const ids = Array.from({ length: 25 }, (_, i) => `0193c5a0-0000-7000-8000-0000000a02${String(i).padStart(2, "0")}`);
  const rowsOfPage = (from: number, to: number) =>
    ids.slice(from, to).map((id, i) => qrow(id, { title: `続きの請求書 ${from + i + 1}`, due_on: jst(10) }));
  m.on.queue = (req) =>
    new URL(req.url()).searchParams.get("cursor")
      ? { status: 200, body: { data: rowsOfPage(20, 25), meta: { limit: 20, counts: { total: 25 } } } }
      : { status: 200, body: { data: rowsOfPage(0, 20), meta: { limit: 20, cursor: "c1", counts: { total: 25 } } } };
  await openQueue(page);
  await expect(card(page).locator("tbody tr.k-ap-group")).toHaveText(["それより後 20 件"]);
  await page.getByRole("button", { name: "もっと見る" }).click();
  await expect(page.locator("#k-main table")).toHaveCount(1);
  await expect(card(page).locator("tbody tr.k-ap-group")).toHaveText(["それより後 25 件"]);
});

test("K231-UI-017 台帳：class_ledger に承認待ちの画面（queue.tsx）の未定義のクラスの行（k63-acts）が無い", () => {
  const ledger = JSON.parse(readFileSync(join(ROOT, "scripts/ci/class_ledger.json"), "utf8")) as {
    entries: { cls: string; file: string }[];
  };
  expect(ledger.entries.filter((e) => e.file.endsWith("approve-complete/queue.tsx"))).toEqual([]);
});

test("K231-UI-018 操作要素の表：K-63 の表（07_qa/test-specs/k/approve-complete.md）に、承認待ちの画面に足した操作要素の行が在る（前からの K63-UI-000 が替えずに緑）", () => {
  const mdText = readFileSync(join(ROOT, "07_qa/test-specs/k/approve-complete.md"), "utf8");
  const have = new Set([...mdText.matchAll(/（([a-z]+)）「(.+?)」/g)].map((x) => `${x[1]}|${x[2]}`));
  const want = [
    "button|続けて裁く（3 件）",
    "button|すべて 3",
    "button|AI の成果物",
    "button|上位の承認",
    "button|渡された",
    "button|判断を仰がれた",
    "button|決まりの例外",
    "button|やり方を広げる",
    "button|選んだものをまとめて承認",
    "button|決めた履歴",
    "checkbox|まとめて選べるものをすべて選ぶ",
    "checkbox|まとめて承認に入れる",
    "link|EG-133",
    "link|EG-140",
  ];
  expect(want.filter((k) => !have.has(k))).toEqual([]);
});

test("K231-UI-022 行の承認で区切りが空になると、その区切りの行は消える（「期限切れ 0 件」を出さない）。残りは「今日 1 件」「期限なし 1 件」", async ({
  page,
}) => {
  const m = await mockApi(page);
  await openQueue(page);
  m.on.queue = () => {
    const rows = QUEUE().filter((x) => x.title !== "見積を出す");
    return { status: 200, body: { data: rows, meta: { limit: 20, counts: { total: 2 } } } };
  };
  await approveVia(page, rowOf(page, "見積を出す").getByRole("button", { name: "承認する", exact: true }));
  await expect(card(page).locator("tbody tr.k-ap-group")).toHaveText([/^今日\s+1 件$/, /^期限なし\s+1 件$/]);
  await expect(page.getByRole("main").getByText("0 件", { exact: true })).toHaveCount(0);
});

test("K231-UI-023 口の答えの行が 0 なのに数（counts.total）が 1 以上（数と行の読みのずれ）：表を出さず空の箱、続けて裁くは出さない", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.queue = () => ({ status: 200, body: { data: [], meta: { limit: 20, counts: { total: 2 } } } });
  await openQueue(page);
  await expect(page.locator('#k-main [data-state="empty"]')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(head(page).getByRole("button", { name: /続けて裁く/ })).toHaveCount(0);
});

test("K231-UI-024 題名の下の補足（note があるとき）：題名の下に 12px の灰の字。note が無い行には補足が無い", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.queue = () => {
    const rows = [
      qrow("0193c5a0-0000-7000-8000-0000000a0302", {
        title: "宛名を確かめる",
        note: "承認から 24 時間を過ぎたので聞き直しています",
      }),
      ...QUEUE(),
    ];
    return { status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } };
  };
  await openQueue(page);
  const cell = rowOf(page, "宛名を確かめる").locator("td").nth(4);
  const note = cell.locator(".k-ap-sub");
  await expect(note).toHaveText("承認から 24 時間を過ぎたので聞き直しています");
  expect(await cssOf(note, "font-size")).toBe("12px");
  expect(await cssOf(note, "color")).toBe("rgb(74, 85, 99)");
  expect((await box(note)).y).toBeGreaterThan((await box(cell.getByRole("link", { name: "宛名を確かめる" }))).y);
  await expect(rowOf(page, "見積を出す").locator(".k-ap-sub")).toHaveCount(0);
});

test("K231-UI-025 読めないとき（一覧の口が 500）：見出しの横の数と続けて裁くを出さない（読めない数を 0 件と見せない）", async ({
  page,
}) => {
  const m = await mockApi(page);
  m.on.queue = () => ({ status: 500, body: { error: "internal", code: "E-PAGE-003", message: "いま処理できません" } });
  await openQueue(page);
  await expect(page.getByRole("main").getByRole("button", { name: "もう一度" })).toBeVisible();
  await expect(head(page).locator(".k-page-sub")).toHaveCount(0);
  await expect(head(page).getByRole("button", { name: /続けて裁く/ })).toHaveCount(0);
});

fidelityConfigTest(
  "K231-UI-019 突き合わせの設定：approvals と approvals-empty が enrolled・持ち主 K-231・画面を整える道具に鍵・画面の側のセレクタに .k-panel が無い",
  ["approvals", "approvals-empty"],
  "K-231",
);
fidelityCompareTests("K231-UI-020", "approvals", "Approvals");
fidelityCompareTests("K231-UI-021", "approvals-empty", "ApEmpty");
