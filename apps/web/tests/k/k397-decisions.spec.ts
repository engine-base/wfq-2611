// K-397「本文の決定ログの区画（一覧・空・読めない）と決定を足す小窓」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：/dev/mock/f6/dec-log・dec-empty・dec-add（本番と同じ部品 features/F6/decisions/views.tsx・K-382 が本線に入れる・下絵 OK answer=fabd031f9b37）。
//   見比べは共通の道具 stage2-match.ts の matchMock だけ。口の差し替えと手順は共通の道具 decisions-mock.ts（この葉が持ち、K-398 も読む）。
//   期待は代表の答え（⑧ ⑯ ⑰ ⑱ ⑳ ㉒・answer=eaa451436670・f5cd1647389f）・決定（D-125.63・D-130.1・D-145.9）とモックから書く。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, test, type Page, type Route } from "@playwright/test";
import type { FidelityPair } from "../../../../scripts/ci/fidelity_compare.mjs";
import {
  D0,
  D1,
  D2,
  D3,
  ME,
  MSG_ID,
  SUZUKI,
  TICKET,
  addBtn,
  addDialog,
  dec,
  decisionsApi,
  detailWithDecisions,
  items,
  logSec,
  openDetail,
  type Decision,
} from "./decisions-mock";
import { idOf, item as listItem, mockList, ok, open as openList } from "./list-mock";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

test.use({ timezoneId: "Asia/Tokyo" });

const MSG = {
  empty: "まだ決定はありません。決めたことと理由を残すと、あとから根拠として引けます", // モック dec-empty
  failed: "決定を読み込めませんでした", // モック（talk と同じ形の読めない箱）
  textReq: "決めたことを書いてください", // E-VAL-042（口の葉 K-390 が正本に足す・モック dec-add と同じ）
  byInvalid: "決めた人は、この会社のメンバーから選んでください", // 404 E-PAGE-001 の欄 decided_by_member_id の文（K-390）
  aiInert: "AI が一文にまとめた案 ── AI の案は、自分の AI と話す画面ができてから使えます", // ⑯
  peopleFailed: "ほかのメンバーを読み込めませんでした（自分を選べます）", // 切る段の仮
  gone: "元の書き込みは消されました", // ⑪
  forbidden:
    "この画面を見る権限がありません。見る必要があれば、マネージャーに頼めます。頼んだことは相手に知らせ、記録に残ります", // E-PAGE-002
  maintenance: "いまメンテナンス中です。終わると自動でこの画面が切り替わります。書きかけはこの PC に残っています", // E-PAGE-004
  loadFailed:
    "読み込めませんでした。ネットにつながっていないか、Kaname が混み合っています。書きかけのものはこの PC に残っています", // E-PAGE-007
} as const;

const textOf = (page: Page) => addDialog(page).getByRole("textbox", { name: /決めたこと/ });
const reasonOf = (page: Page) => addDialog(page).getByRole("textbox", { name: "理由", exact: true });
const noteOf = (page: Page) => addDialog(page).getByRole("textbox", { name: "ひとこと" });
const byOf = (page: Page) => addDialog(page).getByRole("combobox", { name: "決めた人" });
const sendBtn = (page: Page) => addDialog(page).getByRole("button", { name: "決定を足す" });
const openAdd = async (page: Page) => {
  await addBtn(page).click();
  await expect(addDialog(page)).toBeVisible();
};
const pickBy = async (page: Page, name: string) => {
  await byOf(page).click();
  await page.getByRole("option", { name }).click();
};
const over = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------------------------------------------------------------- モックと本番の突き合わせ
const BOX = ["width", "height", "x", "y", "background-color", "border-top-color", "border-top-left-radius"];
const TEXT = ["font-size", "font-weight", "color", "line-height", "texts"];
const FLOW = ["width", "height", "background-color", "border-top-color", "border-top-left-radius"];
const DEC_PAIRS: FidelityPair[] = (
  [
    ["dec-h2", "#sec-decisions", TEXT],
    ["dec-add", ".k-dec-head button", [...FLOW, "font-size", "color", "texts"]],
    ["dec-intro", ".k-dec-intro", TEXT],
    ["dec-empty", ".k-dec-empty", TEXT],
    ["dec-item", ".k-dec-item", FLOW],
    ["dec-text", ".k-dec-text", [...TEXT, "text-decoration-line"]],
    ["dec-tag", ".k-dec-tag", [...FLOW, ...TEXT]],
    ["dec-sub", ".k-dec-sub", TEXT],
    ["dec-acts", ".k-dec-acts button", [...FLOW, "font-size", "color", "texts"]],
    ["dialog", '[role="dialog"] .k-dialog-head', BOX],
    ["dialog-title", '[role="dialog"] .k-dialog-title', ["x", "y", ...TEXT]],
    ["dialog-label", '[role="dialog"] .k-label', ["x", "y", ...TEXT]],
    ["dialog-input", '[role="dialog"] .k-input', BOX],
    ["dialog-err", '[role="dialog"] .k-err', ["x", "y", ...TEXT]],
    ["dialog-inert", '[role="dialog"] .k-dec-inert', [...BOX, ...TEXT]],
    ["dialog-btn", '[role="dialog"] .k-dialog-actions button', [...BOX, "font-size", "color", "texts"]],
  ] as [string, string, string[]][]
).map(([role, sel, props]) => ({ name: role, role, canvas: sel, app: sel, props }));

const DRIVE: Record<string, { list: Decision[]; go: (page: Page) => Promise<void> }> = {
  "dec-log": { list: [D1, D0, D3, D2], go: async (page) => void (await expect(items(page)).toHaveCount(4)) },
  "dec-empty": { list: [], go: async (page) => void (await expect(logSec(page)).toContainText(MSG.empty)) },
  "dec-add": {
    list: [D1, D0, D3, D2],
    go: async (page) => {
      await openAdd(page);
      await sendBtn(page).click();
      await expect(addDialog(page)).toContainText(MSG.textReq);
    },
  },
};
for (const [id, c] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K397-UI-001 ${id} 幅 ${w}：区画の見出し・作るときの字・一覧の行・空の文・小窓の値がモックと同じ（区画は y を比べない）`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(
        browser,
        id,
        w,
        async (page) => {
          await decisionsApi(page, {
            list: c.list,
            asMock: true,
            intro: id === "dec-empty" ? null : "支払いは銀行振込",
          });
          await openDetail(page, w);
          await c.go(page);
        },
        { pairs: DEC_PAIRS, base: "/dev/mock/f6" },
      );
      expect(new Set(rows.map((r) => r.part)), "区画の見出しで比べた").toContain("dec-h2");
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
}

// ---------------------------------------------------------------- 一覧

test("K397-UI-002 生きている 2・改められた 1・取り消した 1：見出し「決定ログ（2）」・その下に作るときの字・並びは 生きている（新しい順）→ 改められた → 取り消した。決定の一覧の口は 1 回", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  await expect(logSec(page).locator("#sec-decisions")).toHaveText("決定ログ（2）");
  await expect(logSec(page).locator(".k-dec-intro")).toHaveText("作るときに書いた字：支払いは銀行振込");
  await expect(items(page).locator(".k-dec-text")).toHaveText([D3.text, D2.text, D1.text, D0.text]);
  const introY = (await logSec(page).locator(".k-dec-intro").boundingBox())!.y;
  const listY = (await items(page).first().boundingBox())!.y;
  expect(introY).toBeLessThan(listY);
  expect(d.reads).toBe(1);
});

test("K397-UI-003 1 件ずつの中身：決めた人とひとこと・理由・元・札「改めた」「改められた」「取り消した」・取り消しの線と注。改められた・取り消した決定に「改める」「取り消す」は無い", async ({
  page,
}) => {
  await decisionsApi(page);
  await openDetail(page);
  const [a, b, c, e] = [0, 1, 2, 3].map((i) => items(page).nth(i));
  await expect(a!.locator(".k-dec-sub")).toHaveText(
    "11/01 鈴木 一郎（先方と合意） ・ 理由：先方の都合による作業のため ・ 元：やり取り 11/01 10:20 →",
  );
  await expect(b!.locator(".k-dec-tag")).toHaveText("改めた");
  await expect(b!.locator(".k-dec-sub")).toContainText("10/20 の決定を改めた");
  await expect(c!.locator(".k-dec-tag")).toHaveText("改められた");
  await expect(c!.locator(".k-dec-sub")).toContainText("新しい決定：支払期日は月末締め翌月末 ↑");
  await expect(e!.locator(".k-dec-tag")).toHaveText("取り消した");
  await expect(e!.locator(".k-dec-sub")).toContainText("取り消し 10/22 佐藤：先方がメールだけでよいと言ったため");
  expect(await e!.locator(".k-dec-text").evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain(
    "line-through",
  );
  for (const it of [c!, e!]) {
    await expect(it.getByRole("button", { name: "改める" })).toHaveCount(0);
    await expect(it.getByRole("button", { name: "取り消す" })).toHaveCount(0);
  }
  for (const it of [a!, b!]) await expect(it.getByRole("button", { name: "改める" })).toBeVisible();
});

test("K397-UI-004 元の書き込み：「元：やり取り 11/01 10:20 →」はリンク（#msg-<id>）。消された元は「元の書き込みは消されました」でリンクではなく、決定の字は残る", async ({
  page,
}) => {
  const gone = dec({
    id: "0193c5a0-0000-7000-8000-0000000d0009",
    text: "見積は 2 通出す",
    source: { id: MSG_ID, at: "2026-11-01T01:20:00Z", deleted: true },
  });
  await decisionsApi(page, { list: [D3, gone] });
  await openDetail(page);
  const link = items(page)
    .nth(0)
    .getByRole("link", { name: /元：やり取り 11\/01 10:20/ });
  await expect(link).toHaveAttribute("href", `#msg-${MSG_ID}`);
  const g = items(page).filter({ hasText: "見積は 2 通出す" });
  await expect(g).toContainText(MSG.gone);
  await expect(g.getByRole("link")).toHaveCount(0);
});

test("K397-UI-005 0 件：見出し「決定ログ」（数なし）・作るときの字・空の文・「＋ 決定を足す」", async ({ page }) => {
  await decisionsApi(page, { list: [] });
  await openDetail(page);
  await expect(logSec(page).locator("#sec-decisions")).toHaveText("決定ログ");
  await expect(logSec(page).locator(".k-dec-intro")).toHaveText("作るときに書いた字：支払いは銀行振込");
  await expect(logSec(page)).toContainText(MSG.empty);
  await expect(addBtn(page)).toBeVisible();
});

test("K397-UI-006 手順 S1 の失敗 503 →「もう一度読む」：赤の箱・「＋ 決定を足す」なし・作るときの字は出る。押すと口をもう 1 回呼び、読めれば一覧", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  d.failRead.push({ status: 503, body: { error: "unavailable", code: "SERVICE_UNAVAILABLE" } });
  await openDetail(page);
  await expect(logSec(page)).toContainText(MSG.failed);
  await expect(addBtn(page)).toHaveCount(0);
  await expect(logSec(page).locator(".k-dec-intro")).toBeVisible();
  await logSec(page).getByRole("button", { name: "もう一度読む" }).click();
  await expect(items(page)).toHaveCount(4);
  await expect(addBtn(page)).toBeVisible();
  expect(d.reads).toBe(2);
});

test("K397-UI-007 区画の字が空（null・空の字）：「作るときに書いた字：」の行は出ない", async ({ page }) => {
  await decisionsApi(page, { intro: null });
  await openDetail(page);
  await expect(items(page)).toHaveCount(4);
  await expect(logSec(page).locator(".k-dec-intro")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await decisionsApi(page, { intro: "" });
  await page.reload();
  await expect(items(page)).toHaveCount(4);
  await expect(logSec(page).locator(".k-dec-intro")).toHaveCount(0);
});

test("K397-UI-008 閲覧のみ（meta.can_write false）：一覧と作るときの字は出る・「＋ 決定を足す」「改める」「取り消す」は 0 個", async ({
  page,
}) => {
  await decisionsApi(page, { canWrite: false });
  await openDetail(page);
  await expect(items(page)).toHaveCount(4);
  await expect(logSec(page).locator(".k-dec-intro")).toBeVisible();
  await expect(addBtn(page)).toHaveCount(0);
  await expect(logSec(page).getByRole("button", { name: "改める" })).toHaveCount(0);
  await expect(logSec(page).getByRole("button", { name: "取り消す" })).toHaveCount(0);
});

// ---------------------------------------------------------------- 足す

test("K397-UI-009 「＋ 決定を足す」の小窓：欄・AI の案のグレーの箱（押せない）・決めた人の既定は本人・候補 3 人・「どこまで効かせる」の欄は無い・本文と食い違う箱は無い・焦点は決めたこと", async ({
  page,
}) => {
  await decisionsApi(page);
  await openDetail(page);
  await openAdd(page);
  const dlg = addDialog(page);
  await expect(dlg.locator(".k-dialog-sub")).toHaveCount(0);
  await expect(textOf(page)).toBeFocused();
  const inert = dlg.locator(".k-dec-inert");
  await expect(inert).toHaveCount(1);
  await expect(inert).toHaveText(MSG.aiInert);
  await expect(inert).toHaveAttribute("aria-disabled", "true");
  await expect(byOf(page)).toContainText("高本 聖斗");
  await byOf(page).click();
  await expect(page.getByRole("option")).toHaveText(["高本 聖斗", "鈴木 一郎", "佐藤 花子"]);
  await page.keyboard.press("Escape");
  // 「どこまで効かせる」の欄は持たない（取引先を持たず選び肢が 1 つになった・PM の決め 2026-11-23・answer=4961f0280e9a）
  await expect(dlg.getByRole("radio")).toHaveCount(0);
  await expect(dlg).not.toContainText("どこまで効かせる");
  await expect(dlg).not.toContainText("取引先");
  await expect(dlg).not.toContainText("本文と食い違う");
  await expect(dlg.getByRole("button", { name: "やめる" })).toBeVisible();
  await expect(sendBtn(page)).toBeVisible();
});

test("K397-UI-010 足す（本人・理由あり）：体は書いたとおりで 1 回・小窓が閉じ、一覧の読み直し 1 回で 1 件目に出て、見出しの数が 1 増える。焦点は「＋ 決定を足す」", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  const before = d.reads;
  await openAdd(page);
  await textOf(page).fill("見積は税込で出す");
  await reasonOf(page).fill("先方の指定");
  await sendBtn(page).click();
  await expect(addDialog(page)).toHaveCount(0);
  await expect(items(page).first().locator(".k-dec-text")).toHaveText("見積は税込で出す");
  await expect(logSec(page).locator("#sec-decisions")).toHaveText("決定ログ（3）");
  expect(d.posts).toEqual([
    { text: "見積は税込で出す", reason: "先方の指定", decided_by_member_id: ME, decided_note: null },
  ]);
  expect(d.reads - before).toBe(1);
  await expect(addBtn(page)).toBeFocused();
});

test("K397-UI-011 決めた人「鈴木 一郎」とひとこと「先方と合意」：体の decided_by_member_id と decided_note・一覧の小さな字は「MM/DD 鈴木 一郎（先方と合意）」で始まる", async ({
  page,
}) => {
  const d = await decisionsApi(page, { list: [] });
  await openDetail(page);
  await openAdd(page);
  await textOf(page).fill("納品は PDF だけ");
  await pickBy(page, "鈴木 一郎");
  await noteOf(page).fill("先方と合意");
  await sendBtn(page).click();
  await expect(items(page)).toHaveCount(1);
  expect(d.posts[0]).toMatchObject({ decided_by_member_id: SUZUKI, decided_note: "先方と合意", reason: null });
  await expect(items(page).first().locator(".k-dec-sub")).toHaveText(/^\d\d\/\d\d 鈴木 一郎（先方と合意）/);
});

test("K397-UI-012 決めたことが空・空白だけ（全角も）：口は 0 回・欄の下に文・小窓は開いたまま。書くと文が消え送れる", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  await openAdd(page);
  await sendBtn(page).click();
  await expect(addDialog(page)).toContainText(MSG.textReq);
  await textOf(page).fill(" 　\n ");
  await sendBtn(page).click();
  await expect(addDialog(page)).toContainText(MSG.textReq);
  expect(d.posts).toEqual([]);
  await textOf(page).fill("請求は月末");
  await expect(addDialog(page)).not.toContainText(MSG.textReq);
  await sendBtn(page).click();
  await expect(addDialog(page)).toHaveCount(0);
  expect(d.posts).toHaveLength(1);
});

test("K397-UI-013 決めたことに 3000 字と改行：削らずに送り、一覧に全部の字が出る（上限を置かない・切り捨てない）", async ({
  page,
}) => {
  const d = await decisionsApi(page, { list: [] });
  await openDetail(page);
  await openAdd(page);
  const long = `${"あ".repeat(1500)}\n${"い".repeat(1499)}`;
  await textOf(page).fill(long);
  await sendBtn(page).click();
  await expect(items(page)).toHaveCount(1);
  expect(d.posts[0]!["text"]).toBe(long);
  expect(
    await items(page)
      .first()
      .locator(".k-dec-text")
      .evaluate((el) => (el.textContent ?? "").length),
  ).toBe(long.length);
});

test("K397-UI-014 決めたこと・理由に <img src=x onerror=alert(1)>：送る体は書いたとおり・一覧に字のまま出て img は 0 個", async ({
  page,
}) => {
  const d = await decisionsApi(page, { list: [] });
  await openDetail(page);
  const evil = "<img src=x onerror=alert(1)>";
  await openAdd(page);
  await textOf(page).fill(evil);
  await reasonOf(page).fill(evil);
  await sendBtn(page).click();
  await expect(items(page).first().locator(".k-dec-text")).toHaveText(evil);
  await expect(items(page).first()).toContainText(`理由：${evil}`);
  await expect(logSec(page).locator("img")).toHaveCount(0);
  expect(d.posts[0]).toMatchObject({ text: evil, reason: evil });
});

test("K397-UI-015 書いてから「やめる」・Esc・×：閉じて口は 0 回。開き直すと欄は空で決めた人は本人。人の一覧の口は 2 回目は呼ばない", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  for (const close of ["やめる", "Escape", "閉じる"] as const) {
    await openAdd(page);
    await expect(textOf(page)).toHaveValue("");
    await expect(byOf(page)).toContainText("高本 聖斗");
    await textOf(page).fill("書きかけ");
    await pickBy(page, "佐藤 花子");
    if (close === "Escape") await page.keyboard.press("Escape");
    else await addDialog(page).getByRole("button", { name: close }).click();
    await expect(addDialog(page)).toHaveCount(0);
  }
  expect(d.posts).toEqual([]);
  expect(d.memberReads).toBe(1);
});

test("K397-UI-016 答えを止めたまま「決定を足す」を 2 回：口はちょうど 1 回・送っている間はボタンが押せない・答えが来たら閉じる", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  await openAdd(page);
  await textOf(page).fill("見積は税込");
  const open = d.hold();
  await sendBtn(page).click();
  await sendBtn(page).click({ force: true });
  await expect(sendBtn(page)).toBeDisabled();
  open();
  await expect(addDialog(page)).toHaveCount(0);
  expect(d.posts).toHaveLength(1);
});

// ---------------------------------------------------------------- 失敗

test("K397-UI-017 手順 S2 の失敗 404（決めた人の欄の断り E-PAGE-001・欄 decided_by_member_id）・403（書く権限が外れた）：404（欄つき）は小窓の中の決めた人の欄の下、403 は閉じて区画の中の頭の知らせ・読み直しで「＋ 決定を足す」が消える", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  await openAdd(page);
  await textOf(page).fill("見積は税込");
  d.failWrite.push({
    status: 404,
    body: {
      error: "not_found",
      code: "E-PAGE-001",
      message: "見つかりません",
      field: "decided_by_member_id",
      details: [{ field: "decided_by_member_id", message: MSG.byInvalid }],
    },
  });
  await sendBtn(page).click();
  // 決めた人の欄（combobox を含む欄）の下の断りの字
  const byField = addDialog(page)
    .locator(".k-field")
    .filter({ has: page.getByRole("combobox", { name: "決めた人" }) });
  await expect(byField.locator(".k-err")).toHaveText(MSG.byInvalid);
  await expect(addDialog(page)).toBeVisible();
  d.failWrite.push({ status: 403, body: { error: "forbidden", code: "FORBIDDEN" } });
  d.canWrite = false;
  await sendBtn(page).click();
  await expect(addDialog(page)).toHaveCount(0);
  await expect(logSec(page).locator('[role="alert"]')).toHaveText(MSG.forbidden);
  await expect(addBtn(page)).toHaveCount(0);
  expect(d.posts).toHaveLength(2);
});

test("K397-UI-018 手順 S2 の失敗 503・網の切れ・401：503 と網の切れは小窓を開いたまま字が残り知らせに正本の文・もう一度押すと送れる。401 は /login?next=…", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  await openAdd(page);
  await textOf(page).fill("見積は税込");
  d.failWrite.push({ status: 503, body: { error: "unavailable", code: "SERVICE_UNAVAILABLE" } });
  await sendBtn(page).click();
  await expect(addDialog(page)).toContainText(MSG.maintenance);
  await expect(textOf(page)).toHaveValue("見積は税込");
  d.failWrite.push("abort");
  await sendBtn(page).click();
  await expect(addDialog(page)).toContainText(MSG.loadFailed);
  await expect(textOf(page)).toHaveValue("見積は税込");
  await sendBtn(page).click();
  await expect(addDialog(page)).toHaveCount(0);
  expect(d.posts).toHaveLength(3);
  await openAdd(page);
  await textOf(page).fill("もう 1 つ");
  d.failWrite.push({ status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } });
  await sendBtn(page).click();
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Ftickets%2F${TICKET}$`));
});

test("K397-UI-019 手順 S3 の失敗（人の一覧の口が 503）：決めた人の候補は本人だけ（名前は /me の表示名）・欄の下に文（仮）・本人で送れる", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  d.failMembers.push({ status: 503, body: { error: "unavailable", code: "SERVICE_UNAVAILABLE" } });
  await openDetail(page);
  await openAdd(page);
  await expect(addDialog(page)).toContainText(MSG.peopleFailed);
  await byOf(page).click();
  // 人の一覧が読めないとき本人の名前の出どころは /me だけ（土台の /me の display_name は「高本」）
  await expect(page.getByRole("option")).toHaveText(["高本"]);
  await page.keyboard.press("Escape");
  await textOf(page).fill("見積は税込");
  await sendBtn(page).click();
  await expect(addDialog(page)).toHaveCount(0);
  expect(d.posts[0]).toMatchObject({ decided_by_member_id: ME });
});

// ---------------------------------------------------------------- 幅・口の数・区画が無い

test("K397-UI-020 幅 320・375・768・1024・1440 で区画（4 件）と小窓：横溢れ 0・小窓のボタンは見える所", async ({
  page,
}) => {
  await decisionsApi(page);
  for (const w of [320, 375, 768, 1024, 1440]) {
    await openDetail(page, w);
    await expect(items(page)).toHaveCount(4);
    expect(await over(page), `区画 幅 ${w}`).toBe(0);
    await openAdd(page);
    expect(await over(page), `小窓 幅 ${w}`).toBe(0);
    await expect(sendBtn(page)).toBeInViewport();
    await addDialog(page).getByRole("button", { name: "やめる" }).click();
  }
});

test("K397-UI-021 口の数：開いたとき決定の一覧 1 回・人の一覧 0 回。小窓を開くと人の一覧 1 回（scope_id を付けず limit 200）、開き直しても増えない", async ({
  page,
}) => {
  const d = await decisionsApi(page);
  await openDetail(page);
  await expect(items(page)).toHaveCount(4);
  expect(d.reads).toBe(1);
  expect(d.memberReads).toBe(0);
  await openAdd(page);
  await expect.poll(() => d.memberReads).toBe(1);
  // 同じ会社の今のメンバーを読む（チケットのグループで絞らない・K-390 の「同じ会社の今のメンバーを選べる」）
  expect(d.memberQueries[0]!.has("scope_id")).toBe(false);
  expect(d.memberQueries[0]!.get("limit")).toBe("200");
  await addDialog(page).getByRole("button", { name: "やめる" }).click();
  await openAdd(page);
  await expect(byOf(page)).toContainText("高本 聖斗");
  expect(d.memberReads).toBe(1);
});

test("K397-UI-022 種別に決定ログの区画が無い：決定の一覧は詳細と同時に先読みで 1 回読むが区画は描かず「＋ 決定を足す」は 0 個。一覧の右に開く詳細：決定の一覧の口を呼ばず、区画の字のまま", async ({
  page,
}) => {
  const d = await decisionsApi(page, { intro: "none" });
  await openDetail(page);
  await expect(page.locator("#sec-purpose")).toBeVisible();
  await expect(page.locator("#sec-decisions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "＋ 決定を足す" })).toHaveCount(0);
  // 頁の形の詳細は、区画の有無が詳細の答えで決まる前に決定の一覧を先読みする（直列の段を 1 に保つ・まとめ役の決め）。描かないだけ
  await expect.poll(() => d.reads).toBe(1);
  // 一覧の右に開く詳細（K-252）
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockList(page, { list: () => ok([listItem(1)], { next_cursor: null }) });
  let reads = 0;
  await page.route(`**/api/v1/tickets/${idOf(1)}/decisions`, (route: Route) => {
    reads++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], meta: { can_write: true } }),
    });
  });
  await page.route(`**/api/v1/tickets/${idOf(1)}`, (route: Route) => {
    const t = detailWithDecisions({}) as { ticket: Record<string, unknown> };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...t, ticket: { ...t.ticket, id: idOf(1), number: "EG-101" } } }),
    });
  });
  await openList(page, "/tickets?view=all&open=EG-101");
  const side = page.getByRole("complementary", { name: "チケットの詳細" });
  await expect(side).toContainText("支払いは銀行振込");
  await expect(side.getByRole("button", { name: "＋ 決定を足す" })).toHaveCount(0);
  expect(reads).toBe(0);
});
