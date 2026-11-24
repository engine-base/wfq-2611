// K-415「画面：配る（人・グループ）・配られた帯・グループに来た行」の画面の試験（実 Chrome・実装より先に積む・段 9 の切る段）。
//   正の絵：モック /dev/mock/f8/<状態>（f8-pick-manager・f8-distribute・f8-distribute-group・f8-distributed・f8-group-waiting・f8-group）。
//   口は網の手前で差し替える。土台は段 9 の画面の葉の共通の道具 handover-mock.ts（K-400 が運ぶ）。配るだけの口（配る・取り消す）の答えはこの試験の中で差し替える。
//   口の形は K-401 の契約（下見の kinds・groups／配るの入力・答えは道具の created()＝16 の鍵）・K-405（渡しの並び・グループに来た行の primary_action claim／assign・
//   to_scope_name・ticket_scope_name）・K-406（取り消すの答えは 201 { id, state, decided_at }）・K-409（人へ配る）・K-410（グループへ配る・
//   「自分が持つ」は答える口 PATCH /ticket_handovers/:id に { decision: "accept" }・「人を決める」は POST /ticket_handovers/:id/claim に { member_id }）に合わせた。
//   口そのものは K-409・K-410 の口の試験が持つ。
//   エラーの文は文言の正本 07_qa/test-specs/errors.json から番号で引く（K-401・K-409・K-410 の番号）。
//   「人を決める」の小窓の 1 行と、配り中の「取り消す」の確かめの字は D-148.46（代表の答え answer=3d444fc8d59f・勧め (a)）のとおり。
//   入口（配るの ▾）は getTicket の handover_kinds に distribute があるかで決まる（役の名前で出し分けない・PM の決め 2026-11-20）。帯は getTicket の handover から。
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
  SATO,
  SUZUKI,
  TITLE,
  created,
  errReply,
  handoverRow,
  hview,
  mockHandovers,
  openDetail,
  preview,
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
/** 口が断ったときの番号（K-401・K-410 の md の表の番号） */
const E = {
  waiting: "E-HND-004", // いま{名前}さんの返事を待っています…（D-148.20・K-401）
  noPerm: "E-HND-002", // このチケットでは、この操作はできません（配る権限が無い・K-401・D-148.3）
  notInGroup: "E-HND-150", // 人を決める：選んだ人がそのグループの人でない（K-410）
  taken: "E-HND-005", // この渡しはもう決まっています（ほかの人が持った・取り消された・K-401 の共通・K-410 の表）
  down: "E-PAGE-003", // Kaname の調子が悪い（口の 503）
  offline: "E-PAGE-008",
  reasonEmpty: "E-HND-007",
} as const;
/** 画面の字（モック f8-pick-manager・f8-distribute*・f8-distributed・f8-group*・決定 D-148.17・D-148.25・D-148.30・D-148.46） */
const T = {
  pickTitle: "担当者を選ぶ",
  managerIntro:
    "あなたはこのグループのマネージャーなので、選ぶと「配る」になります（相手の合意なしで担当者が替わります）",
  passIntro: "選んだ人に「引き継いでもらう」を頼みます。相手が受けるまで担当者はあなたのままです",
  search: "名前・メール・グループで探す",
  groupItem: "グループ「受託開発」に配る",
  dist: "配る",
  noteMember: "配るとすぐ鈴木 一郎さんが担当者になり、お知らせが届きます。",
  noteGroup: "受託開発の人が「自分が持つ」か「人を決める」を押すまで、担当者はあなたのままです。",
  reasonM: "来週の展示会の準備を優先してもらうため",
  reasonG: "技術の質問なので受託開発で見てほしい",
  ask: "月曜の朝までに一次返信を",
  toastM: "鈴木さんに配りました",
  toastG: "受託開発に配りました",
  bandGroup: "グループ「受託開発」に配り中",
  bandGroupSub: "そのグループの人が担当を決めるまで、担当者はあなたのまま ・ 11/20 10:12",
  bandDist: "佐藤さんから配られました",
  // グループの名前は承認待ちの行の to_scope_name（K-405）から出す
  rowSub: "グループ「受託開発」に配られました ・ 担当者を決めてください",
  blocked: "AI の実行（承認）が終わってから渡してください",
  assignIntro: "グループ「受託開発」の人から担当者を選びます。選ぶとすぐその人が担当者になり、お知らせが届きます",
  withdrawTitle: "配るのを取り消しますか？",
  became: "担当者になりました",
} as const;

// ---------------------------------------------------------------- 配るの渡し・下見・承認待ちの行（形は K-401・K-405・K-410・名前と時刻はモックと同じ）
const JD = { id: "0193c5a0-0000-7000-8000-00000000e60d", name: "受託開発", code: "JD" };
const G_TICKET = "0193c5a0-0000-7000-8000-00000f841501"; // グループに来た EG-140
const NO = { answer: false, withdraw: false, remind: false, reassign: false };
const SATO_W = { member_id: SATO, display_name: "佐藤 花子" };
const toMember = (o: Partial<HView> = {}): HView =>
  hview({
    kind: "distribute",
    state: "accepted",
    from: SATO_W,
    to: { member_id: SUZUKI, display_name: "鈴木 一郎" },
    reason: T.reasonM,
    ask: null,
    reply_due: null,
    switch: { children: 0, group: false },
    decided_at: AT,
    created_at: AT,
    can: NO,
    ...o,
  });
const toGroup = (o: Partial<HView> = {}): HView =>
  toMember({
    state: "waiting",
    to: null,
    to_scope: JD,
    reason: T.reasonG,
    decided_at: null,
    can: { ...NO, withdraw: true },
    ...o,
  });
/** 下見（K-401）：配る人には kinds に distribute・会社のグループの並び */
const managerPreview = (o: Record<string, unknown> = {}) => ({
  ...preview(),
  kinds: ["distribute", "offer"],
  groups: [JD],
  ...o,
});
const groupRow = () =>
  handoverRow({
    handover_kind: "distribute",
    ticket_id: G_TICKET,
    ticket_number: "EG-140",
    title: "展示会の来場者に礼状を送る",
    from_member_id: SATO,
    from_name: "佐藤",
    due_on: "2026-11-30", // 返事の期限が無いのでチケットの期限（K-405・モックの注）
    reply_due: null,
    carry_children: 0,
    to_scope_name: JD.name, // グループ宛ての名前（K-405）
    ticket_scope_name: "営業", // チケットの今のグループ（K-405）
    note: T.reasonG,
    primary_action: "claim",
    secondary_action: "assign",
    created_at: AT,
  });
const aiRow = () =>
  qrow("0193c5a0-0000-7000-8000-00000f841504", {
    ticket_number: "EG-128",
    title: "セイコー様へ 11月分の請求書を送る",
    from_name: "佐藤のAI",
    check_summary: "通過 3",
    due_on: "2026-11-24",
    decide_inline: true,
    irreversible: false,
    primary_action: "approve",
  });

/** マネージャー（佐藤）がほかの人（高本）のチケットを開く（DB の handover_kinds は distribute と offer） */
const AS_MANAGER: HOptions = { me: SATO, role: "manager", kinds: ["distribute", "offer"], assignee: ME };
/** 配った後の佐藤（自分が担当者・グループに配り中）。担当者本人なので DB の handover_kinds は pass */
const AS_DISTRIBUTOR: HOptions = { me: SATO, role: "manager", kinds: ["pass"], assignee: SATO };
/** グループの人（高本・管理者）が承認待ちを開く */
const AS_GROUP: HOptions = { queue: [groupRow(), aiRow()] };

const ok = (data: unknown, status = 200): Reply => ({ status, body: { data } });
interface Seen {
  creates: Record<string, unknown>[];
}
/** 配るだけの口の答えを差し替える（下見・配る・取り消す）。書いた中身を返す */
function onDistribute(h: HMock, setAssignee: (id: string | null) => void, previewOf = managerPreview()): Seen {
  const seen: Seen = { creates: [] };
  h.on.preview = () => ok(previewOf);
  h.on.pass = (req: Request) => {
    const b = req.postDataJSON() as Record<string, unknown>;
    seen.creates.push(b);
    const group = Boolean(b["to_scope_id"]);
    const v = group ? toGroup() : toMember({ can: NO });
    h.list = group ? [v] : [];
    setAssignee(group ? SATO : SUZUKI); // グループへ配ったら決まるまで配った人（D-148.17）
    return ok(created(v), 201);
  };
  h.on.withdraw = () => {
    const v = toGroup({ state: "withdrawn", decided_at: AT });
    h.list = [v];
    return ok({ id: v.id, state: v.state, decided_at: v.decided_at }, 201);
  };
  return seen;
}
/** グループに来た行の口（K-410）：「自分が持つ」は答える口に { decision: "accept" }、「人を決める」は claim に { member_id }。
 *  道具の h.answers・h.claims に入る。答えを替えるときは h.on.answer・h.on.claim を差し替える */
function onGroupRow(h: HMock) {
  h.list = [toGroup({ from: SATO_W, can: { ...NO, answer: true } })];
  h.on.claim = (req: Request) => {
    const b = req.postDataJSON() as { member_id: string };
    return ok({ id: HND, state: "accepted", ticket_id: G_TICKET, assignee_member_id: b.member_id });
  };
}
const queueAfterClaim = (api: Awaited<ReturnType<typeof mockHandovers>>["api"], h: HMock) => {
  api.on.queue = () => {
    const rows = h.answers.length || h.claims.length ? [aiRow()] : [groupRow(), aiRow()];
    return { status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } };
  };
};

/** 見た目の突き合わせの中で詳細を開く（matchMock が決めた幅と高さのまま） */
const gotoDetail = async (page: Page) => {
  expect((await page.goto(`/tickets/${TICKET}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('#k-main [aria-busy="true"]')).toHaveCount(0);
};
const openQueue = async (page: Page) => {
  expect((await page.goto("/approvals"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "承認待ち" })).toBeVisible();
};
const assigneeBtn = (page: Page) => page.locator(".k-hnd-assignee-btn");
const pick = (page: Page) => page.getByRole("dialog", { name: T.pickTitle });
const dist = (page: Page) => page.getByRole("dialog", { name: T.dist });
const searchBox = (page: Page) =>
  pick(page)
    .getByRole("searchbox", { name: T.search })
    .or(pick(page).getByRole("textbox", { name: T.search }));
const bands = (page: Page) => page.locator(".k-detail-bands .k-band");
const bandOf = (page: Page, title: string) =>
  bands(page).filter({ has: page.locator(".k-band-title", { hasText: title }) });
const groupRowOf = (page: Page) => page.locator("tr.k-hnd-row").filter({ hasText: "EG-140" });
const panelAssignee = (page: Page) => page.locator('aside[aria-label="チケットのパネル"] .k-hnd-assignee');
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
/** 担当者 ▾ → 相手を選ぶ小窓 → 人かグループを押す → 配る小窓 */
async function openDistribute(page: Page, target: "鈴木 一郎" | "group") {
  await assigneeBtn(page).click();
  await expect(pick(page)).toBeVisible();
  if (target === "group")
    await pick(page)
      .getByRole("button", { name: new RegExp(`^${T.groupItem}`) })
      .click();
  else
    await pick(page)
      .getByRole("button", { name: /^鈴木 一郎/ })
      .click();
  await expect(dist(page)).toBeVisible();
}
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

// ---------------------------------------------------------------- 配る（マネージャー：佐藤・ほかの人のチケット）
test("K415-UI-001 マネージャー（佐藤・handover_kinds に distribute）がほかの人のチケットの詳細を開くと担当者 ▾ が出る（開いた時点で下見は 0 回）。押すと下見が 1 回で、小窓「担当者を選ぶ」：配るの 1 行・探す欄「名前・メール・グループで探す」・人 5 人（自分・今の担当者の印・今週の件数）・「グループ「受託開発」に配る」", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  expect(h.previewReads).toBe(0);
  await assigneeBtn(page).click();
  const d = pick(page);
  await expect(d.locator(".k-hnd-intro")).toHaveText(T.managerIntro);
  await expect(searchBox(page)).toBeVisible();
  await expect(d.getByRole("list", { name: "人", exact: true }).getByRole("listitem")).toHaveCount(5);
  await expect(d.getByRole("button", { name: /佐藤 花子（自分）/ })).toBeVisible();
  await expect(d.getByRole("button", { name: /^鈴木 一郎/ })).toContainText("営業 ・ 今週 4 件");
  await expect(d.getByRole("list", { name: "グループ", exact: true })).toContainText(T.groupItem);
  expect(h.previewReads, "押したときに下見を 1 回だけ読む").toBe(1);
});

test("K415-UI-002 見た目：f8-pick-manager と本番が幅 375・768・1440 で同じ", async ({ page }) => {
  await expectLikeMock(page, "f8-pick-manager", async (p) => {
    const { h, setAssignee } = await mockHandovers(p, AS_MANAGER);
    onDistribute(h, setAssignee);
    await gotoDetail(p);
    await assigneeBtn(p).click();
    await expect(pick(p)).toBeVisible();
  });
});

test("K415-UI-003 入力：探す欄に「受託」→ 人は 0・グループ 1。「山田」→「「山田」に合う人がいません…」。前後の空白と大文字小文字は見ない（「 SUZUKI 」で鈴木 1 人）", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  await assigneeBtn(page).click();
  const d = pick(page);
  await searchBox(page).fill("受託");
  await expect(d.getByRole("list", { name: "人", exact: true })).toHaveCount(0);
  await expect(d.getByRole("list", { name: "グループ", exact: true }).getByRole("listitem")).toHaveCount(1);
  await searchBox(page).fill("山田");
  await expect(d.getByRole("status")).toHaveText(
    "「山田」に合う人がいません。名前かメールの一部で探してください（止まっている人・招待中の人も出ます）",
  );
  await searchBox(page).fill(" SUZUKI ");
  await expect(d.getByRole("list", { name: "人", exact: true }).getByRole("listitem")).toHaveCount(1);
});

test("K415-UI-004 守り：止まっている人・招待中の人は「選べません（…）」の押せない形で、今の担当者（✓）も押せない。押しても配る小窓は開かない", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  await assigneeBtn(page).click();
  const d = pick(page);
  for (const name of [/^田中 美咲/, /^木村 誠/, /^高本 聖斗/]) {
    const b = d.getByRole("button", { name });
    await expect(b).toHaveAttribute("aria-disabled", "true");
    await b.click({ force: true });
  }
  await expect(d.getByRole("button", { name: /^田中 美咲/ })).toContainText("選べません（止まっています）");
  await expect(dist(page)).toHaveCount(0);
});

test("K415-UI-005 人（鈴木 一郎）を選ぶ → 小窓「配る」：配る相手・理由（必須）・お願い・注「配るとすぐ鈴木 一郎さんが担当者になり、お知らせが届きます。」。f8-distribute と 3 幅で同じ", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  const d = dist(page);
  await expect(d.locator(".k-hnd-to")).toContainText("鈴木 一郎");
  await expect(d.getByRole("textbox", { name: /^理由/ })).toBeVisible();
  await expect(d.getByRole("textbox", { name: /^お願い/ })).toBeVisible();
  await expect(d.locator(".k-hnd-note")).toHaveText(T.noteMember);
  await expectLikeMock(page, "f8-distribute", async (p) => {
    const m = await mockHandovers(p, AS_MANAGER);
    onDistribute(m.h, m.setAssignee);
    await gotoDetail(p);
    await openDistribute(p, "鈴木 一郎");
    await dist(p).getByRole("textbox", { name: /^理由/ }).fill(T.reasonM);
  });
});

test("K415-UI-006 グループを選ぶ → 小窓「配る」：配るグループ 受託開発・注「受託開発の人が「自分が持つ」か「人を決める」を押すまで、担当者はあなたのままです。」。f8-distribute-group と 3 幅で同じ", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  await openDistribute(page, "group");
  const d = dist(page);
  await expect(d.getByText("配るグループ", { exact: true })).toBeVisible();
  await expect(d.locator(".k-hnd-to")).toContainText("受託開発");
  await expect(d.locator(".k-hnd-note")).toHaveText(T.noteGroup);
  await expectLikeMock(page, "f8-distribute-group", async (p) => {
    const m = await mockHandovers(p, AS_MANAGER);
    onDistribute(m.h, m.setAssignee);
    await gotoDetail(p);
    await openDistribute(p, "group");
    await dist(p).getByRole("textbox", { name: /^理由/ }).fill(T.reasonG);
  });
});

test("K415-UI-007 入力：理由が空・空白だけで「配る」→ 欄の下に「理由を書いてください」・書く口は 0 回。「変える」で相手を選ぶ小窓に戻る", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  const d = dist(page);
  for (const v of ["", " 　"]) {
    await d.getByRole("textbox", { name: /^理由/ }).fill(v);
    await d.getByRole("button", { name: "配る", exact: true }).click();
    await expect(d.locator(".k-err")).toHaveText(msg(E.reasonEmpty));
  }
  expect(h.passes).toHaveLength(0);
  await d.getByRole("button", { name: "変える", exact: true }).click();
  await expect(pick(page)).toBeVisible();
});

test("K415-UI-008 人へ配る：口 POST /tickets/:id/handovers に { kind: distribute, to_member_id, reason, ask } を冪等キーつきで 1 回 → 小窓が閉じ、小さな知らせ「鈴木さんに配りました」・パネルの担当者が鈴木 一郎（読み直し）・帯は出ない", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  const seen = onDistribute(h, setAssignee);
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  await dist(page).getByRole("textbox", { name: /^理由/ }).fill(T.reasonM);
  await dist(page)
    .getByRole("textbox", { name: /^お願い/ })
    .fill(T.ask);
  await dist(page).getByRole("button", { name: "配る", exact: true }).click();
  await expect(dist(page)).toHaveCount(0);
  expect(seen.creates).toEqual([{ kind: "distribute", to_member_id: SUZUKI, reason: T.reasonM, ask: T.ask }]);
  expect(h.passes[0]!.key).toBeTruthy();
  await expect(toast(page, T.toastM)).toBeVisible();
  await expect(panelAssignee(page)).toContainText("鈴木 一郎");
  await expect(bands(page)).toHaveCount(0);
});

test("K415-UI-009 グループへ配る：口に { kind: distribute, to_scope_id, reason } を 1 回（お願いが空なら送らない）→ 知らせ「受託開発に配りました」・帯「グループ「受託開発」に配り中」・担当者は配った人（佐藤 花子）。f8-group-waiting と 3 幅で同じ", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  const seen = onDistribute(h, setAssignee);
  await openDetail(page);
  await openDistribute(page, "group");
  await dist(page).getByRole("textbox", { name: /^理由/ }).fill(T.reasonG);
  await dist(page).getByRole("button", { name: "配る", exact: true }).click();
  await expect(dist(page)).toHaveCount(0);
  expect(seen.creates).toEqual([{ kind: "distribute", to_scope_id: JD.id, reason: T.reasonG }]);
  await expect(toast(page, T.toastG)).toBeVisible();
  const b = bandOf(page, T.bandGroup);
  await expect(b.locator(".k-band-sub")).toHaveText(T.bandGroupSub);
  await expect(b.getByRole("button", { name: "取り消す", exact: true })).toBeVisible();
  await expect(panelAssignee(page)).toContainText("佐藤 花子");
  await expectLikeMock(page, "f8-group-waiting", async (p) => {
    const m = await mockHandovers(p, { ...AS_DISTRIBUTOR, list: [toGroup()] });
    onDistribute(m.h, m.setAssignee);
    await gotoDetail(p);
  });
});

test("K415-UI-010 配り中の帯の「取り消す」→ 確かめの小窓「配るのを取り消しますか？」→「やめる」で口 0 回 → もう一度 →「取り消す」→ 口 POST /ticket_handovers/:id/withdraw 1 回 → 帯が消える（D-148.46）", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, { ...AS_DISTRIBUTOR, list: [toGroup()] });
  onDistribute(h, setAssignee);
  await openDetail(page);
  const c = page
    .getByRole("alertdialog", { name: T.withdrawTitle })
    .or(page.getByRole("dialog", { name: T.withdrawTitle }));
  await bandOf(page, T.bandGroup).getByRole("button", { name: "取り消す", exact: true }).click();
  await c.getByRole("button", { name: "やめる", exact: true }).click();
  expect(h.withdraws).toHaveLength(0);
  await bandOf(page, T.bandGroup).getByRole("button", { name: "取り消す", exact: true }).click();
  await c.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(bandOf(page, T.bandGroup)).toHaveCount(0);
  expect(h.withdraws).toEqual([HND]);
});

test("K415-UI-025 手順 S3（取り消す口を呼ぶ）の失敗：配り中の「取り消す」→ 確かめ →「取り消す」で口が 503 E-PAGE-003 → 確かめが閉じ、帯の中の role=alert に errors.json の文・配り中の帯はそのまま", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, { ...AS_DISTRIBUTOR, list: [toGroup()] });
  onDistribute(h, setAssignee);
  h.on.withdraw = () => ({ status: 503, body: { error: "unavailable", code: E.down, message: E.down } });
  await openDetail(page);
  const c = page
    .getByRole("alertdialog", { name: T.withdrawTitle })
    .or(page.getByRole("dialog", { name: T.withdrawTitle }));
  await bandOf(page, T.bandGroup).getByRole("button", { name: "取り消す", exact: true }).click();
  await c.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(c).toHaveCount(0);
  await expect(page.locator(".k-detail-bands").getByRole("alert")).toContainText(msg(E.down));
  await expect(bandOf(page, T.bandGroup)).toHaveCount(1);
  expect(h.withdraws).toEqual([HND]);
});

test("K415-UI-011 失敗：配る口が 409 E-HND-004（いま別の渡しの返事を待っている）→ 403 E-HND-002（配る権限が無い）→ 小窓の上の赤い箱に errors.json の文・書いた理由は残る・担当者は高本 聖斗のまま", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  h.on.pass = () => errReply(409, E.waiting, { 名前: "鈴木" });
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  const d = dist(page);
  await d.getByRole("textbox", { name: /^理由/ }).fill(T.reasonM);
  await d.getByRole("button", { name: "配る", exact: true }).click();
  await expect(d.getByRole("alert")).toHaveText(msg(E.waiting).replace("{名前}", "鈴木"));
  await expect(d.getByRole("textbox", { name: /^理由/ })).toHaveValue(T.reasonM);
  h.on.pass = () => errReply(403, E.noPerm);
  await d.getByRole("button", { name: "配る", exact: true }).click();
  await expect(d.getByRole("alert")).toHaveText(msg(E.noPerm));
  await expect(panelAssignee(page)).toContainText("高本 聖斗");
});

test("K415-UI-012 失敗：網が切れた → 赤い箱に E-PAGE-008 の文・理由は残る", async ({ page }) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await page.route(/\/api\/v1\/tickets\/[^/]+\/handovers$/, (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.fallback(),
  );
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  await dist(page).getByRole("textbox", { name: /^理由/ }).fill(T.reasonM);
  await dist(page).getByRole("button", { name: "配る", exact: true }).click();
  await expect(dist(page).getByRole("alert")).toHaveText(msg(E.offline));
  await expect(dist(page).getByRole("textbox", { name: /^理由/ })).toHaveValue(T.reasonM);
});

test("K415-UI-013 操作の揺れ：答えを待つ間に「配る」を 2 回押しても書く口は 1 回", async ({ page }) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee);
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  await dist(page).getByRole("textbox", { name: /^理由/ }).fill(T.reasonM);
  const open = h.hold();
  const btn = dist(page).getByRole("button", { name: "配る", exact: true });
  await btn.click();
  await expect.poll(() => h.passes.length).toBe(1);
  await btn.click({ force: true });
  open();
  await expect(dist(page)).toHaveCount(0);
  expect(h.passes).toHaveLength(1);
});

test("K415-UI-014 下見の blocked が ai_running（AI が動いている）→ 相手を選ぶ小窓の上に橙の箱「AI の実行（承認）が終わってから渡してください」・人もグループも押せない（D-148.6・D-148.37）", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee, managerPreview({ blocked: "ai_running" }));
  await openDetail(page);
  await assigneeBtn(page).click();
  const d = pick(page);
  await expect(d.locator(".k-callout")).toContainText(T.blocked);
  await expect(d.getByRole("button", { name: /^鈴木 一郎/ })).toHaveAttribute("aria-disabled", "true");
  await expect(d.getByRole("button", { name: new RegExp(`^${T.groupItem}`) })).toHaveAttribute("aria-disabled", "true");
});

test("K415-UI-015 利用者の状態：マネージャーが自分が担当のチケットを開く（下見は kinds pass・グループを管理するので groups あり・K-401 の契約）→ 小窓の 1 行は「引き継いでもらう」の文で、人を押すと引き継いでもらうの小窓（人は配るにならない・D-148.3）。グループの並びは出る", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_DISTRIBUTOR);
  onDistribute(h, setAssignee, managerPreview({ kinds: ["pass"], groups: [JD] }));
  await openDetail(page);
  await assigneeBtn(page).click();
  await expect(pick(page).locator(".k-hnd-intro")).toHaveText(T.passIntro);
  await expect(pick(page).getByRole("list", { name: "グループ", exact: true })).toContainText(T.groupItem);
  await pick(page)
    .getByRole("button", { name: /^鈴木 一郎/ })
    .click();
  await expect(page.getByRole("dialog", { name: "引き継いでもらう" })).toBeVisible();
  await expect(dist(page)).toHaveCount(0);
});

test("K415-UI-027 自分が担当のチケットをグループに配る（K-401 の handover_kinds の p_to_scope の枝・下絵 f8-group-waiting）：マネージャー（佐藤・担当者）が ▾ → 「グループ「受託開発」に配る」→ 小窓「配る」（配るグループ 受託開発）→ 理由 → 口に { kind: distribute, to_scope_id, reason } を 1 回 → 帯「グループ「受託開発」に配り中」", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_DISTRIBUTOR);
  const seen = onDistribute(h, setAssignee, managerPreview({ kinds: ["pass"], groups: [JD] }));
  await openDetail(page);
  await openDistribute(page, "group");
  await expect(dist(page).locator(".k-hnd-to")).toContainText("受託開発");
  await dist(page).getByRole("textbox", { name: /^理由/ }).fill(T.reasonG);
  await dist(page).getByRole("button", { name: "配る", exact: true }).click();
  await expect(dist(page)).toHaveCount(0);
  expect(seen.creates).toEqual([{ kind: "distribute", to_scope_id: JD.id, reason: T.reasonG }]);
  await expect(bandOf(page, T.bandGroup)).toBeVisible();
});

test("K415-UI-026 入口は役の名前でなく種類で決まる：会社を作った人（高本・/me の role_id null・handover_kinds に distribute）が鈴木担当のチケットを開くと配るの ▾ が出て、押すと配るの 1 行の小窓（D-148.3・統合 K418-STG-02 の前提）", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, { kinds: ["distribute", "offer"], assignee: SUZUKI });
  onDistribute(h, setAssignee);
  await openDetail(page);
  await expect(assigneeBtn(page)).toHaveCount(1);
  await assigneeBtn(page).click();
  await expect(pick(page).locator(".k-hnd-intro")).toHaveText(T.managerIntro);
});

test("K415-UI-016 権限を外された直後（getTicket の handover_kinds には distribute が在ったが、押して読んだ下見の kinds は offer だけ）→ 相手を選ぶ小窓の上に「このチケットでは、この操作はできません」（E-HND-002）・人もグループも押せない", async ({
  page,
}) => {
  const { h, setAssignee } = await mockHandovers(page, AS_MANAGER);
  onDistribute(h, setAssignee, managerPreview({ kinds: ["offer"], groups: [] }));
  await openDetail(page);
  await assigneeBtn(page).click();
  await expect(pick(page).locator(".k-callout")).toContainText(msg("E-HND-002"));
  await expect(pick(page).getByRole("button", { name: /^鈴木 一郎/ })).toHaveAttribute("aria-disabled", "true");
});

// ---------------------------------------------------------------- 配られた人・グループの人
test("K415-UI-017 配られた人（鈴木）の帯「佐藤さんから配られました」・11/20 10:12・理由・ボタンなし。開き直すと帯は出ない（1 回だけ・D-148.35）。f8-distributed と 3 幅で同じ", async ({
  page,
}) => {
  await mockHandovers(page, { me: SUZUKI, role: "member", kinds: ["pass"], assignee: SUZUKI, list: [toMember()] });
  await openDetail(page);
  const b = bandOf(page, T.bandDist);
  await expect(b.locator(".k-band-sub")).toHaveText("11/20 10:12");
  await expect(b.locator(".k-band-line")).toHaveText(`理由：${T.reasonM}`);
  await expect(b.getByRole("button")).toHaveCount(0);
  await openDetail(page);
  await expect(bands(page)).toHaveCount(0);
  await expectLikeMock(page, "f8-distributed", async (p) => {
    await mockHandovers(p, { me: SUZUKI, role: "member", kinds: ["pass"], assignee: SUZUKI, list: [toMember()] });
    await gotoDetail(p);
  });
});

test("K415-UI-018 グループの人（高本）の承認待ちの行：種別「渡された」・EG-140・中身「グループ「受託開発」に配られました ・ 担当者を決めてください」・誰から 佐藤・期限 11/30（チケットの期限）・「人を決める」（outlined）「自分が持つ」（primary）。f8-group と 3 幅で同じ", async ({
  page,
}) => {
  await mockHandovers(page, AS_GROUP);
  await openQueue(page);
  const row = groupRowOf(page);
  await expect(row.locator(".k-ap-kind")).toHaveText("渡された");
  await expect(row.locator(".k-ap-sub")).toHaveText(T.rowSub);
  await expect(row.locator(".k-ap-from")).toContainText("佐藤");
  await expect(row.locator("td").nth(7)).toHaveText("11/30");
  await expect(row.getByRole("button", { name: "人を決める", exact: true })).toHaveAttribute(
    "data-variant",
    "outlined",
  );
  await expect(row.getByRole("button", { name: "自分が持つ", exact: true })).toHaveAttribute("data-variant", "primary");
  await expectLikeMock(page, "f8-group", async (p) => {
    await mockHandovers(p, AS_GROUP);
    await openQueue(p);
  });
});

test("K415-UI-019 行の「自分が持つ」→ 答える口 PATCH /ticket_handovers/:id に { decision: accept } を 1 回（claim は呼ばない）→ 行が消え「1 件」。詳細を開くと帯「担当者になりました」（佐藤さんから引き継ぎ）", async ({
  page,
}) => {
  const { api, h, setAssignee } = await mockHandovers(page, AS_GROUP);
  onGroupRow(h);
  queueAfterClaim(api, h);
  await openQueue(page);
  await groupRowOf(page).getByRole("button", { name: "自分が持つ", exact: true }).click();
  await expect(groupRowOf(page)).toHaveCount(0);
  expect(h.answers.map((a) => [a.id, a.body])).toEqual([[HND, { decision: "accept" }]]);
  expect(h.answers[0]!.key, "冪等キーを付ける").toBeTruthy();
  expect(h.claims).toEqual([]);
  await expect(page.locator(".k-page-sub")).toContainText("1 件");
  setAssignee(ME);
  h.list = [toGroup({ state: "accepted", to: { member_id: ME, display_name: "高本 聖斗" }, decided_at: AT, can: NO })];
  await openDetail(page);
  await expect(bandOf(page, T.became).locator(".k-band-sub")).toHaveText("佐藤さんから引き継ぎ ・ 11/20 10:12");
});

test("K415-UI-020 行の「人を決める」→ 相手を選ぶ小窓（1 行「グループ「受託開発」の人から担当者を選びます…」・グループの並びなし）→ 鈴木 一郎 → 口 claim に { member_id: 鈴木 } を 1 回 → 行が消え、知らせ「鈴木さんに配りました」（D-148.46）", async ({
  page,
}) => {
  const { api, h } = await mockHandovers(page, AS_GROUP);
  h.on.preview = () => ok(managerPreview({ kinds: ["pass"], groups: [] }));
  onGroupRow(h);
  queueAfterClaim(api, h);
  await openQueue(page);
  await groupRowOf(page).getByRole("button", { name: "人を決める", exact: true }).click();
  const d = pick(page);
  await expect(d.locator(".k-hnd-intro")).toHaveText(T.assignIntro);
  await expect(d.getByRole("list", { name: "グループ", exact: true })).toHaveCount(0);
  await d.getByRole("button", { name: /^鈴木 一郎/ }).click();
  await expect(groupRowOf(page)).toHaveCount(0);
  expect(h.claims.map((c) => [c.id, c.body])).toEqual([[HND, { member_id: SUZUKI }]]);
  expect(h.answers).toEqual([]);
  await expect(toast(page, T.toastM)).toBeVisible();
});

test("K415-UI-021 時間の流れ：「自分が持つ」がもう決まっていた（答える口が 409 E-HND-005）→ errors.json の文が知らせ（role=alert）に出て、読み直した一覧から行が消える", async ({
  page,
}) => {
  const { api, h } = await mockHandovers(page, AS_GROUP);
  onGroupRow(h);
  h.on.answer = () => errReply(409, E.taken, { 状態: "accepted" });
  queueAfterClaim(api, h);
  await openQueue(page);
  await groupRowOf(page).getByRole("button", { name: "自分が持つ", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: msg(E.taken) })).toBeVisible();
  await expect(groupRowOf(page)).toHaveCount(0);
});

test("K415-UI-022 入力：「人を決める」でグループの人でない人を選んだ（claim が 409 E-HND-150）→ 小窓の上の赤い箱に errors.json の文・行は残る", async ({
  page,
}) => {
  const { h } = await mockHandovers(page, AS_GROUP);
  h.on.preview = () => ok(managerPreview({ kinds: ["pass"], groups: [] }));
  onGroupRow(h);
  h.on.claim = () => errReply(409, E.notInGroup);
  await openQueue(page);
  await groupRowOf(page).getByRole("button", { name: "人を決める", exact: true }).click();
  await pick(page)
    .getByRole("button", { name: /^鈴木 一郎/ })
    .click();
  await expect(pick(page).getByRole("alert")).toHaveText(msg(E.notInGroup));
  await expect(groupRowOf(page)).toHaveCount(1);
  expect(h.claims).toHaveLength(1);
});

test("K415-UI-023 幅 375 の承認待ち：グループに来た行は 1 枚のカード（「渡された ・ 佐藤さんから」・「期限 11/30」・人を決める／自分が持つ）で表は見えない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockHandovers(page, AS_GROUP);
  await openQueue(page);
  const card = page.locator(".k-hnd-mcard").filter({ hasText: "EG-140" });
  await expect(card.locator(".k-hnd-mcard-from")).toHaveText("渡された ・ 佐藤さんから");
  await expect(card.locator(".k-hnd-mcard-note")).toHaveText("期限 11/30");
  await expect(card.getByRole("button", { name: "自分が持つ", exact: true })).toBeVisible();
  await expect(page.locator("tr.k-hnd-row")).toBeHidden();
});

test("K415-UI-024 幅 320・375・768・1024・1440：相手を選ぶ小窓（グループあり）・配る小窓・配り中の帯・グループに来た行で、横のはみ出しが 0。ログインが切れた（配る口が 401）→ /login?next=…", async ({
  browser,
}) => {
  const bad: string[] = [];
  for (const width of WIDTHS) {
    const a = await browser.newPage();
    const m = await mockHandovers(a, AS_MANAGER);
    onDistribute(m.h, m.setAssignee);
    await openDetail(a, width);
    await assigneeBtn(a).click();
    await expect(pick(a)).toBeVisible();
    if ((await overflowX(a)) > 0) bad.push(`幅 ${width}・相手を選ぶ小窓`);
    await pick(a)
      .getByRole("button", { name: new RegExp(`^${T.groupItem}`) })
      .click();
    await expect(dist(a)).toBeVisible();
    if ((await overflowX(a)) > 0) bad.push(`幅 ${width}・配る小窓`);
    await a.close();
    const b = await browser.newPage();
    await mockHandovers(b, { ...AS_DISTRIBUTOR, list: [toGroup()], queue: [groupRow(), aiRow()] });
    await openDetail(b, width);
    await expect(bandOf(b, T.bandGroup)).toBeVisible();
    if ((await overflowX(b)) > 0) bad.push(`幅 ${width}・配り中の帯`);
    await openQueue(b);
    if ((await overflowX(b)) > 0) bad.push(`幅 ${width}・承認待ち`);
    await b.close();
  }
  expect(bad).toEqual([]);
  const page = await browser.newPage();
  const m = await mockHandovers(page, AS_MANAGER);
  onDistribute(m.h, m.setAssignee);
  m.h.on.pass = () => ({ status: 401, body: { error: "unauthorized", code: "UNAUTHORIZED" } });
  await openDetail(page);
  await openDistribute(page, "鈴木 一郎");
  await dist(page).getByRole("textbox", { name: /^理由/ }).fill(T.reasonM);
  await dist(page).getByRole("button", { name: "配る", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/tickets/${TICKET}`);
  await page.close();
});
