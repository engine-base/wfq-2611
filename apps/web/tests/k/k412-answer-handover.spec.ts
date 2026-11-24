// K-412「画面：渡された人が受ける／断る＋承認待ちのスマホのカード」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：/dev/mock/f8 の f8-queue・f8-decline・f8-waiting-recipient・f8-accepted・f8-gone・f8-taken-sender
//     （代表 OK：2026-11-20 の下絵を見た会話・answer=fabd031f9b37）。
//   口は網の手前で差し替える（前からの土台 mockApi の上に tests/k/handover-mock.ts の mockHandovers）。口の形は K-403・K-405 の md に合わせる。
//   詳細の帯は getTicket の handover（今の渡し）から、▾ は handover_kinds から出る（役の名前で出し分けない・PM の決め 2026-11-20）。
//   押した直後の口の数は expect.poll で待つ。スマホのカードは全部の種類（AI の成果物・渡された・申し出・グループに配られた）をこの葉が描く
//   エラーの番号は K-401 の共通の番号（11_tickets/K-401.md の表）。文は正本の 1 件。
//   固定の待ちは使わない（要素と答えを待つ。2 回押しは答えを止めて見る）。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ME, QUEUE, openQueue, qrow } from "../features/F5/approve-complete.harness";
import {
  AT,
  AT_WITHDRAWN,
  ASK,
  HND_PAIRS,
  REASON,
  SATO,
  SUZUKI,
  WHY,
  assigneeOf,
  bandsOf,
  errReply,
  handoverRow,
  hview,
  incoming,
  mockHandovers,
  openDetail,
  type HOptions,
} from "./handover-mock";
import { ROOT, box, overflowX } from "./kit";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

/** K-401 の共通のエラーの番号（答える口の断り） */
const CODE = { gone: "E-HND-005", reasonEmpty: "E-HND-007", aiBusy: "E-HND-003" } as const;
const ERRORS = JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
  errors: { id: string; message: string }[];
};
const msg = (id: string) => ERRORS.errors.find((e) => e.id === id)?.message ?? id;
const firstSentence = (id: string) => {
  const m = msg(id);
  const i = m.indexOf("。");
  return i < 0 ? m : m.slice(0, i + 1);
};
const BLOCKED = "AI の実行（承認）が終わってから渡してください";
const TITLE = "問い合わせ（山田様）に一次返信する";
const SUB = "高本さんから ・ 子チケット 2 件も一緒に ・ 理由：先方と面識があるので…";

/** 2 つ目の渡された行と AI の成果物の行（モック f8-queue の JD-190・EG-128 と同じ字） */
const ROW2 = handoverRow({
  id: "0193c5a0-0000-7000-8000-0000000f0003",
  ticket_id: "0193c5a0-0000-7000-8000-00000000c065",
  ticket_number: "JD-190",
  title: "【親】京蟻 v2.1 リリース",
  from_member_id: SUZUKI,
  from_name: "鈴木",
  due_on: "2026-11-24",
  reply_due: "2026-11-24T09:00:00.000Z",
  carry_children: 8,
  note: null,
});
const AI_ROW = qrow("0193c5a0-0000-7000-8000-0000000a0009", {
  ticket_number: "EG-128",
  title: "セイコー様へ 11月分の請求書を送る",
  from_name: "佐藤",
  check_summary: "通過 3",
  due_on: "2026-11-24",
  decide_inline: true,
  irreversible: false,
  primary_action: "approve",
  note: "1,716,000 円 ・ 送り先 山田様（CC 鈴木様）",
  handover_kind: null,
  reply_due: null,
  carry_children: null,
  to_scope_name: null,
  ticket_scope_name: null,
});
/** 申し出の行（K-405：primary give・secondary decline・返事の期限なし。モック f8-offer-answer と同じ字） */
const OFFER_ROW = handoverRow({
  id: "0193c5a0-0000-7000-8000-0000000f0005",
  handover_kind: "offer",
  from_member_id: SUZUKI,
  from_name: "鈴木",
  reply_due: null,
  carry_children: 0,
  primary_action: "give",
  secondary_action: "decline",
  note: "手が空いたので、こちらで返します",
});
/** グループに配られた行（K-405：primary claim＝自分が持つ・secondary assign＝人を決める。モック f8-group と同じ字） */
const GROUP_ROW = handoverRow({
  id: "0193c5a0-0000-7000-8000-0000000f0006",
  ticket_id: "0193c5a0-0000-7000-8000-00000000c140",
  ticket_number: "EG-140",
  title: "展示会の来場者に礼状を送る",
  handover_kind: "distribute",
  from_member_id: SATO,
  from_name: "佐藤",
  due_on: "2026-11-30",
  reply_due: null,
  carry_children: 0,
  primary_action: "claim",
  secondary_action: "assign",
  note: "技術の質問なので受託開発で見てほしい",
  to_scope_name: "受託開発",
});

/** 渡された人（佐藤）として、承認待ちの行を答えに合わせて減らす形で開く */
async function asRecipient(page: Page, o: HOptions = {}) {
  let rows: Record<string, unknown>[] = o.queue ?? [handoverRow(), ...QUEUE()];
  const r = await mockHandovers(page, { me: SATO, role: "member", list: [incoming()], ...o, queue: rows });
  r.api.on.queue = () => ({ status: 200, body: { data: rows, meta: { limit: 20, counts: { total: rows.length } } } });
  const answer = r.h.on.answer;
  r.h.on.answer = (req) => {
    rows = rows.filter((x) => x["kind"] !== "handover" || x["id"] !== new URL(req.url()).pathname.split("/").at(-1));
    return answer(req);
  };
  return r;
}
const passRow = (p: Page) => p.locator("tr.k-hnd-row").filter({ hasText: TITLE });
const declineDialog = (p: Page) => p.getByRole("dialog", { name: "断る" });
const declineBox = (p: Page) => declineDialog(p).locator("textarea");
const sub = (p: Page) => p.locator("header.k-page-head .k-page-sub");
const card = (p: Page, text: string) => p.locator("#k-main .k-hnd-mcard").filter({ hasText: text });
const band = (p: Page, title: string) => bandsOf(p).locator(".k-band").filter({ hasText: title });

test("K412-UI-001 承認待ちの渡された行（幅 1440）：— ・渡された・番号のリンク・題名・要約・誰から・返事の期限・断る／受ける", async ({
  page,
}) => {
  await asRecipient(page);
  await openQueue(page, 1440);
  const r = passRow(page);
  await expect(r).toHaveCount(1);
  const td = r.locator("td");
  await expect(td.nth(0)).toHaveText("—");
  await expect(td.nth(1)).toHaveText("渡された");
  await expect(r.getByRole("link", { name: "EG-119", exact: true })).toHaveAttribute(
    "href",
    /\/tickets\/0193c5a0-0000-7000-8000-00000000c063$/,
  );
  await expect(r).toContainText(SUB);
  await expect(td.nth(5)).toContainText("高本");
  await expect(td.nth(7)).toHaveText("11/23 18:00");
  await expect(r.getByRole("button", { name: "断る" })).toHaveAttribute("data-variant", "outlined");
  await expect(r.getByRole("button", { name: "受ける" })).toHaveAttribute("data-variant", "primary");
});

test("K412-UI-002 行で受ける：小窓なしで { decision: accept } と冪等の鍵を 1 回。読み直して行が消え、数が 1 減り、小さな知らせ「EG-119 の担当者になりました」", async ({
  page,
}) => {
  const { h } = await asRecipient(page);
  await openQueue(page, 1440);
  await expect(sub(page)).toHaveText("あなたが決めるもの 4 件");
  await passRow(page).getByRole("button", { name: "受ける" }).click();
  await expect(passRow(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => h.answers.length).toBe(1);
  expect(h.answers[0]!.body).toMatchObject({ decision: "accept" });
  expect(h.answers[0]!.key ?? "").not.toBe("");
  await expect(sub(page)).toHaveText("あなたが決めるもの 3 件");
  // 承認待ちには帯が無いので、受けた直後に小さな知らせを 5 秒（D-148.44・answer=3d444fc8d59f）
  await expect(page.getByRole("status").filter({ hasText: "EG-119 の担当者になりました" })).toBeVisible();
});

test("K412-UI-003 断る小窓：題・対象・断る理由（必須・空）・注・やめる／断る", async ({ page }) => {
  await asRecipient(page);
  await openQueue(page, 1440);
  await passRow(page).getByRole("button", { name: "断る" }).click();
  const d = declineDialog(page);
  await expect(d).toBeVisible();
  await expect(d).toContainText(`EG-119 ${TITLE}`);
  await expect(d.locator(".k-label")).toContainText("断る理由");
  await expect(d.locator(".k-label")).toContainText("必須");
  await expect(declineBox(page)).toHaveValue("");
  await expect(d).toContainText("理由は高本さんに届き、チケットの記録に残ります。");
  await expect(d.getByRole("button", { name: "やめる" })).toBeVisible();
  await expect(d.getByRole("button", { name: "断る" })).toBeVisible();
});

test("K412-UI-004 断る（正常）：{ decision: decline, decline_reason } を 1 回・小窓が閉じ・行が消える", async ({
  page,
}) => {
  const { h } = await asRecipient(page);
  await openQueue(page, 1440);
  await passRow(page).getByRole("button", { name: "断る" }).click();
  await declineBox(page).fill(WHY);
  await declineDialog(page).getByRole("button", { name: "断る" }).click();
  await expect(declineDialog(page)).toHaveCount(0);
  await expect(passRow(page)).toHaveCount(0);
  await expect.poll(() => h.answers.length).toBe(1);
  expect(h.answers[0]!.body).toMatchObject({ decision: "decline", decline_reason: WHY });
});

test("K412-UI-005 断る理由が空：送らず、欄の下に「理由を書いてください」・aria-invalid", async ({ page }) => {
  const { h } = await asRecipient(page);
  await openQueue(page, 1440);
  await passRow(page).getByRole("button", { name: "断る" }).click();
  await declineDialog(page).getByRole("button", { name: "断る" }).click();
  await expect(declineDialog(page).locator(".k-err")).toHaveText("理由を書いてください");
  await expect(declineBox(page)).toHaveAttribute("aria-invalid", "true");
  expect(h.answers).toEqual([]);
});

test("K412-UI-006 もう取り消された（別のタブで先に決めた・口 409）：読み直して行が消え、知らせに正本 E-HND-005 の文", async ({
  page,
}) => {
  const r = await asRecipient(page);
  r.h.on.answer = () => {
    r.api.on.queue = () => ({ status: 200, body: { data: QUEUE(), meta: { limit: 20, counts: { total: 3 } } } });
    return errReply(409, CODE.gone, { 状態: "withdrawn" });
  };
  await openQueue(page, 1440);
  const reads = r.api.queueReads;
  await passRow(page).getByRole("button", { name: "受ける" }).click();
  await expect(passRow(page)).toHaveCount(0);
  expect(r.api.queueReads).toBeGreaterThan(reads);
  await expect(page.getByText(firstSentence(CODE.gone))).toBeVisible();
});

test("K412-UI-007 AI に任せた後（行・口 409）：行の中の alert に訳・行は残る", async ({ page }) => {
  const { h } = await asRecipient(page);
  h.on.answer = () => errReply(409, CODE.aiBusy);
  await openQueue(page, 1440);
  await passRow(page).getByRole("button", { name: "受ける" }).click();
  await expect(passRow(page).getByRole("alert")).toHaveText(BLOCKED);
  await expect(passRow(page)).toHaveCount(1);
});

test("K412-UI-008 行の二度押し：答えを止めた間に 2 回押しても口は 1 回・busy", async ({ page }) => {
  const { h } = await asRecipient(page);
  await openQueue(page, 1440);
  const release = h.hold();
  const b = passRow(page).getByRole("button", { name: "受ける" });
  await b.click();
  await expect.poll(() => h.answers.length).toBe(1);
  await expect(b).toBeDisabled();
  await b.click({ force: true });
  release();
  await expect(passRow(page)).toHaveCount(0);
  expect(h.answers.length).toBe(1);
});

test("K412-UI-009 行で送れない（口 500）：行の中の alert に E-PAGE-007 の 1 文目・押し直すと同じ冪等の鍵", async ({
  page,
}) => {
  const r = await asRecipient(page);
  const answer = r.h.on.answer;
  let n = 0;
  r.h.on.answer = (req) => (++n === 1 ? { status: 500, body: { error: "internal", code: "INTERNAL" } } : answer(req));
  await openQueue(page, 1440);
  await passRow(page).getByRole("button", { name: "受ける" }).click();
  await expect(passRow(page).getByRole("alert")).toContainText(firstSentence("E-PAGE-007"));
  await passRow(page).getByRole("button", { name: "受ける" }).click();
  await expect.poll(() => r.h.answers.length).toBe(2);
  expect(r.h.answers[1]!.key).toBe(r.h.answers[0]!.key);
});

test("K412-UI-010 断る小窓で送れない（口 500）：小窓の上の alert に E-PAGE-007 の 1 文目・理由は残る", async ({
  page,
}) => {
  const { h } = await asRecipient(page);
  h.on.answer = () => ({ status: 500, body: { error: "internal", code: "INTERNAL" } });
  await openQueue(page, 1440);
  await passRow(page).getByRole("button", { name: "断る" }).click();
  await declineBox(page).fill(WHY);
  await declineDialog(page).getByRole("button", { name: "断る" }).click();
  await expect(declineDialog(page).getByRole("alert")).toContainText(firstSentence("E-PAGE-007"));
  await expect(declineBox(page)).toHaveValue(WHY);
});

test("K412-UI-011 スマホのカード（幅 375）：表は見えず、行の数だけカード（並びは K63-UI-001）。渡された・AI の成果物の字とボタン・札は横に送る・横溢れ 0", async ({
  page,
}) => {
  await asRecipient(page, { queue: [handoverRow(), AI_ROW, ...QUEUE()] });
  await openQueue(page, 375);
  await expect(page.locator("#k-main section.k-ap-card")).toBeHidden();
  const cards = page.locator("#k-main .k-hnd-mcard");
  await expect(cards).toHaveCount(5);
  const pass = card(page, TITLE);
  await expect(pass.locator(".k-hnd-mcard-from")).toHaveText("渡された ・ 高本さんから");
  await expect(pass).toContainText("子チケット 2 件も一緒に ・ 理由：先方と面識があるので…");
  await expect(pass).toContainText("返事の期限 11/23 18:00");
  await expect(pass.getByRole("button", { name: "断る" })).toBeVisible();
  await expect(pass.getByRole("button", { name: "受ける" })).toBeVisible();
  const ai = card(page, "セイコー様へ 11月分の請求書を送る");
  await expect(ai.locator(".k-hnd-mcard-from")).toHaveText("佐藤のAI が作成 ・ 確認 通過 3");
  await expect(ai.getByRole("button", { name: "差し戻す" })).toBeVisible();
  await expect(ai.getByRole("button", { name: "承認する" })).toBeVisible();
  await expect(card(page, "11 月分の請求書を送る").getByRole("link", { name: "中身を見る" })).toBeVisible();
  const chips = page.locator("#k-main .k-hnd-mchips");
  expect(await chips.evaluate((e) => getComputedStyle(e).overflowX)).toBe("auto");
  expect(await overflowX(page)).toBe(0);
});

test("K412-UI-012 カードで受ける・断る（幅 375）：受けるで口に 1 回・カードが消え、知らせ「EG-119 の担当者になりました」。断るで断る小窓", async ({
  page,
}) => {
  const { h } = await asRecipient(page, { queue: [handoverRow(), ROW2, ...QUEUE()] });
  await openQueue(page, 375);
  await card(page, TITLE).getByRole("button", { name: "受ける" }).click();
  await expect(card(page, TITLE)).toHaveCount(0);
  await expect.poll(() => h.answers.length).toBe(1);
  expect(h.answers[0]!.body).toMatchObject({ decision: "accept" });
  // カードで受けた直後も 5 秒の知らせ（D-148.44）
  await expect(page.getByRole("status").filter({ hasText: "EG-119 の担当者になりました" })).toBeVisible();
  await card(page, "【親】京蟻 v2.1 リリース").getByRole("button", { name: "断る" }).click();
  await expect(declineDialog(page)).toBeVisible();
});

test("K412-UI-013 カードの AI の成果物（幅 375）：承認する → 前からの確かめの小窓（題「承認します」）・差し戻す → 差し戻しの小窓（表の行と同じ）", async ({
  page,
}) => {
  await asRecipient(page, { queue: [handoverRow(), AI_ROW, ...QUEUE()] });
  await openQueue(page, 375);
  await card(page, "セイコー様へ 11月分の請求書を送る").getByRole("button", { name: "承認する" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // 前からの ApproveConfirm は題「承認します」とボタンだけ（番号・題名は出さない・この葉は approve-confirm.tsx を触らない）
  await expect(page.getByRole("dialog")).toContainText("承認します");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card(page, "セイコー様へ 11月分の請求書を送る").getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByRole("dialog")).toContainText("差し戻す");
});

test("K412-UI-014 詳細の頼まれています帯：題・要約・理由・お願い・断る／受ける。担当者は高本 聖斗で ▾ なし・「→ あなた（返事待ち）」", async ({
  page,
}) => {
  await asRecipient(page);
  await openDetail(page);
  const b = band(page, "高本さんから、引き継いでほしいと頼まれています");
  await expect(b).toBeVisible();
  await expect(b).toContainText("返事の期限 11/23（月）18:00 ・ 子チケット 2 件も一緒に");
  await expect(b).toContainText(`理由：${REASON}`);
  await expect(b).toContainText(`お願い：${ASK}`);
  await expect(b.getByRole("button", { name: "断る" })).toBeVisible();
  await expect(b.getByRole("button", { name: "受ける" })).toBeVisible();
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(assigneeOf(page)).toContainText("→ あなた（返事待ち）");
  await expect(page.locator(".k-hnd-assignee-btn")).toHaveCount(0);
});

test("K412-UI-015 帯で受ける：口に 1 回。読み直して「担当者になりました」の帯・担当者は佐藤 花子で ▾。小さな知らせは出ない", async ({
  page,
}) => {
  const r = await asRecipient(page);
  const answer = r.h.on.answer;
  r.h.on.answer = (req) => {
    r.setAssignee(SATO);
    r.h.kinds = ["pass"]; // 受けた後は佐藤が担当者（DB が pass を返す）
    return answer(req);
  };
  await openDetail(page);
  await band(page, "頼まれています").getByRole("button", { name: "受ける" }).click();
  const b = band(page, "担当者になりました");
  await expect(b).toBeVisible();
  await expect(b).toContainText("高本さんから引き継ぎ ・ 11/20 10:12");
  // グループの名前は getTicket の今の渡しの ticket_scope.name（K-405）から出す
  await expect(b).toContainText(
    `子チケット 2 件も一緒に移りました ・ グループは${r.h.list[0]!.ticket_scope.name}のまま`,
  );
  expect(r.h.list[0]!.ticket_scope.name).toBe("営業");
  await expect.poll(() => r.h.answers.length).toBe(1);
  expect(r.h.answers[0]!.body).toMatchObject({ decision: "accept" });
  await expect(page.getByRole("button", { name: "担当者 佐藤 花子（担当者を変える）" })).toBeVisible();
  await expect(page.getByText("担当者になりました")).toHaveCount(1); // 帯だけ（同じ字の小さな知らせを重ねない）
});

test("K412-UI-016 1 回だけ：担当者になりました の帯を見た後に開き直すと、その帯は出ない", async ({ page }) => {
  await asRecipient(page, { assignee: SATO, list: [incoming({ state: "accepted", decided_at: AT })] });
  await openDetail(page);
  await expect(band(page, "担当者になりました")).toBeVisible();
  await openDetail(page);
  await expect(assigneeOf(page)).toContainText("佐藤 花子");
  await expect(band(page, "担当者になりました")).toHaveCount(0);
});

test("K412-UI-017 帯で断る：断る小窓 → { decision: decline } 1 回・帯が消え・担当者の欄に返事待ちが無い", async ({
  page,
}) => {
  const { h } = await asRecipient(page);
  await openDetail(page);
  await band(page, "頼まれています").getByRole("button", { name: "断る" }).click();
  await declineBox(page).fill(WHY);
  await declineDialog(page).getByRole("button", { name: "断る" }).click();
  await expect(declineDialog(page)).toHaveCount(0);
  await expect(band(page, "頼まれています")).toHaveCount(0);
  await expect.poll(() => h.answers.length).toBe(1);
  expect(h.answers[0]!.body).toMatchObject({ decision: "decline", decline_reason: WHY });
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(assigneeOf(page)).not.toContainText("返事待ち");
});

// 渡した人（高本）は配る権限の無い人（handover_kinds が offer だけ・モック f8-taken-sender の注）。配る権限のある人なら ▾ が出る（D-148.3・K-415）
const TAKEN: HOptions = {
  role: "member",
  kinds: ["offer"],
  assignee: SATO,
  list: [hview({ state: "accepted", decided_at: AT })],
};

test("K412-UI-018 渡した人（配る権限の無い人）の「引き継ぎました」：題・要約・担当者は佐藤 花子で ▾ なし。開き直すと出ない", async ({
  page,
}) => {
  await mockHandovers(page, TAKEN);
  await openDetail(page);
  const b = band(page, "佐藤さんが引き継ぎました");
  await expect(b).toBeVisible();
  await expect(b).toContainText("11/20 10:12 ・ 担当者は佐藤さんです");
  await expect(assigneeOf(page)).toContainText("佐藤 花子");
  await expect(page.locator(".k-hnd-assignee-btn")).toHaveCount(0);
  await openDetail(page);
  await expect(band(page, "佐藤さんが引き継ぎました")).toHaveCount(0);
});

test("K412-UI-019 取り消された渡しを開く：題・要約・行・ボタン 0。開き直すと出ない", async ({ page }) => {
  await asRecipient(page, { list: [incoming({ state: "withdrawn", decided_at: AT_WITHDRAWN })] });
  await openDetail(page);
  const b = band(page, "この渡しは取り消されました");
  await expect(b).toBeVisible();
  await expect(b).toContainText("高本さんが 11/20 11:40 に取り消し");
  await expect(b).toContainText("あなたが答える必要はなくなりました");
  await expect(b.getByRole("button")).toHaveCount(0);
  await openDetail(page);
  await expect(band(page, "この渡しは取り消されました")).toHaveCount(0);
});

test("K412-UI-020 返事の期限が過ぎた渡し（渡された人）：帯は頼まれていますのまま・受ける／断るが押せる", async ({
  page,
}) => {
  await asRecipient(page, { list: [incoming({ overdue: true, reply_due: "2026-11-19T09:00:00.000Z" })] });
  await openDetail(page);
  const b = band(page, "高本さんから、引き継いでほしいと頼まれています");
  await expect(b.getByRole("button", { name: "受ける" })).toBeEnabled();
  await expect(b.getByRole("button", { name: "断る" })).toBeEnabled();
  await expect(bandsOf(page)).not.toContainText("返事がまだありません");
});

test("K412-UI-021 ほかの人（鈴木）：待っている渡しのチケットで、頼まれています・渡し中の帯が出ない", async ({
  page,
}) => {
  await mockHandovers(page, {
    me: SUZUKI,
    role: "member",
    list: [hview({ can: { answer: false, withdraw: false, remind: false, reassign: false } })],
  });
  await openDetail(page);
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(bandsOf(page)).not.toContainText(/頼まれています|渡し中/);
});

test("K412-UI-022 AI に任せた後（帯・口 409）：帯の区画の中の橙の alert に訳・帯は残る", async ({ page }) => {
  const { h } = await asRecipient(page);
  h.on.answer = () => errReply(409, CODE.aiBusy);
  await openDetail(page);
  await band(page, "頼まれています").getByRole("button", { name: "受ける" }).click();
  const alert = bandsOf(page).getByRole("alert").filter({ hasText: BLOCKED });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("data-tone", "warn");
  await expect(band(page, "頼まれています")).toBeVisible();
});

test("K412-UI-023 幅 375・768・1024・1440：渡された行のある承認待ちと頼まれています帯の詳細で、頁の横溢れ 0", async ({
  page,
}) => {
  await asRecipient(page, { queue: [handoverRow(), ROW2, AI_ROW, ...QUEUE()] });
  const bad: string[] = [];
  for (const w of [375, 768, 1024, 1440]) {
    await openQueue(page, w);
    let o = await overflowX(page);
    if (o !== 0) bad.push(`承認待ち 幅 ${w}：${o}px`);
    await openDetail(page, w);
    await expect(band(page, "頼まれています")).toBeVisible();
    const b = await box(band(page, "頼まれています"));
    if (b.x + b.width > w + 0.5) bad.push(`詳細 幅 ${w}：帯が画面の外`);
    o = await overflowX(page);
    if (o !== 0) bad.push(`詳細 幅 ${w}：${o}px`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

test("K412-UI-025 スマホのカードは全部の種類を描く（幅 375）：申し出の行は「渡された ・ 鈴木さんから」・断る／渡す（渡すで答える口に accept 1 回）、グループに配られた行は「渡された ・ 佐藤さんから」・「期限 11/30」・人を決める／自分が持つ", async ({
  page,
}) => {
  const { h } = await asRecipient(page, { me: ME, queue: [OFFER_ROW, GROUP_ROW, AI_ROW] });
  await openQueue(page, 375);
  const offer = card(page, TITLE);
  await expect(offer.locator(".k-hnd-mcard-from")).toHaveText("渡された ・ 鈴木さんから");
  await expect(offer.getByRole("button", { name: "断る" })).toBeVisible();
  await expect(offer.getByRole("button", { name: "渡す" })).toBeVisible();
  const group = card(page, "展示会の来場者に礼状を送る");
  await expect(group.locator(".k-hnd-mcard-from")).toHaveText("渡された ・ 佐藤さんから");
  await expect(group).toContainText("期限 11/30");
  await expect(group.getByRole("button", { name: "人を決める" })).toBeVisible();
  await expect(group.getByRole("button", { name: "自分が持つ" })).toBeVisible();
  await offer.getByRole("button", { name: "渡す" }).click();
  await expect.poll(() => h.answers.length).toBe(1);
  expect(h.answers[0]!.body).toMatchObject({ decision: "accept" });
});

/** 本番をモックの状態にする手順 */
const DRIVE: Record<string, (p: Page, w: number) => Promise<void>> = {
  "f8-queue": async (p, w) => {
    await asRecipient(p, { queue: [handoverRow(), ROW2, AI_ROW] });
    await openQueue(p, w);
  },
  "f8-decline": async (p, w) => {
    await asRecipient(p, { queue: [handoverRow(), ROW2, AI_ROW] });
    await openQueue(p, w);
    const at = w <= 767 ? card(p, TITLE) : passRow(p);
    await at.getByRole("button", { name: "断る" }).click();
    await declineBox(p).fill(WHY);
  },
  "f8-waiting-recipient": async (p, w) => {
    await asRecipient(p);
    await openDetail(p, w);
    await expect(band(p, "頼まれています")).toBeVisible();
  },
  "f8-accepted": async (p, w) => {
    await asRecipient(p, { assignee: SATO, list: [incoming({ state: "accepted", decided_at: AT })] });
    await openDetail(p, w);
    await expect(band(p, "担当者になりました")).toBeVisible();
  },
  "f8-gone": async (p, w) => {
    await asRecipient(p, { list: [incoming({ state: "withdrawn", decided_at: AT_WITHDRAWN })] });
    await openDetail(p, w);
    await expect(band(p, "この渡しは取り消されました")).toBeVisible();
  },
  "f8-taken-sender": async (p, w) => {
    await mockHandovers(p, TAKEN);
    await openDetail(p, w);
    await expect(band(p, "佐藤さんが引き継ぎました")).toBeVisible();
  },
};

for (const [id, go] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K412-UI-024 ${id} 幅 ${w}：渡された行・カード・帯・断る小窓の値がモックと同じ（共通の道具 matchMock・役は HND_PAIRS）`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(browser, id, w, (p) => go(p, w), {
        base: "/dev/mock/f8",
        pairs: HND_PAIRS,
        blur: true,
      });
      expect(rows.length, "比べた役が 1 つも無い").toBeGreaterThan(1);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
}
