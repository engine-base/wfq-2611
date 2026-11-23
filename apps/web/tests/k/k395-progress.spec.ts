// K-395「チケットの詳細で段を変える・保留・実績」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：/dev/mock/f6/prog-menu・prog-hold-dialog・prog-hold-band・prog-locked・prog-time・prog-readonly・prog-reopen・prog-hold-reason
//     （本番と同じ部品 features/F6/progress/views.tsx・K-382 が本線に入れる・下絵 OK answer=fabd031f9b37）。見比べは共通の道具 stage2-match.ts の matchMock だけ。
//   詳細の口は前からの土台 tests/features/F5/approve-complete.harness.ts の mockApi で網の手前で差し替え、getTicket の答えに口の葉 K-387 が足す
//     can.progress・hold・time を重ねる（形は K-395.md の「画面が読む値・送る値」）。段・保留・実績を変える口 updateTicket（PATCH /api/v1/tickets/:id）だけを
//     この試験の差し替えで受ける（後から足した差し替えが先に当たる。GET は土台へ回す）。
//   期待は代表の答え（① ② ③ ④ ⑤ ⑥ ㉒ ㉓・answer=eaa451436670・f5cd1647389f・56812da22008）とモックから書く。固定の待ちは使わない。
//   本人の Bridge（127.0.0.1:38617）には届かせない（土台と matchMock が網の手前で止める）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, test, type Page, type Route } from "@playwright/test";
import type { FidelityPair } from "../../../../scripts/ci/fidelity_compare.mjs";
import { TICKET, mockApi, ticketOf, withBand, type Band, type Mock } from "../features/F5/approve-complete.harness";
import { idOf, item as listItem, mockList, ok, open as openList } from "./list-mock";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

test.use({ timezoneId: "Asia/Tokyo" });

// ---------------------------------------------------------------- 文（代表の答え ㉒・正本 errors.json・モックから。実装から書かない）
const LOCKED = "AI が動いている間と承認待ちの間は、状態を変えられません"; // ㉒・E-CONF-030（K-387）
const MSG = {
  reasonReq: "保留の理由を書いてください", // E-VAL-041（口の葉 K-387 が正本に足す・モック prog-hold-dialog の欄の下の文と同じ字）
  resumeReq: "再開の条件を書いてください", // E-VAL-047（同じ・欄ごとに番号を分けた）
  timeBad: "時間と分は 0 以上の整数で入れてください（分は 0〜59）", // E-VAL-046（仮の番号・この葉の errors.d/K-395.json・切る段の仮の文）
  holdNote: "保留の間も、やり取りと決定は書けます", // ㉒
  aiAuto: "AI が動いた時間（12 分）は自動で足されます", // ㉒ 実績の欄の補足
  onlyDoing: "完了にできるのは作業中のチケットだけです", // E-CONF-019
  tooLong: "100000 分までで入れてください", // 試験の差し替えの口の文（欄の断りの文は口が返す・画面は欄の下にそのまま出す）
  forbidden:
    "この画面を見る権限がありません。見る必要があれば、マネージャーに頼めます。頼んだことは相手に知らせ、記録に残ります", // E-PAGE-002
  gone: "見つかりませんでした。消されたか、見る権限が無いかもしれません", // E-PAGE-001
  maintenance: "いまメンテナンス中です。終わると自動でこの画面が切り替わります。書きかけはこの PC に残っています", // E-PAGE-004
  loadFailed:
    "読み込めませんでした。ネットにつながっていないか、Kaname が混み合っています。書きかけのものはこの PC に残っています", // E-PAGE-007
} as const;
const NAME: Record<string, string> = {
  todo: "未着手",
  doing: "作業中",
  hold: "保留",
  checking: "確認中",
  awaiting_approval: "承認待ち",
  running: "実行中",
  done: "完了",
};

// ---------------------------------------------------------------- 詳細の答え（K-387 が足す欄つき）
interface Hold {
  reason: string;
  resume: string;
  at: string;
  by: string | null;
}
interface Time {
  estimate_minutes: number | null;
  human_minutes: number;
  ai_minutes: number;
}
interface S {
  stage: string;
  /** 段の鍵（null は会社が足した段）。省くと stage と同じ */
  key?: string | null;
  name?: string;
  /** can.progress（書ける人か・仕組みの段の間は口が false を返す） */
  can?: boolean;
  /** can.actual（実績を書けるか・省くと can と同じ。仕組みの段の間でも書ける人なら true・K-387） */
  actual?: boolean;
  hold?: Hold | null;
  time?: Time;
  run?: Record<string, unknown> | null;
  completed?: { at: string; by: string } | null;
  /** モックと同じ題名・番号にする（見比べ） */
  asMock?: boolean;
}
const HOLD: Hold = {
  reason: "先方の検収が終わるまで請求できないため",
  resume: "検収の完了の連絡が来たら",
  at: "2026-11-01T01:41:00Z", // 日本時間 11/01 10:41
  by: "佐藤",
};
const TIME: Time = { estimate_minutes: 30, human_minutes: 60, ai_minutes: 12 };
const DONE = { at: "2026-11-02T06:30:00Z", by: "高本 聖斗" };

function detailOf(s: S): object {
  const b: Band = {
    stage: s.stage,
    can_complete: s.stage === "doing",
    completed: s.stage === "done" ? (s.completed ?? DONE) : null,
    ...(s.run ? { run: s.run } : {}),
  };
  const base = ticketOf(b) as unknown as Record<string, Record<string, unknown>>;
  return withBand(b, {
    ...base,
    ticket: {
      ...base["ticket"],
      start_on: "2026-10-30",
      created_at: "2026-10-30T08:44:00Z",
      ...(s.asMock ? { number: "EG-128", title: "セイコー様へ 11 月分の請求書を送る" } : {}),
    },
    kind: { name: "タスク", color: "#22345C" },
    stage: { key: s.key === undefined ? s.stage : s.key, name: s.name ?? NAME[s.stage] ?? s.stage },
    can: { ...base["can"], progress: s.can ?? true, actual: s.actual ?? s.can ?? true },
    hold: s.stage === "hold" ? (s.hold === undefined ? HOLD : s.hold) : null,
    time: s.time ?? TIME,
  });
}

interface Reply {
  status: number;
  body: unknown;
}
interface Prog {
  m: Mock;
  s: S;
  patches: Record<string, unknown>[];
  /** getTicket を読んだ回数 */
  reads: () => number;
  /** 次の PATCH の答え（順に使う）。"abort" は網の切れ */
  fail: (Reply | "abort")[];
  /** PATCH の答えを止める。返した関数を呼ぶと答える（時間で待たない） */
  hold: () => () => void;
}

/** 詳細を差し替え、updateTicket を受ける。成功した PATCH は答えの状態に写す */
async function progressApi(page: Page, init: S): Promise<Prog> {
  const m = await mockApi(page, { stage: init.stage });
  let reads = 0;
  let gate: Promise<void> = Promise.resolve();
  const p: Prog = {
    m,
    s: { ...init },
    patches: [],
    reads: () => reads,
    fail: [],
    hold: () => {
      let open = () => {};
      gate = new Promise<void>((r) => (open = r));
      return () => open();
    },
  };
  m.on.ticket = () => {
    reads++;
    return { status: 200, body: { data: detailOf(p.s) } };
  };
  const complete = m.on.complete;
  m.on.complete = async (req) => {
    const r = await complete(req);
    p.s = { ...p.s, stage: "done", completed: { at: new Date().toISOString(), by: "高本" } };
    return r;
  };
  await page.route(`**/api/v1/tickets/${TICKET}`, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "PATCH") return route.fallback();
    const body = req.postDataJSON() as Record<string, unknown>;
    p.patches.push(body);
    await gate;
    const f = p.fail.shift();
    if (f === "abort") return route.abort("failed");
    if (f) return route.fulfill({ status: f.status, contentType: "application/json", body: JSON.stringify(f.body) });
    const key = body["stage_key"];
    if (typeof key === "string")
      p.s = {
        ...p.s,
        stage: key,
        key,
        name: NAME[key]!,
        hold:
          key === "hold"
            ? {
                reason: String(body["hold_reason"]),
                resume: String(body["resume_condition"]),
                at: new Date().toISOString(),
                by: "高本",
              }
            : null,
        completed: null,
      };
    if (typeof body["actual_minutes"] === "number")
      p.s = { ...p.s, time: { ...(p.s.time ?? TIME), human_minutes: body["actual_minutes"] } };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: detailOf(p.s) }),
    });
  });
  return p;
}

const openDetail = async (page: Page, width = 1440) => {
  await page.setViewportSize({ width, height: 1000 });
  const res = await page.goto(`/tickets/${TICKET}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};
const meta = (page: Page) => page.locator(".k-detail-meta");
const stageBtn = (page: Page) => meta(page).getByRole("button", { name: /^状態：/ });
const stagePart = (page: Page) => meta(page).locator('[data-part="stage"]');
const menu = (page: Page) => page.getByRole("menu");
/** 訳の字（確かめて完了にする…・作業中にしてから・開き直す・理由を書く）で項目を引く */
const item = (page: Page, text: string) => page.getByRole("menuitem").filter({ hasText: text });
/** 色つきの札の段の鍵で項目を引く（「作業中」の字は「作業中にしてから」にも入るので字では引かない） */
const stageItem = (page: Page, key: string) =>
  page.getByRole("menuitem").filter({ has: page.locator(`.k-detail-stage[data-stage="${key}"]`) });
const holdDialog = (page: Page) => page.getByRole("dialog", { name: "保留にします" });
const band = (page: Page) => page.locator(".k-detail-bands .k-band").filter({ hasText: "保留中です" });
const panel = (page: Page) => page.getByRole("complementary", { name: "チケットのパネル" });
const actual = (page: Page) =>
  panel(page)
    .getByRole("region", { name: "日付と時間" })
    .locator(".k-detail-field")
    .filter({ hasText: "実績" })
    .locator("dd");
const estimate = (page: Page) =>
  panel(page)
    .getByRole("region", { name: "日付と時間" })
    .locator(".k-detail-field")
    .filter({ hasText: "予定" })
    .locator("dd");
const notice = (page: Page) => page.locator('.k-detail-bands [role="alert"]');
const itemTexts = async (page: Page) =>
  (await page.getByRole("menuitem").allTextContents()).map((t) => t.replace(/\s+/g, ""));
const openAttr = async (page: Page) => {
  await panel(page).getByRole("navigation", { name: "パネルのタブ" }).getByRole("button", { name: "属性" }).click();
  await expect(actual(page)).toBeVisible();
};
/** 段のメニューを開いて選ぶ。todo・doing・hold は札の鍵で、ほかは訳の字で引く */
const pickStage = async (page: Page, target: string) => {
  await stageBtn(page).click();
  await expect(menu(page)).toBeVisible();
  await (["todo", "doing", "hold"].includes(target) ? stageItem(page, target) : item(page, target)).click();
};
/** 保留の小窓を開く（作業中から） */
const openHold = async (page: Page) => {
  await pickStage(page, "hold");
  await expect(holdDialog(page)).toBeVisible();
};
const reason = (page: Page) => holdDialog(page).getByRole("textbox", { name: /保留の理由/ });
const resume = (page: Page) => holdDialog(page).getByRole("textbox", { name: /再開の条件/ });

// ---------------------------------------------------------------- モックと本番の突き合わせ（共通の道具 matchMock）
const BOX = ["width", "height", "x", "y", "background-color", "border-top-color", "border-top-left-radius"];
const TEXT = ["font-size", "font-weight", "color", "line-height", "texts"];
const FLOW = ["width", "height", "background-color", "border-top-color", "border-top-left-radius"]; // 流れの中の物は y を比べない
/** 段 7 の進める所の役（モックと本番は同じ部品なので、セレクタは両方で同じ） */
const PROG_PAIRS: FidelityPair[] = (
  [
    ["stage", '.k-detail-meta [data-part="stage"]', [...FLOW.filter((p) => p !== "width"), ...TEXT]],
    ["stage-btn", ".k-detail-meta .k-prog-stage-btn", [...FLOW, "font-size", "color"]],
    ["stage-lock", ".k-detail-meta .k-prog-stage-locked", [...FLOW, ...TEXT]],
    ["menu", ".k-prog-menu", ["width", "background-color", "border-top-color", "border-top-left-radius"]],
    ["menu-item", ".k-prog-menu .k-prog-item", ["height", ...TEXT]],
    ["menu-tag", ".k-prog-menu .k-detail-stage", ["height", "background-color", ...TEXT]],
    ["menu-note", ".k-prog-menu .k-prog-item-note", TEXT],
    ["reason-btn", ".k-detail-meta .k-prog-reason-btn", [...FLOW, "font-size", "color", "texts"]],
    ["reason-box", ".k-prog-reason", ["width", "background-color", "border-top-color", "border-top-left-radius"]],
    ["reason-line", ".k-prog-reason p", TEXT],
    ["dialog", '[role="dialog"] .k-dialog-head', BOX],
    ["dialog-title", '[role="dialog"] .k-dialog-title', ["x", "y", ...TEXT]],
    ["dialog-target", '[role="dialog"] .k-dialog-target', ["x", "y", ...TEXT]],
    ["dialog-label", '[role="dialog"] .k-label', ["x", "y", ...TEXT]],
    ["dialog-input", '[role="dialog"] .k-input', BOX],
    ["dialog-err", '[role="dialog"] .k-err', ["x", "y", ...TEXT]],
    ["dialog-desc", '[role="dialog"] .k-desc', ["x", "y", ...TEXT]],
    ["dialog-btn", '[role="dialog"] .k-dialog-actions button', [...BOX, "font-size", "color", "texts"]],
    ["band", ".k-detail-bands .k-band", [...FLOW, "x"]],
    ["band-title", ".k-detail-bands .k-band-title", TEXT],
    ["band-sub", ".k-detail-bands .k-band-sub", TEXT],
    ["band-line", ".k-detail-bands .k-band-line", TEXT],
    ["band-btn", ".k-detail-bands .k-band-acts button", [...FLOW, "font-size", "color", "texts"]],
    ["time", ".k-detail-panel .k-prog-time", ["height", ...TEXT]],
    ["time-sub", ".k-detail-panel .k-prog-time-sub", TEXT],
    ["time-input", ".k-detail-panel .k-prog-time-edit .k-input", FLOW],
    [
      "time-btn",
      ".k-detail-panel .k-prog-time-edit button, .k-detail-panel .k-prog-time button",
      [...FLOW, "font-size", "color", "texts"],
    ],
  ] as [string, string, string[]][]
).map(([role, sel, props]) => ({ name: role, role, canvas: sel, app: sel, props }));

/** 状態ごとの本番の手順（モックと同じ値にする）。also：既定で比べない役のうち、その状態で比べる物
 *  （帯 band・実績 time は既定で比べない：モックの多くの状態はパネルがやり取りのタブで実績が無く、作業中の状態に今の完了の案内の帯（F5）を描いていない） */
const DRIVE: Record<string, { s: S; go: (page: Page) => Promise<void>; also?: "band" | "time" }> = {
  "prog-menu": {
    s: { stage: "todo", asMock: true },
    go: async (page) => {
      await stageBtn(page).click();
      await expect(menu(page)).toBeVisible();
    },
  },
  "prog-hold-dialog": {
    s: { stage: "doing", asMock: true },
    go: async (page) => {
      await openHold(page);
      await reason(page).fill(HOLD.reason);
      await holdDialog(page).getByRole("button", { name: "保留にする" }).click();
      await expect(holdDialog(page)).toContainText(MSG.resumeReq);
    },
  },
  "prog-hold-band": {
    s: { stage: "hold", asMock: true },
    go: async (page) => void (await expect(band(page)).toBeVisible()),
    also: "band",
  },
  "prog-locked": {
    s: { stage: "awaiting_approval", asMock: true },
    go: async (page) => void (await expect(meta(page).locator(".k-prog-stage-locked")).toBeVisible()),
  },
  "prog-time": {
    s: { stage: "doing", asMock: true },
    go: async (page) => {
      await openAttr(page);
      await actual(page).getByRole("button", { name: "直す" }).click();
      await expect(panel(page).getByRole("textbox", { name: "時間", exact: true })).toBeVisible();
    },
    also: "time",
  },
  "prog-readonly": { s: { stage: "doing", can: false, asMock: true }, go: openAttr, also: "time" },
  "prog-reopen": {
    s: { stage: "done", asMock: true },
    go: async (page) => {
      await stageBtn(page).click();
      await expect(menu(page)).toBeVisible();
    },
    also: "band",
  },
  // 保留の帯が承認と実行の帯に譲っている間の「理由を見る」（㉓）。帯はモックでは置き物（F5 の帯は今のまま）なので帯の役は比べない
  "prog-hold-reason": {
    s: {
      stage: "hold",
      run: { phase: "execute", status: "running", pc: "live" },
      asMock: true,
    },
    go: async (page) => {
      await meta(page).getByRole("button", { name: "理由を見る" }).click();
      await expect(page.locator(".k-prog-reason")).toBeVisible();
    },
  },
};
const pairsOf = (also?: "band" | "time") =>
  PROG_PAIRS.filter(
    (p) => !(p.name.startsWith("band") || p.name.startsWith("time")) || (also && p.name.startsWith(also)),
  );
for (const [id, d] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K395-UI-001 ${id} 幅 ${w}：段の札・メニュー・保留の小窓・保留の帯・実績の値がモックと同じ（流れの中の物は y を比べない・帯と実績はその状態に在るときだけ）`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(
        browser,
        id,
        w,
        async (page) => {
          await progressApi(page, d.s);
          await openDetail(page, w);
          await d.go(page);
        },
        { pairs: pairsOf(d.also), base: "/dev/mock/f6" },
      );
      expect(new Set(rows.map((r) => r.part)), "段の札の役で比べた").toContain("stage");
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
}

// ---------------------------------------------------------------- 段のメニュー

test("K395-UI-002 未着手・書ける人が札を押す（マウス）／Esc で焦点が札に戻り、そこから Enter・↓・Esc（キーボード）：メニューの項目は 未着手 ✓・作業中・保留 理由を書く・完了 作業中にしてから の順で、中は色つきの札。Esc で閉じて焦点は札。開くだけでは口を呼ばない", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  await stageBtn(page).click();
  await expect(menu(page)).toBeVisible();
  expect(await itemTexts(page)).toEqual(["未着手✓", "作業中", "保留理由を書く", "完了作業中にしてから"]);
  const tags = menu(page).locator(".k-detail-stage");
  expect(await tags.evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")))).toEqual([
    "todo",
    "doing",
    "hold",
    "done",
  ]);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(stageBtn(page)).toBeFocused();
  // キーボードだけで開く
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(stageBtn(page)).toBeFocused();
  expect(p.patches).toEqual([]);
});

test('K395-UI-003 未着手で「作業中」を選ぶ：updateTicket が { stage_key: "doing" } でちょうど 1 回・詳細の読み直しが 1 回。札は「作業中」・知らせは出ない', async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  const before = p.reads();
  await pickStage(page, "doing");
  await expect(stagePart(page)).toHaveText("作業中");
  expect(p.patches).toEqual([{ stage_key: "doing" }]);
  await expect.poll(() => p.reads() - before, "読み直しは 1 回").toBe(1);
  await expect(notice(page)).toHaveCount(0);
});

test('K395-UI-004 作業中で札を押す：項目は 未着手・作業中 ✓・保留 理由を書く・完了 確かめて完了にする…。「未着手」を選ぶと { stage_key: "todo" } が 1 回・札は「未着手」', async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await stageBtn(page).click();
  await expect(menu(page)).toBeVisible();
  expect(await itemTexts(page)).toEqual(["未着手", "作業中✓", "保留理由を書く", "完了確かめて完了にする…"]);
  await expect(item(page, "確かめて完了にする")).not.toHaveAttribute("aria-disabled", "true");
  await stageItem(page, "todo").click();
  await expect(stagePart(page)).toHaveText("未着手");
  expect(p.patches).toEqual([{ stage_key: "todo" }]);
});

test("K395-UI-005 作業中で「完了 確かめて完了にする…」→ 今の完了の小窓（対象の行つき）で確かめて完了：updateTicket は呼ばず completeTicket が 1 回、札は「完了」・題名の下に「完了しました（…）」", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await pickStage(page, "確かめて完了にする");
  const dlg = page.getByRole("dialog", { name: "完了にする" });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".k-dialog-target")).toHaveText("EG-133 11 月分の請求書を送る");
  for (const box of await dlg.getByRole("checkbox").all()) await box.check();
  await dlg.getByRole("button", { name: "確かめて完了にする" }).click();
  await expect(stagePart(page)).toHaveText("完了");
  await expect(page.locator(".k-detail-bands")).toContainText("完了しました（");
  expect(p.m.completes).toHaveLength(1);
  expect(p.patches).toEqual([]);
});

test("K395-UI-006 未着手・保留で「完了 作業中にしてから」は押せない：aria-disabled・押しても小窓は開かず口は 0 回", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  for (const st of ["todo", "hold"]) {
    p.s = { stage: st };
    await page.reload();
    await stageBtn(page).click();
    const done = item(page, "作業中にしてから");
    await expect(done).toHaveAttribute("aria-disabled", "true");
    await done.click({ force: true });
    await expect(page.getByRole("dialog", { name: "完了にする" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  expect(p.patches).toEqual([]);
  expect(p.m.completes).toEqual([]);
});

// ---------------------------------------------------------------- 保留

test("K395-UI-007 作業中で保留にする：小窓「保留にします」（対象の行・補足）→ 理由と再開の条件で 1 回送る → 帯「保留中です」に字のまま出る（HTML は動かない・送る体は書いたとおり）", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await openHold(page);
  await expect(holdDialog(page).locator(".k-dialog-target")).toHaveText("EG-133 11 月分の請求書を送る");
  await expect(holdDialog(page)).toContainText(MSG.holdNote);
  await reason(page).fill("先方の検収待ち");
  await resume(page).fill("検収の連絡が来たら");
  await holdDialog(page).getByRole("button", { name: "保留にする" }).click();
  await expect(holdDialog(page)).toHaveCount(0);
  await expect(stagePart(page)).toHaveText("保留");
  await expect(band(page)).toContainText("理由：先方の検収待ち");
  await expect(band(page)).toContainText("再開の条件：検収の連絡が来たら");
  expect(p.patches).toEqual([
    { stage_key: "hold", hold_reason: "先方の検収待ち", resume_condition: "検収の連絡が来たら" },
  ]);
  // HTML やスクリプトの入った理由（TP-XSS-L01）
  const evil = "<img src=x onerror=alert(1)>";
  p.s = { stage: "doing" };
  await page.reload();
  await openHold(page);
  await reason(page).fill(evil);
  await resume(page).fill("すぐ");
  await holdDialog(page).getByRole("button", { name: "保留にする" }).click();
  await expect(band(page)).toContainText(`理由：${evil}`);
  await expect(band(page).locator("img")).toHaveCount(0);
  expect(p.patches.at(-1)).toEqual({ stage_key: "hold", hold_reason: evil, resume_condition: "すぐ" });
});

test("K395-UI-008 保留の小窓の確かめ：両方空・理由だけ・空白だけ（全角も）では口を呼ばず、空の欄の下に文。入れ直すと送れる", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await openHold(page);
  const send = holdDialog(page).getByRole("button", { name: "保留にする" });
  await send.click();
  await expect(holdDialog(page)).toContainText(MSG.reasonReq);
  await expect(holdDialog(page)).toContainText(MSG.resumeReq);
  await reason(page).fill("先方待ち");
  await send.click();
  await expect(holdDialog(page)).not.toContainText(MSG.reasonReq);
  await expect(holdDialog(page)).toContainText(MSG.resumeReq);
  await resume(page).fill(" 　 ");
  await send.click();
  await expect(holdDialog(page)).toContainText(MSG.resumeReq);
  expect(p.patches).toEqual([]);
  await resume(page).fill("返事が来たら");
  await send.click();
  await expect(holdDialog(page)).toHaveCount(0);
  expect(p.patches).toEqual([{ stage_key: "hold", hold_reason: "先方待ち", resume_condition: "返事が来たら" }]);
});

test("K395-UI-009 保留の小窓で書いてから「やめる」・Esc・×：閉じて口は 0 回・札は作業中のまま。開き直すと欄は空", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  for (const close of ["やめる", "Escape", "閉じる"] as const) {
    await openHold(page);
    await expect(reason(page)).toHaveValue("");
    await reason(page).fill("書きかけ");
    if (close === "Escape") await page.keyboard.press("Escape");
    else await holdDialog(page).getByRole("button", { name: close }).click();
    await expect(holdDialog(page)).toHaveCount(0);
    await expect(stagePart(page)).toHaveText("作業中");
  }
  expect(p.patches).toEqual([]);
});

test('K395-UI-010 保留中を開く：帯の小さな字は「11/01 10:41 佐藤 が保留にした」（by が無ければ「11/01 10:41 に保留にした」）。「作業中に戻す」で { stage_key: "doing" } が 1 回・帯は消え札は「作業中」', async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "hold", hold: { ...HOLD, by: null } });
  await openDetail(page);
  await expect(band(page).locator(".k-band-sub")).toHaveText("11/01 10:41 に保留にした");
  p.s = { stage: "hold" };
  await page.reload();
  await expect(band(page).locator(".k-band-sub")).toHaveText("11/01 10:41 佐藤 が保留にした");
  await expect(band(page)).toContainText(`理由：${HOLD.reason}`);
  await expect(band(page)).toContainText(`再開の条件：${HOLD.resume}`);
  await band(page).getByRole("button", { name: "作業中に戻す" }).click();
  await expect(band(page)).toHaveCount(0);
  await expect(stagePart(page)).toHaveText("作業中");
  expect(p.patches).toEqual([{ stage_key: "doing" }]);
});

test("K395-UI-011 保留 ＋ 承認と実行の帯が「実行中」を出している（AI が動いている間は保留の帯が譲る・K-620）：保留の帯は出ず、札の横の「理由を見る」で理由・再開の条件・保留にした人と時刻。保留でない段・帯が出る保留では出ない", async ({
  page,
}) => {
  const running = { phase: "execute", status: "running", pc: "live" };
  const p = await progressApi(page, { stage: "hold", run: running });
  await openDetail(page);
  await expect(page.locator(".k-detail-bands")).toContainText("実行中");
  await expect(band(page)).toHaveCount(0);
  const why = meta(page).getByRole("button", { name: "理由を見る" });
  await why.click();
  const box = page.getByRole("menu");
  await expect(box).toContainText(`理由：${HOLD.reason}`);
  await expect(box).toContainText(`再開の条件：${HOLD.resume}`);
  await expect(box).toContainText("11/01 10:41 佐藤 が保留にした");
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  // 帯が出ている保留・保留でない段では出さない
  p.s = { stage: "hold" };
  await page.reload();
  await expect(band(page)).toBeVisible();
  await expect(meta(page).getByRole("button", { name: "理由を見る" })).toHaveCount(0);
  p.s = { stage: "doing", run: running };
  await page.reload();
  await expect(meta(page).getByRole("button", { name: "理由を見る" })).toHaveCount(0);
  expect(p.patches).toEqual([]);
});

// ---------------------------------------------------------------- 変えられない段・人

test("K395-UI-012 確認中・承認待ち・実行中（書ける人）：鍵の札で button ではない・title と読み上げに訳。押してもメニューは開かず口は 0 回。その間も実績は can.actual で「直す」が出る", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "checking" });
  await openDetail(page);
  for (const st of ["checking", "awaiting_approval", "running"]) {
    p.s = { stage: st };
    await page.reload();
    const lock = meta(page).locator(".k-prog-stage-locked");
    await expect(lock).toHaveText(NAME[st]!);
    await expect(lock).toHaveAttribute("title", LOCKED);
    await expect(lock).toHaveAttribute("aria-label", `${NAME[st]}（${LOCKED}）`);
    await expect(stageBtn(page)).toHaveCount(0);
    await lock.click();
    await expect(menu(page)).toHaveCount(0);
  }
  // 仕組みの段の間は口が can.progress を false で返すが、書ける人なら can.actual は true（実績は入れられる・K-387）
  p.s = { stage: "awaiting_approval", can: false, actual: true };
  await page.reload();
  await expect(meta(page).locator(".k-prog-stage-locked")).toHaveText("承認待ち");
  await openAttr(page);
  await expect(actual(page).getByRole("button", { name: "直す" })).toBeVisible();
  expect(p.patches).toEqual([]);
});

test("K395-UI-013 閲覧のみ（can.progress・can.actual false）× 作業中・保留：札は字だけ・実績に「直す」が無い・保留の帯に「作業中に戻す」が無い・口は 0 回", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing", can: false });
  await openDetail(page);
  await expect(stagePart(page)).toHaveText("作業中");
  await expect(stageBtn(page)).toHaveCount(0);
  await openAttr(page);
  await expect(actual(page).getByRole("button", { name: "直す" })).toHaveCount(0);
  p.s = { stage: "hold", can: false };
  await page.reload();
  await expect(band(page)).toBeVisible();
  await expect(band(page).getByRole("button", { name: "作業中に戻す" })).toHaveCount(0);
  await stagePart(page).click();
  await expect(menu(page)).toHaveCount(0);
  expect(p.patches).toEqual([]);
});

test('K395-UI-014 完了のチケットの札：項目は「完了 ✓」と線の下の「作業中 開き直す」の 2 つだけ。開き直すと { stage_key: "doing" } が 1 回・札は「作業中」・完了の帯は消える', async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "done" });
  await openDetail(page);
  await expect(page.locator(".k-detail-bands")).toContainText("完了しました（");
  await stageBtn(page).click();
  await expect(menu(page)).toBeVisible();
  expect(await itemTexts(page)).toEqual(["完了✓", "作業中開き直す"]);
  await expect(menu(page).locator(".k-prog-sep")).toHaveCount(1);
  await item(page, "開き直す").click();
  await expect(stagePart(page)).toHaveText("作業中");
  await expect(page.locator(".k-detail-bands")).not.toContainText("完了しました（");
  expect(p.patches).toEqual([{ stage_key: "doing" }]);
});

// ---------------------------------------------------------------- 実績

test("K395-UI-015 実績の読む形：人 60・AI 12 は「1 時間 12 分（AI 12 分・人 1 時間）」／AI 0 は「1 時間」（内訳なし）／両方 0 は「0 分」。予定は「30 分」／null は空", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await openAttr(page);
  await expect(actual(page).locator(".k-prog-time")).toContainText("1 時間 12 分（AI 12 分・人 1 時間）");
  await expect(estimate(page)).toHaveText("30 分");
  p.s = { stage: "doing", time: { estimate_minutes: null, human_minutes: 60, ai_minutes: 0 } };
  await page.reload();
  await openAttr(page);
  await expect(actual(page).locator(".k-prog-time")).toHaveText(/^1 時間(直す)?$/);
  await expect(actual(page).locator(".k-prog-time-sub")).toHaveCount(0);
  await expect(estimate(page)).toHaveText("");
  p.s = { stage: "doing", time: { estimate_minutes: null, human_minutes: 0, ai_minutes: 0 } };
  await page.reload();
  await openAttr(page);
  await expect(actual(page).locator(".k-prog-time")).toHaveText(/^0 分(直す)?$/);
});

test("K395-UI-016 実績を直す：欄は今の人の分（1・0）と補足で開き、1 時間 30 分で保存すると { actual_minutes: 90 } が 1 回・読み直しで「1 時間 42 分（AI 12 分・人 1 時間 30 分）」。やめると口は 0 回", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await openAttr(page);
  await actual(page).getByRole("button", { name: "直す" }).click();
  const hours = panel(page).getByRole("textbox", { name: "時間", exact: true });
  const minutes = panel(page).getByRole("textbox", { name: "分", exact: true });
  await expect(hours).toHaveValue("1");
  await expect(minutes).toHaveValue("0");
  await expect(panel(page)).toContainText(MSG.aiAuto);
  await panel(page).getByRole("button", { name: "やめる" }).click();
  await expect(hours).toHaveCount(0);
  expect(p.patches).toEqual([]);
  await actual(page).getByRole("button", { name: "直す" }).click();
  await hours.fill("1");
  await minutes.fill("30");
  await panel(page).getByRole("button", { name: "保存" }).click();
  await expect(actual(page).locator(".k-prog-time")).toContainText("1 時間 42 分（AI 12 分・人 1 時間 30 分）");
  expect(p.patches).toEqual([{ actual_minutes: 90 }]);
});

test("K395-UI-017 実績の入力の確かめ：-1・abc・1.5・分 60 は口を呼ばず欄の下に文。全角「１」「３０」と前後の空白はそろえて 90、両方空は 0 を送る", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await openAttr(page);
  await actual(page).getByRole("button", { name: "直す" }).click();
  const hours = panel(page).getByRole("textbox", { name: "時間", exact: true });
  const minutes = panel(page).getByRole("textbox", { name: "分", exact: true });
  const save = panel(page).getByRole("button", { name: "保存" });
  for (const [h, mm] of [
    ["-1", "0"],
    ["abc", "0"],
    ["1.5", "0"],
    ["1", "60"],
  ]) {
    await hours.fill(h!);
    await minutes.fill(mm!);
    await save.click();
    await expect(panel(page)).toContainText(MSG.timeBad);
  }
  expect(p.patches).toEqual([]);
  await hours.fill(" １ ");
  await minutes.fill("３０");
  await save.click();
  await expect.poll(() => p.patches).toEqual([{ actual_minutes: 90 }]);
  await actual(page).getByRole("button", { name: "直す" }).click();
  await hours.fill("");
  await minutes.fill("");
  await save.click();
  await expect.poll(() => p.patches.at(-1)).toEqual({ actual_minutes: 0 });
});

test("K395-UI-018 時間に 9999：画面は削らずに { actual_minutes: 599940 } を送り、口の 422（欄 actual_minutes・上限 100000 分は K-387）を入力の下に出す・入れた字は残る", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await openAttr(page);
  await actual(page).getByRole("button", { name: "直す" }).click();
  await panel(page).getByRole("textbox", { name: "時間", exact: true }).fill("9999");
  await panel(page).getByRole("textbox", { name: "分", exact: true }).fill("0");
  p.fail.push({
    status: 422,
    body: {
      error: "validation_error",
      code: "VALIDATION_ERROR",
      details: [{ field: "actual_minutes", message: MSG.tooLong }],
    },
  });
  await panel(page).getByRole("button", { name: "保存" }).click();
  await expect(panel(page)).toContainText(MSG.tooLong);
  await expect(panel(page).getByRole("textbox", { name: "時間", exact: true })).toHaveValue("9999");
  expect(p.patches).toEqual([{ actual_minutes: 599940 }]);
});

// ---------------------------------------------------------------- 失敗

test("K395-UI-019 手順 S1 の失敗 409（開いている間にほかの人が AI に任せた）：知らせに正本の文。読み直すと鍵の札「実行中」", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  p.fail.push({ status: 409, body: { error: "conflict", code: "E-CONF-030", message: LOCKED } });
  const r = p.reads();
  await stageBtn(page).click();
  p.s = { stage: "running" }; // ほかの人が任せた後の答え（読み直しで返す）
  await stageItem(page, "doing").click();
  await expect(notice(page)).toHaveText(LOCKED); // E-CONF-030（K-387・㉒ と同じ文）
  await expect(meta(page).locator(".k-prog-stage-locked")).toHaveText("実行中");
  expect(p.patches).toEqual([{ stage_key: "doing" }]);
  expect(p.reads() - r).toBeGreaterThanOrEqual(1);
});

test("K395-UI-020 手順 S1 の失敗 403（書く権限が外れた）・404（消された）：知らせに正本の文・読み直す（403 は字の札・404 は見つからない画面）", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  p.fail.push({ status: 403, body: { error: "forbidden", code: "FORBIDDEN" } });
  await stageBtn(page).click();
  p.s = { stage: "todo", can: false };
  await stageItem(page, "doing").click();
  await expect(notice(page)).toHaveText(MSG.forbidden);
  await expect(stageBtn(page)).toHaveCount(0);
  await expect(stagePart(page)).toHaveText("未着手");
  // 404
  p.s = { stage: "todo" };
  await page.reload();
  p.fail.push({ status: 404, body: { error: "not_found", code: "NOT_FOUND" } });
  await stageBtn(page).click();
  p.m.on.ticket = () => ({ status: 404, body: { error: "not_found", code: "NOT_FOUND" } });
  await stageItem(page, "doing").click();
  await expect(page.getByText(MSG.gone)).toBeVisible();
});

test("K395-UI-021 手順 S1〜S3 の失敗 503・網の切れ：知らせに正本の文。札は前の段のまま。保留の小窓と実績の入力は開いたままで字は残り、もう一度押すと送れる", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  // S1：503
  p.fail.push({ status: 503, body: { error: "unavailable", code: "SERVICE_UNAVAILABLE" } });
  await pickStage(page, "doing");
  await expect(notice(page)).toHaveText(MSG.maintenance);
  await expect(stagePart(page)).toHaveText("未着手");
  // S2：網の切れ（保留の小窓）
  p.s = { stage: "doing" };
  await page.reload();
  await openHold(page);
  await reason(page).fill("先方待ち");
  await resume(page).fill("返事が来たら");
  p.fail.push("abort");
  await holdDialog(page).getByRole("button", { name: "保留にする" }).click();
  await expect(page.getByText(MSG.loadFailed).first()).toBeVisible();
  await expect(holdDialog(page)).toBeVisible();
  await expect(reason(page)).toHaveValue("先方待ち");
  await expect(resume(page)).toHaveValue("返事が来たら");
  await holdDialog(page).getByRole("button", { name: "保留にする" }).click();
  await expect(holdDialog(page)).toHaveCount(0);
  await expect(stagePart(page)).toHaveText("保留");
  // S3：503（実績）
  p.s = { stage: "doing" };
  await page.reload();
  await openAttr(page);
  await actual(page).getByRole("button", { name: "直す" }).click();
  await panel(page).getByRole("textbox", { name: "時間", exact: true }).fill("2");
  p.fail.push({ status: 503, body: { error: "unavailable", code: "SERVICE_UNAVAILABLE" } });
  await panel(page).getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(MSG.maintenance).first()).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "時間", exact: true })).toHaveValue("2");
  await panel(page).getByRole("button", { name: "保存" }).click();
  await expect(actual(page).locator(".k-prog-time")).toContainText("2 時間 12 分");
  expect(p.patches.at(-1)).toEqual({ actual_minutes: 120 });
});

test("K395-UI-022 手順 S1 の失敗 401：/login?next=%2Ftickets%2F<id> へ", async ({ page }) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  p.fail.push({ status: 401, body: { error: "unauthenticated", code: "UNAUTHENTICATED" } });
  await pickStage(page, "doing");
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Ftickets%2F${TICKET}$`));
});

test("K395-UI-023 手順 S4 の失敗：完了の小窓で 409（E-CONF-019・その間に保留にされた）→ 小窓は閉じ、知らせに正本の文・読み直すと札は「保留」", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  await openDetail(page);
  await pickStage(page, "確かめて完了にする");
  const dlg = page.getByRole("dialog", { name: "完了にする" });
  await expect(dlg).toBeVisible();
  for (const box of await dlg.getByRole("checkbox").all()) await box.check();
  p.m.on.complete = () => ({ status: 409, body: { error: "conflict", code: "E-CONF-019", message: MSG.onlyDoing } });
  p.s = { stage: "hold" };
  await dlg.getByRole("button", { name: "確かめて完了にする" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByText(MSG.onlyDoing).first()).toBeVisible();
  await expect(stagePart(page)).toHaveText("保留");
});

// ---------------------------------------------------------------- 操作の揺れ・ほかの段・幅

test("K395-UI-024 答えを止めたまま、段の項目・「保留にする」・「保存」・「作業中に戻す」を 2 回押す：どれも口はちょうど 1 回。送っている間は押せない", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "todo" });
  await openDetail(page);
  // 段の項目
  let open = p.hold();
  await pickStage(page, "doing");
  await expect(stageBtn(page)).toHaveAttribute("aria-disabled", "true");
  await stageBtn(page).click({ force: true });
  await expect(menu(page)).toHaveCount(0);
  open();
  await expect(stagePart(page)).toHaveText("作業中");
  expect(p.patches).toHaveLength(1);
  // 保留にする
  await openHold(page);
  await reason(page).fill("先方待ち");
  await resume(page).fill("返事が来たら");
  open = p.hold();
  const send = holdDialog(page).getByRole("button", { name: "保留にする" });
  await send.click();
  await send.click({ force: true });
  await expect(send).toBeDisabled();
  open();
  await expect(holdDialog(page)).toHaveCount(0);
  expect(p.patches).toHaveLength(2);
  // 作業中に戻す
  open = p.hold();
  const back = band(page).getByRole("button", { name: "作業中に戻す" });
  await back.click();
  await back.click({ force: true });
  open();
  await expect(band(page)).toHaveCount(0);
  expect(p.patches).toHaveLength(3);
  // 保存
  await openAttr(page);
  await actual(page).getByRole("button", { name: "直す" }).click();
  await panel(page).getByRole("textbox", { name: "時間", exact: true }).fill("3");
  open = p.hold();
  const save = panel(page).getByRole("button", { name: "保存" });
  await save.click();
  await save.click({ force: true });
  await expect(save).toBeDisabled();
  open();
  await expect(actual(page).locator(".k-prog-time")).toContainText("3 時間");
  expect(p.patches).toHaveLength(4);
});

test('K395-UI-025 会社が足した段（鍵が null・名前「見積中」）：札は「見積中」・メニューは 4 つの段でどれにも ✓ なし・完了は押せない。「作業中」で { stage_key: "doing" }', async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "custom", key: null, name: "見積中" });
  await openDetail(page);
  await expect(stagePart(page)).toHaveText("見積中");
  await stageBtn(page).click();
  await expect(menu(page)).toBeVisible();
  expect(await itemTexts(page)).toEqual(["未着手", "作業中", "保留理由を書く", "完了作業中にしてから"]);
  await expect(item(page, "作業中にしてから")).toHaveAttribute("aria-disabled", "true");
  await stageItem(page, "doing").click();
  await expect(stagePart(page)).toHaveText("作業中");
  expect(p.patches).toEqual([{ stage_key: "doing" }]);
});

test("K395-UI-026 一覧の右に開く詳細（幅 1440・K-252）× 保留・書ける人：段の札は字の札・保留の帯も「理由を見る」も出ない", async ({
  page,
}) => {
  // 一覧の画面の差し替えは K-251・K-252 の道具（list-mock.ts）。右の詳細の答えだけを、この試験の詳細（保留・書ける人）に替える
  await mockList(page, {
    list: () => ok([listItem(1, { stage: { id: "st", name: "保留", key: "hold" } })], { next_cursor: null }),
  });
  let patches = 0;
  await page.route(`**/api/v1/tickets/${idOf(1)}`, (route: Route) => {
    if (route.request().method() === "PATCH") patches++;
    const d = detailOf({ stage: "hold" }) as { ticket: Record<string, unknown> };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...d, ticket: { ...d.ticket, id: idOf(1), number: "EG-101" } } }),
    });
  });
  await openList(page, "/tickets?view=all&open=EG-101");
  const side = page.getByRole("complementary", { name: "チケットの詳細" });
  await expect(side.locator('[data-part="stage"]')).toHaveText("保留");
  await expect(side.getByRole("button", { name: /^状態：/ })).toHaveCount(0);
  await expect(side.locator(".k-band").filter({ hasText: "保留中です" })).toHaveCount(0);
  await expect(side.getByRole("button", { name: "理由を見る" })).toHaveCount(0);
  expect(patches).toBe(0);
});

test("K395-UI-027 幅 320・375・768・1024・1440 でメニュー・保留の小窓・帯・実績の入力：横溢れ 0。メニューの項目の真ん中は本文の道具の帯の下に潜らない", async ({
  page,
}) => {
  const p = await progressApi(page, { stage: "doing" });
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const w of [320, 375, 768, 1024, 1440]) {
    p.s = { stage: "doing" };
    await openDetail(page, w);
    await stageBtn(page).click();
    await expect(menu(page)).toBeVisible();
    expect(await over(), `メニュー 幅 ${w}`).toBe(0);
    for (const it of await page.getByRole("menuitem").all()) {
      const b = (await it.boundingBox())!;
      const top = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="menuitem"]') !== null,
        [b.x + b.width / 2, b.y + b.height / 2],
      );
      expect(top, `幅 ${w} の項目が上の帯の下に潜らない`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await openHold(page);
    expect(await over(), `保留の小窓 幅 ${w}`).toBe(0);
    await holdDialog(page).getByRole("button", { name: "やめる" }).click();
    p.s = { stage: "hold" };
    await page.reload();
    await expect(band(page)).toBeVisible();
    expect(await over(), `保留の帯 幅 ${w}`).toBe(0);
    await openAttr(page);
    await actual(page).getByRole("button", { name: "直す" }).click();
    expect(await over(), `実績の入力 幅 ${w}`).toBe(0);
  }
});
