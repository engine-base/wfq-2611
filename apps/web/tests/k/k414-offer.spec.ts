// K-414「画面：引き継ぎを申し出る・申し出に答える」の画面の試験（実 Chrome・実装より先に積む・段 9 の切る段）。
//   正の絵：モック /dev/mock/f8/<状態>（f8-offer-entry・f8-offer・f8-offer-answer・f8-offer-band。本番と同じ部品 features/F8/handover/views.tsx）。
//   口は網の手前で差し替える。土台は段 9 の画面の葉の共通の道具 handover-mock.ts（K-400 が運ぶ・前からの approve-complete.harness.ts の上に渡しの口を足す）。
//   申し出だけの口（申し出る・答える・取り消す）の答えはこの試験の中で差し替える（h.on.*）。口の形は K-401 の契約（渡す・答えるの答えは
//   TicketHandoverCreated の 16 の鍵＝道具の created()・答える体は { decision, decline_reason }）・K-405 の読む口（TicketHandover[]・承認待ちの行の
//   primary_action give）・K-406（取り消すの答えは 201 { id, state, decided_at }）に合わせた。申し出の口そのものは K-408 の口の試験が本物の DB で持つ。
//   エラーの文は文言の正本 07_qa/test-specs/errors.json から番号で引く（K-401 の共通の番号。K-408 は申し出だけの番号を足さない）。
//   申し出た人の帯（待っている・受けてもらえた・断られた）の字は D-148.45（代表の答え answer=3d444fc8d59f・勧め (a)）のとおり。
//   入口（申し出のボタン・▾）は getTicket の handover_kinds で決まる（役の名前で出し分けない・PM の決め 2026-11-20）。帯は getTicket の handover から。
//   本人の Bridge（127.0.0.1:38617）には届かせない（土台が 404 にする）。固定の待ちは使わない。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import { ME, TICKET, qrow, type Reply } from "../features/F5/approve-complete.harness";
import {
  AT,
  HND,
  HND_PAIRS,
  NUMBER,
  KIMURA,
  SATO,
  SUZUKI,
  TITLE,
  YAMAGUCHI,
  created,
  errReply,
  handoverRow,
  hview,
  mockHandovers,
  openDetail,
  type HMock,
  type HOptions,
  type HView,
} from "./handover-mock";
import { ROOT, WIDTHS, overflowX } from "./kit";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

const ERRORS = (
  JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
    errors: { id: string; message: string }[];
  }
).errors;
const msg = (id: string): string => ERRORS.find((e) => e.id === id)?.message ?? `(${id} が errors.json に無い)`;
/** 口が断ったときの番号（K-401 の共通の番号。申し出だけの番号は無い・K-408） */
const E = {
  noPerm: "E-HND-002", // このチケットでは、この操作はできません（申し出られない人・D-148.12・D-148.18）
  aiRunning: "E-HND-003", // AI の実行（承認）が終わってから渡してください（D-148.6）
  waiting: "E-HND-004", // いま{名前}さんの返事を待っています…（同時に 1 つだけ・D-148.20）
  decided: "E-HND-005", // この渡しはもう決まっています
  reasonEmpty: "E-HND-007", // 理由を書いてください
  offline: "E-PAGE-008",
  down: "E-PAGE-003", // Kaname の調子が悪い（口の 503）
} as const;
/** 画面の字（モック f8-offer-* の字・決定 D-148.12・D-148.21・D-148.30・D-148.45） */
const T = {
  entry: "引き継ぐ（申し出る）",
  dialog: "引き継ぎを申し出る",
  target: `${NUMBER} ${TITLE}`,
  note: "担当者（高本さん）が「渡す」と答えたら、あなたが担当者になります。",
  reason: "手が空いたので、こちらで返します",
  rowSub: "鈴木さんが引き継ぎを申し出ています ・ 理由：手が空いたので、こちらで返します",
  bandOffered: "鈴木さんが、引き継ぎを申し出ています",
  taken: "鈴木さんが引き継ぎました",
  given: "鈴木さんに渡しました",
  declineNote: "理由は鈴木さんに届き、チケットの記録に残ります。",
  why: "今週中に先方へ私から返すと約束しているため",
  offering: "高本さんに引き継ぎを申し出ています",
  offeringSub: "担当者は返事が来るまで高本さんのまま ・ 11/20 10:05",
  becameMine: "担当者になりました",
  declinedMine: "高本さんに断られました",
} as const;

// ---------------------------------------------------------------- 申し出の渡しと承認待ちの行（形は K-405・名前と時刻はモックと同じ）
const OFFERED_AT = "2026-11-20T01:05:00.000Z"; // 日本の 11/20 10:05（モックの帯の時刻）
const NO = { answer: false, withdraw: false, remind: false, reassign: false };
/** 申し出の渡し（鈴木 → 担当者の高本）。can は見ている人で替える */
const offer = (o: Partial<HView> = {}): HView =>
  hview({
    id: HND,
    kind: "offer",
    from: { member_id: SUZUKI, display_name: "鈴木 一郎" },
    to: { member_id: ME, display_name: "高本 聖斗" },
    reason: T.reason,
    ask: null,
    reply_due: null,
    switch: { children: 0, group: false },
    created_at: OFFERED_AT,
    can: NO,
    ...o,
  });
const offerAtAssignee = (o: Partial<HView> = {}) => offer({ can: { ...NO, answer: true }, ...o });
const offerAtOfferer = (o: Partial<HView> = {}) => offer({ can: { ...NO, withdraw: true }, ...o });
const offerRow = () =>
  handoverRow({
    handover_kind: "offer",
    from_member_id: SUZUKI,
    from_name: "鈴木",
    due_on: "2026-11-27", // 申し出に返事の期限は無いので、並びの鍵はチケットの期限（K-405）
    reply_due: null,
    note: T.reason,
    carry_children: 0,
    primary_action: "give",
    secondary_action: "decline",
    created_at: OFFERED_AT,
  });
const aiRow = () =>
  qrow("0193c5a0-0000-7000-8000-00000f841402", {
    ticket_number: "EG-128",
    title: "セイコー様へ 11月分の請求書を送る",
    from_name: "佐藤のAI",
    check_summary: "通過 3",
    due_on: "2026-11-24",
    decide_inline: true,
    irreversible: false,
    primary_action: "approve",
  });

/** 申し出る人（鈴木・同じグループのメンバー・DB の handover_kinds は offer だけ）の詳細 */
const AS_OFFERER: HOptions = { me: SUZUKI, role: "member", kinds: ["offer"], assignee: ME };
/** 担当者（高本）の詳細・承認待ち（申し出が来ている） */
const AS_ASSIGNEE: HOptions = { list: [offerAtAssignee()], queue: [offerRow(), aiRow()] };

const ok = (data: unknown, status = 200): Reply => ({ status, body: { data } });
interface Bodies {
  creates: Record<string, unknown>[];
  answers: Record<string, unknown>[];
}
/** 申し出の口の答えを、この試験の分だけ差し替える（土台の既定は渡すの形なので）。書いた中身を返す */
function onOffer(h: HMock, setAssignee: (id: string | null) => void): Bodies {
  const seen: Bodies = { creates: [], answers: [] };
  h.on.pass = (req: Request) => {
    seen.creates.push(req.postDataJSON() as Record<string, unknown>);
    const v = offerAtOfferer();
    h.list = [v];
    return ok(created(v), 201);
  };
  h.on.answer = (req: Request) => {
    const b = req.postDataJSON() as Record<string, unknown>;
    seen.answers.push(b);
    const accepted = b["decision"] === "accept";
    const v = offer({
      state: accepted ? "accepted" : "declined",
      decline_reason: (b["decline_reason"] as string | undefined) ?? null,
      decided_at: AT,
    });
    h.list = [v];
    if (accepted) setAssignee(SUZUKI);
    return ok(created(v));
  };
  h.on.withdraw = () => {
    const v = offer({ state: "withdrawn", decided_at: AT });
    h.list = [v];
    return ok({ id: v.id, state: v.state, decided_at: v.decided_at }, 201);
  };
  return seen;
}
/** 承認待ちの行を、答えた後の読み直しで消す（土台の承認待ちの答えを差し替える） */
function queueAfterAnswer(api: Awaited<ReturnType<typeof mockHandovers>>["api"], seen: Bodies) {
  api.on.queue = () => {
    const rows = seen.answers.length ? [aiRow()] : [offerRow(), aiRow()];
    return { status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } };
  };
}

/** 見た目の突き合わせの中で詳細を開く（matchMock が決めた幅と高さのまま・openDetail は高さを替えるので使わない） */
const gotoDetail = async (page: Page) => {
  expect((await page.goto(`/tickets/${TICKET}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('#k-main [aria-busy="true"]')).toHaveCount(0);
};
const openQueue = async (page: Page) => {
  expect((await page.goto("/approvals"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "承認待ち" })).toBeVisible();
};
const entryBtn = (page: Page) => page.getByRole("button", { name: T.entry, exact: true });
const dialogOf = (page: Page, name: string = T.dialog) => page.getByRole("dialog", { name });
const bands = (page: Page) => page.locator(".k-detail-bands .k-band");
const bandOf = (page: Page, title: string) =>
  bands(page).filter({ has: page.locator(".k-band-title", { hasText: title }) });
const assigneeBtn = (page: Page) => page.locator(".k-hnd-assignee-btn");
const offerRowOf = (page: Page) => page.locator("tr.k-hnd-row").filter({ hasText: NUMBER });
const panelAssignee = (page: Page) => page.locator('aside[aria-label="チケットのパネル"] .k-hnd-assignee');
const reasonBox = (page: Page) => dialogOf(page).getByRole("textbox", { name: /^理由/ });

async function expectLikeMock(page: Page, id: string, drive: (p: Page) => Promise<void>) {
  const bad: string[] = [];
  for (const width of MATCH_WIDTHS) {
    const r = await matchMock(page.context().browser()!, id, width, drive, {
      base: "/dev/mock/f8",
      pairs: HND_PAIRS,
      blur: true,
    });
    bad.push(...r.bad);
  }
  expect(bad, "モックと本番の値の違い（px は ±2）").toEqual([]);
}

// ---------------------------------------------------------------- 入口と申し出る小窓（申し出る人：鈴木・同じグループのメンバー）
test("K414-UI-001 入口：担当者でない同じグループのメンバー（鈴木）が詳細を開くと、題名の下に「引き継ぐ（申し出る）」が 1 つ（outlined）出て、右のパネルの担当者は名前だけ（▾ のボタンは 0）。下見の口は呼ばない", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_OFFERER);
  await openDetail(page);
  await expect(entryBtn(page)).toHaveCount(1);
  await expect(entryBtn(page)).toHaveAttribute("data-variant", "outlined");
  await expect(page.locator(".k-hnd-offer")).toBeVisible();
  await expect(panelAssignee(page)).toContainText("高本 聖斗");
  await expect(assigneeBtn(page)).toHaveCount(0);
  expect(h.previewReads, "入口を出すのに下見は読まない").toBe(0);
});

test("K414-UI-002 見た目：f8-offer-entry と本番が幅 375・768・1440 で同じ（題名の下のボタン・パネルの担当者の値）", async ({
  page,
}) => {
  await expectLikeMock(page, "f8-offer-entry", async (p) => {
    await mockHandovers(p, AS_OFFERER);
    await gotoDetail(p);
    await expect(entryBtn(p)).toBeVisible();
  });
});

test("K414-UI-003 「引き継ぐ（申し出る）」を押すと小窓「引き継ぎを申し出る」：対象・理由（必須）・注・やめる／申し出る。「やめる」で閉じ、書く口は 0 回", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_OFFERER);
  await openDetail(page);
  await entryBtn(page).click();
  const d = dialogOf(page);
  await expect(d).toContainText(T.target);
  await expect(reasonBox(page)).toBeVisible();
  await expect(d).toContainText("必須");
  await expect(d.locator(".k-hnd-note")).toHaveText(T.note);
  await expect(d.getByRole("button", { name: "申し出る", exact: true })).toHaveAttribute("data-variant", "primary");
  await d.getByRole("button", { name: "やめる", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(h.passes).toHaveLength(0);
});

test("K414-UI-004 見た目：f8-offer（理由を書いた小窓）と本番が幅 375・768・1440 で同じ", async ({ page }) => {
  await expectLikeMock(page, "f8-offer", async (p) => {
    await mockHandovers(p, AS_OFFERER);
    await gotoDetail(p);
    await entryBtn(p).click();
    await reasonBox(p).fill(T.reason);
  });
});

test("K414-UI-005 入力：理由が空・空白だけ（全角を含む）で「申し出る」→ 欄の下に「理由を書いてください」（aria-invalid）・書く口は 0 回・小窓は開いたまま（D-148.32）", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_OFFERER);
  await openDetail(page);
  await entryBtn(page).click();
  for (const v of ["", "　  "]) {
    await reasonBox(page).fill(v);
    await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
    await expect(dialogOf(page).locator(".k-err")).toHaveText(msg(E.reasonEmpty));
    await expect(reasonBox(page)).toHaveAttribute("aria-invalid", "true");
  }
  await expect(dialogOf(page)).toBeVisible();
  expect(h.passes).toHaveLength(0);
});

test("K414-UI-006 申し出る：口 POST /tickets/:id/handovers に { kind: offer, reason } を冪等キーつきで 1 回 → 小窓が閉じ、題名の下が申し出た人の帯「高本さんに引き継ぎを申し出ています」に替わり、「引き継ぐ（申し出る）」は 0。渡しの並びを読み直す", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_OFFERER);
  const seen = onOffer(h, setAssignee);
  await openDetail(page);
  const reads = h.ticketReads;
  await entryBtn(page).click();
  await reasonBox(page).fill(T.reason);
  await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  expect(seen.creates).toEqual([{ kind: "offer", reason: T.reason }]);
  expect(h.passes[0]!.key, "冪等キーを付ける").toBeTruthy();
  await expect(bandOf(page, T.offering)).toHaveCount(1);
  await expect(entryBtn(page)).toHaveCount(0);
  expect(h.ticketReads, "申し出た後に getTicket を読み直す").toBeGreaterThan(reads);
  expect(h.listReads, "記録の読む口は呼ばない").toBe(0);
});

test("K414-UI-007 失敗：口が 409 E-HND-004（いま別の渡しの返事を待っている）→ 小窓の上の赤い箱に errors.json の文（名前は details から）・書いた理由は残る・小窓は開いたまま（D-148.20・D-148.31）", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_OFFERER);
  h.on.pass = () => errReply(409, E.waiting, { 名前: "佐藤" });
  await openDetail(page);
  await entryBtn(page).click();
  await reasonBox(page).fill(T.reason);
  await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
  await expect(dialogOf(page).getByRole("alert")).toHaveText(msg(E.waiting).replace("{名前}", "佐藤"));
  await expect(reasonBox(page)).toHaveValue(T.reason);
  await expect(bandOf(page, T.offering)).toHaveCount(0);
});

test("K414-UI-008 守り：口が 403 E-HND-002（申し出られない人：ほかのグループ・閲覧のみに替わった）→ 赤い箱に errors.json の文・帯は出ない", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_OFFERER);
  h.on.pass = () => errReply(403, E.noPerm);
  await openDetail(page);
  await entryBtn(page).click();
  await reasonBox(page).fill(T.reason);
  await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
  await expect(dialogOf(page).getByRole("alert")).toHaveText(msg(E.noPerm));
  await expect(bands(page)).toHaveCount(0);
});

test("K414-UI-009 失敗：網が切れた → 赤い箱に E-PAGE-008 の文・書いた理由は残る。網が戻って押し直すと同じ冪等キーで通り、小窓が閉じる", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_OFFERER);
  onOffer(h, setAssignee);
  let down = true;
  const cut: (string | undefined)[] = [];
  await page.route(/\/api\/v1\/tickets\/[^/]+\/handovers$/, (route) => {
    if (!down || route.request().method() !== "POST") return route.fallback();
    cut.push(route.request().headers()["idempotency-key"]); // 網の手前で切った 1 回目の鍵を控える
    return route.abort("internetdisconnected");
  });
  await openDetail(page);
  await entryBtn(page).click();
  await reasonBox(page).fill(T.reason);
  await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
  await expect(dialogOf(page).getByRole("alert")).toHaveText(msg(E.offline));
  await expect(reasonBox(page)).toHaveValue(T.reason);
  down = false;
  await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  // 道具に届く口は 1 回（1 回目は網の手前で切れる）。2 回目の鍵は 1 回目と同じ
  await expect.poll(() => h.passes.length).toBe(1);
  expect(cut).toHaveLength(1);
  expect(h.passes[0]!.key).toBe(cut[0]);
});

test("K414-UI-010 操作の揺れ：答えを待つ間に「申し出る」を 2 回押しても書く口は 1 回（押している間は押せない形）", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_OFFERER);
  onOffer(h, setAssignee);
  await openDetail(page);
  await entryBtn(page).click();
  await reasonBox(page).fill(T.reason);
  const open = h.hold();
  const btn = dialogOf(page).getByRole("button", { name: "申し出る", exact: true });
  await btn.click();
  await expect.poll(() => h.passes.length).toBe(1);
  await btn.click({ force: true });
  open();
  await expect(dialogOf(page)).toHaveCount(0);
  expect(h.passes).toHaveLength(1);
});

test("K414-UI-011 守り：閲覧のみ（山口・viewer）と取引先（木村・requester）は DB の handover_kinds が [] なので、申し出のボタンも担当者の ▾ も出ず、下見の口も呼ばない（D-148.18）", async ({
  browser,
}) => {
  for (const [me, role] of [
    [YAMAGUCHI, "viewer"],
    [KIMURA, "requester"],
  ] as const) {
    const page = await browser.newPage();
    const { h } = await mockHandovers(page, { me, role, kinds: [], assignee: ME });
    await openDetail(page);
    await expect(entryBtn(page)).toHaveCount(0);
    await expect(assigneeBtn(page)).toHaveCount(0);
    expect(h.previewReads).toBe(0);
    await page.close();
  }
});

test("K414-UI-012 担当者本人（高本）には申し出のボタンが出ない（入口は右の ▾ だけ・K-411）", async ({ page }) => {
  await mockHandovers(page);
  await openDetail(page);
  await expect(entryBtn(page)).toHaveCount(0);
});

test("K414-UI-030 入口：ほかのグループのマネージャー（佐藤・role manager・DB の handover_kinds は offer だけ・D-148.12 の「別のグループはそのグループを書ける人」）にも題名の下に「引き継ぐ（申し出る）」が出て、▾ は出ない", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, { me: SATO, role: "manager", kinds: ["offer"], assignee: ME });
  await openDetail(page);
  await expect(entryBtn(page)).toHaveCount(1);
  await expect(assigneeBtn(page)).toHaveCount(0);
  expect(h.previewReads).toBe(0);
});

// ---------------------------------------------------------------- 申し出に答える（担当者：高本）
test("K414-UI-013 承認待ちの申し出の行（高本）：種別「渡された」・番号 EG-119・題名・中身「鈴木さんが引き継ぎを申し出ています ・ 理由：…」・誰から 鈴木・期限は空・ボタン「断る」（outlined）「渡す」（primary）・見出し「2 件」", async ({
  page,
}) => {
  await mockHandovers(page, AS_ASSIGNEE);
  await openQueue(page);
  const row = offerRowOf(page);
  await expect(row).toHaveCount(1);
  await expect(row.locator(".k-ap-kind")).toHaveText("渡された");
  await expect(row.locator(".k-ap-title a")).toHaveText(TITLE);
  await expect(row.locator(".k-ap-sub")).toHaveText(T.rowSub);
  await expect(row.locator(".k-ap-from")).toContainText("鈴木");
  await expect(row.locator("td").nth(7)).toHaveText("");
  await expect(row.getByRole("button", { name: "断る", exact: true })).toHaveAttribute("data-variant", "outlined");
  await expect(row.getByRole("button", { name: "渡す", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(page.locator(".k-page-sub")).toContainText("2 件");
});

test("K414-UI-014 見た目：f8-offer-answer と本番が幅 375（カード）・768・1440（表の行）で同じ", async ({ page }) => {
  await expectLikeMock(page, "f8-offer-answer", async (p) => {
    await mockHandovers(p, AS_ASSIGNEE);
    await openQueue(p);
  });
});

test("K414-UI-015 行の「渡す」→ 口 PATCH /ticket_handovers/:id に { decision: accept } を冪等キーつきで 1 回 → 行が消え「あなたが決めるもの 1 件」・小さな知らせ「鈴木さんに渡しました」", async ({
  page,
}) => {
  const { api, h, setAssignee } = await mockHandovers(page, AS_ASSIGNEE);
  const seen = onOffer(h, setAssignee);
  queueAfterAnswer(api, seen);
  await openQueue(page);
  await offerRowOf(page).getByRole("button", { name: "渡す", exact: true }).click();
  await expect(offerRowOf(page)).toHaveCount(0);
  expect(seen.answers).toEqual([{ decision: "accept" }]);
  expect(h.answers[0]!.key).toBeTruthy();
  await expect(page.locator(".k-page-sub")).toContainText("1 件");
  await expect(page.getByRole("status").filter({ hasText: T.given })).toBeVisible();
});

test("K414-UI-016 行の「断る」→ 断る小窓（題「断る」・断る理由（必須）・注「理由は鈴木さんに届き、チケットの記録に残ります。」）→ 理由 →「断る」→ 口 PATCH に { decision: decline, decline_reason } を 1 回 → 行が消える", async ({
  page,
}) => {
  const { api, h, setAssignee } = await mockHandovers(page, AS_ASSIGNEE);
  const seen = onOffer(h, setAssignee);
  queueAfterAnswer(api, seen);
  await openQueue(page);
  await offerRowOf(page).getByRole("button", { name: "断る", exact: true }).click();
  const d = dialogOf(page, "断る");
  await expect(d.locator(".k-hnd-note")).toHaveText(T.declineNote);
  await d.getByRole("textbox", { name: /^断る理由/ }).fill(T.why);
  await d.getByRole("button", { name: "断る", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(offerRowOf(page)).toHaveCount(0);
  expect(seen.answers).toEqual([{ decision: "decline", decline_reason: T.why }]);
});

test("K414-UI-017 入力：断る理由が空・空白だけ → 欄の下に「理由を書いてください」・書く口は 0 回", async ({ page }) => {
  const { h } = await mockHandovers(page, AS_ASSIGNEE);
  await openQueue(page);
  await offerRowOf(page).getByRole("button", { name: "断る", exact: true }).click();
  const d = dialogOf(page, "断る");
  for (const v of ["", "  　"]) {
    await d.getByRole("textbox", { name: /^断る理由/ }).fill(v);
    await d.getByRole("button", { name: "断る", exact: true }).click();
    await expect(d.locator(".k-err")).toHaveText(msg(E.reasonEmpty));
  }
  expect(h.answers).toHaveLength(0);
});

test("K414-UI-018 失敗：「渡す」が 409 E-HND-003（AI が動いている・承認待ち）→ errors.json の文が知らせ（role=alert）に出て、行は残る（D-148.6）", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_ASSIGNEE);
  h.on.answer = () => errReply(409, E.aiRunning);
  await openQueue(page);
  await offerRowOf(page).getByRole("button", { name: "渡す", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: msg(E.aiRunning) })).toBeVisible();
  await expect(offerRowOf(page)).toHaveCount(1);
});

test("K414-UI-019 時間の流れ：もう決まっていた（申し出が取り消された）→ 409 E-HND-005 の文が知らせに出て、読み直した一覧から行が消える", async ({
  page,
}) => {
  const { api, h } = await mockHandovers(page, AS_ASSIGNEE);
  let gone = false;
  h.on.answer = () => {
    gone = true;
    return errReply(409, E.decided);
  };
  api.on.queue = () => {
    const rows = gone ? [aiRow()] : [offerRow(), aiRow()];
    return { status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } };
  };
  await openQueue(page);
  await offerRowOf(page).getByRole("button", { name: "渡す", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: msg(E.decided) })).toBeVisible();
  await expect(offerRowOf(page)).toHaveCount(0);
});

test("K414-UI-020 詳細の申し出の帯（高本）：題「鈴木さんが、引き継ぎを申し出ています」・時刻 11/20 10:05・理由・断る／渡す。f8-offer-band と幅 375・768・1440 で同じ", async ({
  page,
}) => {
  await mockHandovers(page, AS_ASSIGNEE);
  await openDetail(page);
  const b = bandOf(page, T.bandOffered);
  await expect(b).toHaveCount(1);
  await expect(b.locator(".k-band-sub")).toHaveText("11/20 10:05");
  await expect(b.locator(".k-band-line")).toHaveText(`理由：${T.reason}`);
  await expect(b.getByRole("button", { name: "渡す", exact: true })).toHaveAttribute("data-variant", "primary");
  await expect(b.getByRole("button", { name: "断る", exact: true })).toBeVisible();
  await expectLikeMock(page, "f8-offer-band", async (p) => {
    await mockHandovers(p, AS_ASSIGNEE);
    await gotoDetail(p);
  });
});

test("K414-UI-021 帯の「渡す」→ 口 PATCH { decision: accept } 1 回 → 帯が「鈴木さんが引き継ぎました」（11/20 10:12 ・ 担当者は鈴木さんです）に替わり、パネルの担当者が鈴木 一郎。開き直すと帯は出ない（1 回だけ・D-148.35）", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_ASSIGNEE);
  const seen = onOffer(h, setAssignee);
  await openDetail(page);
  await bandOf(page, T.bandOffered).getByRole("button", { name: "渡す", exact: true }).click();
  await expect(bandOf(page, T.taken)).toHaveCount(1);
  await expect(bandOf(page, T.taken).locator(".k-band-sub")).toHaveText("11/20 10:12 ・ 担当者は鈴木さんです");
  await expect(bandOf(page, T.bandOffered)).toHaveCount(0);
  await expect(panelAssignee(page)).toContainText("鈴木 一郎");
  expect(seen.answers).toEqual([{ decision: "accept" }]);
  await openDetail(page);
  await expect(bands(page)).toHaveCount(0);
});

test("K414-UI-022 帯の「断る」→ 断る小窓 → 理由 →「断る」→ 口 PATCH { decision: decline, decline_reason } 1 回 → 申し出の帯が消え、担当者は高本 聖斗のまま", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_ASSIGNEE);
  const seen = onOffer(h, setAssignee);
  await openDetail(page);
  await bandOf(page, T.bandOffered).getByRole("button", { name: "断る", exact: true }).click();
  const d = dialogOf(page, "断る");
  await d.getByRole("textbox", { name: /^断る理由/ }).fill(T.why);
  await d.getByRole("button", { name: "断る", exact: true }).click();
  await expect(bandOf(page, T.bandOffered)).toHaveCount(0);
  await expect(panelAssignee(page)).toContainText("高本 聖斗");
  expect(seen.answers).toEqual([{ decision: "decline", decline_reason: T.why }]);
});

// ---------------------------------------------------------------- 申し出た人（鈴木）から見た結末（字は D-148.45）
test("K414-UI-023 申し出た人（鈴木）の待っている帯：題「高本さんに引き継ぎを申し出ています」・「担当者は返事が来るまで高本さんのまま ・ 11/20 10:05」・取り消す。取り消す → 口 POST /ticket_handovers/:id/withdraw 1 回 → 帯が消え「引き継ぐ（申し出る）」が戻る", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, { ...AS_OFFERER, list: [offerAtOfferer()] });
  onOffer(h, setAssignee);
  await openDetail(page);
  const b = bandOf(page, T.offering);
  await expect(b.locator(".k-band-sub")).toHaveText(T.offeringSub);
  await expect(entryBtn(page)).toHaveCount(0);
  await b.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(bandOf(page, T.offering)).toHaveCount(0);
  await expect(entryBtn(page)).toHaveCount(1);
  expect(h.withdraws).toEqual([HND]);
});

test("K414-UI-024 申し出た人：受けてもらえた → 帯「担当者になりました」（高本さんから引き継ぎ ・ 11/20 10:12）・パネルの担当者は鈴木 一郎・申し出のボタンは 0。開き直すと帯は出ない（1 回だけ）", async ({
  page,
}) => {
  await mockHandovers(page, {
    ...AS_OFFERER,
    assignee: SUZUKI,
    list: [offer({ state: "accepted", decided_at: AT })],
  });
  await openDetail(page);
  const b = bandOf(page, T.becameMine);
  await expect(b.locator(".k-band-sub")).toHaveText("高本さんから引き継ぎ ・ 11/20 10:12");
  await expect(panelAssignee(page)).toContainText("鈴木 一郎");
  await expect(entryBtn(page)).toHaveCount(0);
  await openDetail(page);
  await expect(bands(page)).toHaveCount(0);
});

test("K414-UI-025 申し出た人：断られた → 帯「高本さんに断られました」・時刻・「理由：…」・ボタンは 0。開き直すと帯は出ず「引き継ぐ（申し出る）」が出る（1 回だけ・D-148.45）", async ({
  page,
}) => {
  await mockHandovers(page, {
    ...AS_OFFERER,
    list: [offer({ state: "declined", decline_reason: T.why, decided_at: AT })],
  });
  await openDetail(page);
  const b = bandOf(page, T.declinedMine);
  await expect(b.locator(".k-band-sub")).toHaveText("11/20 10:12");
  await expect(b.locator(".k-band-line")).toHaveText(`理由：${T.why}`);
  await expect(b.getByRole("button")).toHaveCount(0);
  await openDetail(page);
  await expect(bands(page)).toHaveCount(0);
  await expect(entryBtn(page)).toHaveCount(1);
});

test("K414-UI-029 手順 S3（取り消す口を呼ぶ）の失敗：取り消す口が 503 E-PAGE-003 → 帯の中の role=alert に errors.json の文・申し出の帯はそのまま・入口は出ない", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, { ...AS_OFFERER, list: [offerAtOfferer()] });
  onOffer(h, setAssignee);
  h.on.withdraw = () => ({ status: 503, body: { error: "unavailable", code: E.down, message: E.down } });
  await openDetail(page);
  await bandOf(page, T.offering).getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(page.locator(".k-detail-bands").getByRole("alert")).toContainText(msg(E.down));
  await expect(bandOf(page, T.offering)).toHaveCount(1);
  await expect(entryBtn(page)).toHaveCount(0);
  expect(h.withdraws).toEqual([HND]);
});

// ---------------------------------------------------------------- 幅・入口
test("K414-UI-026 幅 320・375・768・1024・1440：申し出の入口と小窓・申し出の帯・承認待ちの申し出の行で、横のはみ出しが 0", async ({
  browser,
}) => {
  const bad: string[] = [];
  for (const width of WIDTHS) {
    const a = await browser.newPage();
    await mockHandovers(a, AS_OFFERER);
    await openDetail(a, width);
    await entryBtn(a).click();
    await expect(dialogOf(a)).toBeVisible();
    if ((await overflowX(a)) > 0) bad.push(`幅 ${width}・申し出る小窓`);
    await a.close();
    const b = await browser.newPage();
    await mockHandovers(b, AS_ASSIGNEE);
    await openDetail(b, width);
    await expect(bandOf(b, T.bandOffered)).toBeVisible();
    if ((await overflowX(b)) > 0) bad.push(`幅 ${width}・申し出の帯`);
    await openQueue(b);
    if ((await overflowX(b)) > 0) bad.push(`幅 ${width}・承認待ち`);
    await b.close();
  }
  expect(bad).toEqual([]);
});

test("K414-UI-027 利用者の状態：ログインが切れた（申し出る口が 401）→ /login?next=%2Ftickets%2F<id> へ移る", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_OFFERER);
  h.on.pass = () => ({ status: 401, body: { error: "unauthorized", code: "UNAUTHORIZED" } });
  await openDetail(page);
  await entryBtn(page).click();
  await reasonBox(page).fill(T.reason);
  await dialogOf(page).getByRole("button", { name: "申し出る", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
  expect(new URL(page.url()).searchParams.get("next")).toMatch(/^\/tickets\/[0-9a-f-]{36}$/);
});

test("K414-UI-028 幅 375 の承認待ち：申し出の行は 1 枚のカード（「渡された ・ 鈴木さんから」・中身の 1 行・期限の行なし・断る／渡す）で、表は見えない。カードの「渡す」で口 PATCH { decision: accept } 1 回", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { api, h, setAssignee } = await mockHandovers(page, AS_ASSIGNEE);
  const seen = onOffer(h, setAssignee);
  queueAfterAnswer(api, seen);
  await openQueue(page);
  const card = page.locator(".k-hnd-mcard").filter({ hasText: NUMBER });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".k-hnd-mcard-from")).toHaveText("渡された ・ 鈴木さんから");
  await expect(card.locator(".k-hnd-mcard-sub")).toHaveText(T.rowSub);
  await expect(card.locator(".k-hnd-mcard-note")).toHaveCount(0);
  await expect(page.locator("tr.k-hnd-row")).toBeHidden();
  await card.getByRole("button", { name: "渡す", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(seen.answers).toEqual([{ decision: "accept" }]);
});
