// K-411「画面：詳細の「担当者 ▾」から相手を選んで引き継いでもらう」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：/dev/mock/f8 の f8-detail-owner・f8-pick・f8-pick-search・f8-pick-none・f8-pass・f8-pass-error・f8-pass-refused・
//     f8-blocked・f8-noperm・f8-failed（代表 OK：2026-11-20 の下絵を見た会話・answer=fabd031f9b37）。
//   口は網の手前で差し替える（前からの土台 mockApi の上に tests/k/handover-mock.ts の mockHandovers）。口の形は K-401・K-402・K-405 の md に合わせる。
//   帯・担当者の欄・▾ は getTicket の handover（今の渡し）と handover_kinds（見ている人ができる種類）だけで決める（詳細の口は 6 のまま・
//   役の名前で出し分けない・PM の決め 2026-11-20）。記録の読む口（listTicketHandovers）は詳細を開いても呼ばない。
//   押した直後の口の数は expect.poll で待つ（台が混んでも口の差し替えに届く前に数えない）。
//   エラーの番号は K-401 の共通の番号（11_tickets/K-401.md の表）。文は正本の 1 件（{名前}・{訳} に答えの detail を入れる）。
//   固定の待ちは使わない（要素と答えを待つ。2 回押しは答えを止めて見る）。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TICKET, pending } from "../features/F5/approve-complete.harness";
import {
  GROUP_EG,
  GROUP_JD,
  HND,
  HND_PAIRS,
  KIMURA,
  ME,
  REASON,
  SATO,
  SUZUKI,
  TANAKA,
  YAMAGUCHI,
  assigneeOf,
  bandsOf,
  created,
  errReply,
  hview,
  mockHandovers,
  openDetail,
  preview,
  type HOptions,
  type HView,
  type Preview,
} from "./handover-mock";
import { ROOT, box, overflowX } from "./kit";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

/** K-401 の共通のエラーの番号（渡す口の断り） */
const CODE = {
  reasonEmpty: "E-HND-007",
  duePast: "E-HND-008",
  unavailable: "E-HND-006",
  gone: "E-HND-014",
  waitingOther: "E-HND-004",
  aiBusy: "E-HND-003",
} as const;
const ERRORS = JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
  errors: { id: string; message: string }[];
};
const firstSentence = (id: string) => {
  const m = ERRORS.errors.find((e) => e.id === id)?.message ?? id;
  const i = m.indexOf("。");
  return i < 0 ? m : m.slice(0, i + 1);
};

const BTN = "担当者 高本 聖斗（担当者を変える）";
const PICK = "担当者を選ぶ";
const PASS = "引き継いでもらう";
const INTRO = "選んだ人に「引き継いでもらう」を頼みます。相手が受けるまで担当者はあなたのままです";
const BLOCKED = "AI の実行（承認）が終わってから渡してください";
const BLOCKED_INTRO = "AI が動いている・承認を待っているあいだは、担当者を変えられません";
const CHILDREN = "子チケット 2 件も渡す（ほかの人の 1 件はそのまま）";
/** グループを移す行（相手がチケットのグループに入っていないときだけ出る・D-148.11） */
const SCOPE = /グループを「営業」から/;
const NOTIFY = "上の層（マネージャー）にも知らせる";

/** 相手がチケットのグループ（営業）に入っていない下見（グループを移す行が出る形・D-148.11）。
 *  モック f8-pass の相手の佐藤は営業にいるので、グループを移す行は出ない（既定の preview() の佐藤は in_group true・主のグループ 営業） */
const OUTSIDE = (id: string, o: Partial<Preview> = {}): Preview => {
  const base = preview(o);
  return {
    ...base,
    candidates: base.candidates.map((m) => (m.id === id ? { ...m, in_group: false, group: GROUP_JD } : m)),
  };
};
const rulesWith = (children: "ask" | "always" | "never"): Preview["rules"] =>
  preview().rules.map((r) => (r.target === "children" ? { ...r, mode: children } : r));

const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const pickDialog = (p: Page) => p.getByRole("dialog", { name: PICK });
const passDialog = (p: Page) => p.getByRole("dialog", { name: PASS });
const field = (p: Page, label: string) =>
  passDialog(p).locator("label.k-field, div.k-field").filter({ hasText: label });
const reasonBox = (p: Page) => field(p, "理由").first().locator("textarea");
const dueBox = (p: Page) => field(p, "返事の期限").locator("input");
const item = (p: Page, name: RegExp | string) => pickDialog(p).locator(".k-hnd-pick-item").filter({ hasText: name });

async function setup(page: Page, o: HOptions & { pv?: Preview } = {}) {
  // 既定の見ている人は高本＝担当者・会社を作った人（/me の role_id null）・できる種類は ["pass"]
  const r = await mockHandovers(page, o);
  r.h.on.preview = () => ok(o.pv ?? preview());
  return r;
}
async function openPick(page: Page, width = 1440) {
  await openDetail(page, width);
  await page.getByRole("button", { name: BTN }).click();
  await expect(pickDialog(page)).toBeVisible();
}
async function openPass(page: Page, who = "佐藤 花子", width = 1440) {
  await openPick(page, width);
  await item(page, who).click();
  await expect(passDialog(page)).toBeVisible();
}

test("K411-UI-001 担当者本人（会社を作った人・role_id null・handover_kinds pass）の詳細に ▾。開いた時点で下見は呼ばず、押すと 1 回だけ読んで「担当者を選ぶ」の小窓（対象・intro）", async ({
  page,
}) => {
  const { h } = await setup(page);
  await openDetail(page);
  const btn = page.getByRole("button", { name: BTN });
  await expect(btn).toBeVisible();
  expect(h.previewReads).toBe(0);
  await btn.click();
  await expect(pickDialog(page)).toBeVisible();
  await expect(pickDialog(page)).toContainText("EG-119 問い合わせ（山田様）に一次返信する");
  await expect(pickDialog(page).getByText(INTRO)).toBeVisible();
  await expect.poll(() => h.previewReads).toBe(1);
});

test("K411-UI-002 人の並び：自分は（自分）✓で押せない・今週の件数・止まっている／招待中は「選べません」で押せない（押しても進まず書かない）", async ({
  page,
}) => {
  const { h } = await setup(page);
  await openPick(page);
  await expect(pickDialog(page).locator(".k-hnd-pick-item")).toHaveCount(5);
  await expect(item(page, "高本 聖斗（自分）")).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, "鈴木 一郎")).toContainText("営業 ・ 今週 4 件");
  await expect(item(page, "佐藤 花子")).toContainText("営業 マネージャー ・ 今週 9 件");
  await expect(item(page, "田中 美咲")).toContainText("選べません（止まっています）");
  await expect(item(page, "田中 美咲")).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, "木村 誠")).toContainText("選べません（招待中）");
  await expect(item(page, "木村 誠")).toHaveAttribute("aria-disabled", "true");
  await item(page, "田中 美咲").click({ force: true });
  await expect(passDialog(page)).toHaveCount(0);
  expect(h.passes).toEqual([]);
});

test("K411-UI-003 探す（表記ゆらぎ）：suzuki・前後の空白と大文字・全角・漢字のどれでも鈴木 一郎の 1 行", async ({
  page,
}) => {
  await setup(page);
  await openPick(page);
  const s = pickDialog(page).getByRole("searchbox", { name: "名前・メールで探す" });
  for (const q of ["suzuki", " SUZUKI ", "ＳＵＺＵＫＩ", "鈴木"]) {
    await s.fill(q);
    await expect(pickDialog(page).locator(".k-hnd-pick-item"), q).toHaveCount(1);
    await expect(pickDialog(page).locator(".k-hnd-pick-item"), q).toContainText("鈴木 一郎");
  }
});

test("K411-UI-004 合う人がいない：「山田」で行は 0、role=status に案内の文", async ({ page }) => {
  await setup(page);
  await openPick(page);
  await pickDialog(page).getByRole("searchbox", { name: "名前・メールで探す" }).fill("山田");
  await expect(pickDialog(page).locator(".k-hnd-pick-item")).toHaveCount(0);
  await expect(pickDialog(page).getByRole("status")).toHaveText(
    "「山田」に合う人がいません。名前かメールの一部で探してください（止まっている人・招待中の人も出ます）",
  );
});

test("K411-UI-005 引き継いでもらうの小窓：相手・理由（必須）・お願い・返事の期限（既定）・一緒に切り替える物・上の層・注・ボタン", async ({
  page,
}) => {
  await setup(page);
  await openPass(page);
  await expect(pickDialog(page)).toHaveCount(0);
  await expect(field(page, "渡す相手")).toContainText("佐藤 花子");
  await expect(field(page, "渡す相手").getByRole("button", { name: "変える" })).toBeVisible();
  await expect(field(page, "理由").first()).toContainText("必須");
  await expect(reasonBox(page)).toHaveValue("");
  await expect(field(page, "お願い").locator("textarea")).toHaveValue("");
  await expect(dueBox(page)).toHaveValue("2026-11-23T18:00");
  await expect(passDialog(page).getByRole("checkbox", { name: CHILDREN })).toBeChecked();
  await expect(passDialog(page).getByRole("checkbox", { name: CHILDREN })).toBeEnabled();
  // 佐藤 花子は営業（チケットのグループ）にいるので、グループを移す行は無い（D-148.11・モック f8-pass と同じ）
  await expect(passDialog(page).getByRole("checkbox", { name: SCOPE })).toHaveCount(0);
  await expect(passDialog(page).getByRole("checkbox", { name: NOTIFY })).not.toBeChecked();
  await expect(passDialog(page)).toContainText(
    "相手が受けるまで担当者はあなたのまま（渡し中）。断られたら理由つきで戻ってきます。",
  );
  await expect(passDialog(page).getByRole("button", { name: "やめる" })).toBeVisible();
  await expect(passDialog(page).getByRole("button", { name: PASS })).toBeVisible();
});

test("K411-UI-006 一緒に切り替える物の決まり：always は外せない・never は行が無い・相手がグループに入っていればグループの行が無い", async ({
  page,
}) => {
  const r = await setup(page, { pv: preview({ rules: rulesWith("always") }) });
  await openPass(page, "鈴木 一郎");
  await expect(passDialog(page).getByRole("checkbox", { name: CHILDREN })).toBeChecked();
  await expect(passDialog(page).getByRole("checkbox", { name: CHILDREN })).toBeDisabled();
  await expect(passDialog(page).getByRole("checkbox", { name: /グループを/ })).toHaveCount(0);
  r.h.on.preview = () => ok(OUTSIDE(SUZUKI));
  await openPass(page, "鈴木 一郎");
  await expect(
    passDialog(page).getByRole("checkbox", { name: "グループを「営業」から「受託開発」に移す" }),
  ).not.toBeChecked();
  r.h.on.preview = () => ok(preview({ rules: rulesWith("never") }));
  await openPass(page, "鈴木 一郎");
  await expect(passDialog(page).getByRole("checkbox", { name: /子チケット/ })).toHaveCount(0);
});

test("K411-UI-007 相手を変える：理由の字を残したまま相手を選ぶ小窓に戻り、鈴木を選ぶと相手が替わる", async ({
  page,
}) => {
  await setup(page);
  await openPass(page);
  await reasonBox(page).fill("締めで手が空かない");
  await field(page, "渡す相手").getByRole("button", { name: "変える" }).click();
  await expect(pickDialog(page)).toBeVisible();
  await item(page, "鈴木 一郎").click();
  await expect(field(page, "渡す相手")).toContainText("鈴木 一郎");
  await expect(reasonBox(page)).toHaveValue("締めで手が空かない");
});

test("K411-UI-008 渡す（正常）：中身と冪等の鍵を 1 回送り、小窓が閉じ、知らせ・渡し中の帯（ボタン 3 つ）・担当者の下の返事待ち", async ({
  page,
}) => {
  const { h } = await setup(page);
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(passDialog(page)).toHaveCount(0);
  await expect.poll(() => h.passes.length).toBe(1);
  expect(h.passes[0]!.body).toMatchObject({
    kind: "pass",
    to_member_id: SATO,
    reason: REASON,
    to_scope_id: null,
    reply_due: "2026-11-23T09:00:00.000Z",
    switch: { children: true, links: false, group: false, axes: [] },
    notify_managers: false,
  });
  expect(h.passes[0]!.key ?? "").not.toBe("");
  await expect(page.getByText("佐藤さんに渡しました")).toBeVisible();
  const band = bandsOf(page).locator(".k-band").filter({ hasText: "佐藤さんの返事を待っています（渡し中）" });
  await expect(band).toBeVisible();
  await expect(band).toContainText("返事の期限 11/23（月）18:00 ・ 担当者は返事が来るまであなたのまま");
  await expect(band).toContainText(`理由：${REASON}`);
  for (const b of ["催促する", "取り消す", "別の人にする"])
    await expect(band.getByRole("button", { name: b })).toHaveCount(1);
  await expect(assigneeOf(page)).toContainText("→ 佐藤 花子（返事待ち）");
});

test("K411-UI-009 開き直す（再取得）：getTicket をもう一度読み、その今の渡しから渡し中の帯と返事待ちが出る（記録の読む口は呼ばない）", async ({
  page,
}) => {
  const { h } = await setup(page);
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(passDialog(page)).toHaveCount(0);
  const before = h.ticketReads;
  await openDetail(page);
  await expect.poll(() => h.ticketReads).toBeGreaterThan(before);
  expect(h.listReads).toBe(0);
  await expect(bandsOf(page)).toContainText("佐藤さんの返事を待っています（渡し中）");
  await expect(assigneeOf(page)).toContainText("→ 佐藤 花子（返事待ち）");
});

test("K411-UI-010 理由が空：送らず、理由の欄の下に「理由を書いてください」・aria-invalid", async ({ page }) => {
  const { h } = await setup(page);
  await openPass(page);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(field(page, "理由").first().locator(".k-err")).toHaveText("理由を書いてください");
  await expect(reasonBox(page)).toHaveAttribute("aria-invalid", "true");
  await expect(passDialog(page)).toBeVisible();
  expect(h.passes).toEqual([]);
});

test("K411-UI-011 返事の期限が過去：送らず、期限の欄の下に「返事の期限は今より後にしてください」", async ({ page }) => {
  const { h } = await setup(page);
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await dueBox(page).fill("2020-01-06T18:00");
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(field(page, "返事の期限").locator(".k-err")).toHaveText("返事の期限は今より後にしてください");
  expect(h.passes).toEqual([]);
});

test("K411-UI-012 相手が選べなくなった（口 409）：相手の欄の下に訳（{名前} は田中）・理由は残る", async ({ page }) => {
  const { h } = await setup(page);
  h.on.pass = () => errReply(409, CODE.unavailable, { 名前: "田中", 訳: "止まっています" });
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(field(page, "渡す相手").locator(".k-err")).toHaveText(
    "田中さんは今は選べません（止まっています）。別の人を選んでください",
  );
  await expect(reasonBox(page)).toHaveValue(REASON);
  await expect(passDialog(page)).toBeVisible();
});

test("K411-UI-025 相手が会社を抜けた（小窓を開いた後・口 404 E-HND-014）：相手の欄の下に正本の文・小窓の上の alert は出ない・理由は残る", async ({
  page,
}) => {
  const { h } = await setup(page);
  h.on.pass = () => errReply(404, CODE.gone);
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(field(page, "渡す相手").locator(".k-err")).toHaveText("選んだ人が見つかりません。選び直してください");
  await expect(passDialog(page).getByRole("alert")).toHaveCount(0);
  await expect(reasonBox(page)).toHaveValue(REASON);
  await expect(passDialog(page)).toBeVisible();
});

test("K411-UI-013 別の渡しの返事待ち（別のタブで先に渡した・口 409）：小窓の上の alert に訳（{名前} は鈴木）・理由は残る", async ({
  page,
}) => {
  const { h } = await setup(page);
  h.on.pass = () => errReply(409, CODE.waitingOther, { 名前: "鈴木" });
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(passDialog(page).getByRole("alert")).toHaveText(
    "いま鈴木さんの返事を待っています。先にその渡しを取り消してください",
  );
  await expect(reasonBox(page)).toHaveValue(REASON);
});

test("K411-UI-014 送れない（口 500）：alert に E-PAGE-007 の文・理由は残り、押し直すと同じ冪等の鍵で 2 回目を送る", async ({
  page,
}) => {
  const { h } = await setup(page);
  let n = 0;
  h.on.pass = (req) => {
    n++;
    if (n === 1) return { status: 500, body: { error: "internal", code: "INTERNAL" } };
    const v = hview({ reason: (req.postDataJSON() as { reason: string }).reason });
    h.list = [v];
    return ok(created(v), 201); // 渡す口の答えは K-401 の 16 の鍵（読む口の形を作らない）
  };
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(passDialog(page).getByRole("alert")).toContainText(firstSentence("E-PAGE-007"));
  await expect(reasonBox(page)).toHaveValue(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(passDialog(page)).toHaveCount(0);
  await expect.poll(() => h.passes.length).toBe(2);
  expect(h.passes[1]!.key).toBe(h.passes[0]!.key);
});

test("K411-UI-015 二度押し：答えを止めた間に 2 回押しても口は 1 回・ボタンは busy。答えると閉じる", async ({
  page,
}) => {
  const { h } = await setup(page);
  await openPass(page);
  await reasonBox(page).fill(REASON);
  const release = h.hold();
  const send = passDialog(page).getByRole("button", { name: PASS });
  await send.click();
  await expect.poll(() => h.passes.length).toBe(1);
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  release();
  await expect(passDialog(page)).toHaveCount(0);
  expect(h.passes.length).toBe(1);
});

test("K411-UI-016 AI が動いている：▾ は押せ（aria-disabled なし）・名前の下に訳。押すと橙の訳・intro・人は全部押せない", async ({
  page,
}) => {
  await setup(page, {
    band: { stage: "doing", run: { phase: "execute", status: "running" } },
    pv: preview({ blocked: "ai_running" }),
  });
  await openDetail(page);
  const btn = page.getByRole("button", { name: BTN });
  await expect(btn).not.toHaveAttribute("aria-disabled", "true");
  await expect(assigneeOf(page)).toContainText("AI の実行（承認）が終わってから渡してください");
  await btn.click();
  await expect(pickDialog(page).locator(".k-callout")).toHaveText(BLOCKED);
  await expect(pickDialog(page).getByText(BLOCKED_INTRO)).toBeVisible();
  const items = pickDialog(page).locator(".k-hnd-pick-item");
  const n = await items.count();
  expect(n).toBe(5);
  for (let i = 0; i < n; i++) await expect(items.nth(i)).toHaveAttribute("aria-disabled", "true");
});

test("K411-UI-017 承認待ち：小窓の訳は同じ。開いた後に AI に任せて口が 409（E-HND-003）なら引き継いでもらうの小窓の上に橙の訳", async ({
  page,
}) => {
  const r = await setup(page, {
    band: { stage: "awaiting_approval", approval: pending() },
    pv: preview({ blocked: "approval" }),
  });
  await openPick(page);
  await expect(pickDialog(page).locator(".k-callout")).toHaveText(BLOCKED);
  await page.keyboard.press("Escape");
  r.h.on.preview = () => ok(preview());
  r.h.on.pass = () => errReply(409, CODE.aiBusy);
  await openPass(page);
  await reasonBox(page).fill(REASON);
  await passDialog(page).getByRole("button", { name: PASS }).click();
  await expect(passDialog(page).locator(".k-callout")).toHaveText(BLOCKED);
});

// 種類は DB（K-401 の app.handover_kinds）が決め、getTicket の handover_kinds で来る。閲覧のみ・取引先は []・申し出だけの人は ["offer"]
for (const [who, me, role, kinds] of [
  ["閲覧のみ（山口・viewer）", YAMAGUCHI, "viewer", []],
  ["取引先（木村・requester）", KIMURA, "requester", []],
  ["担当者でない申し出だけの人（鈴木・member）", SUZUKI, "member", ["offer"]],
] as const) {
  test(`K411-UI-018 ▾ を出さない人：${who} の詳細では担当者は字だけで ▾ が 0 個・下見の口は 0 回`, async ({ page }) => {
    const { h } = await setup(page, { me, role, kinds: [...kinds], assignee: ME });
    await openDetail(page);
    await expect(assigneeOf(page)).toContainText("高本 聖斗");
    await expect(page.locator(".k-hnd-assignee-btn")).toHaveCount(0);
    expect(h.previewReads).toBe(0);
  });
}

/** getTicket の handover の形が違う（state・from が無い）答え。読めない帯の元（K-400 の handoverOf の invalid） */
const BROKEN = { id: HND } as unknown as HView;

test("K411-UI-019 渡しの様子を読めない（getTicket の handover の形が違う）：alert の帯・本文は見える・「もう一度読む」で getTicket を読み直して消える", async ({
  page,
}) => {
  const { h } = await setup(page, { list: [BROKEN] });
  await openDetail(page);
  const band = bandsOf(page).getByRole("alert").filter({ hasText: "渡しの様子を読み込めませんでした" });
  await expect(band).toBeVisible();
  await expect(band).toContainText("本文はそのまま読めます");
  await expect(page.getByText("月末の請求を出す")).toBeVisible(); // 本文（目的の区画）はそのまま読める
  const before = h.ticketReads;
  h.list = [];
  await band.getByRole("button", { name: "もう一度読む" }).click();
  await expect(bandsOf(page).getByText("渡しの様子を読み込めませんでした")).toHaveCount(0);
  await expect.poll(() => h.ticketReads).toBe(before + 1);
  expect(h.listReads).toBe(0);
});

test("K411-UI-020 キーボード：▾ に焦点 → Enter で開き → Esc で閉じて焦点は ▾。引き継いでもらうの「やめる」で閉じ、口に 0 回", async ({
  page,
}) => {
  const { h } = await setup(page);
  await openDetail(page);
  const btn = page.getByRole("button", { name: BTN });
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(pickDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pickDialog(page)).toHaveCount(0);
  await expect(btn).toBeFocused();
  await openPass(page);
  await passDialog(page).getByRole("button", { name: "やめる" }).click();
  await expect(passDialog(page)).toHaveCount(0);
  expect(h.passes).toEqual([]);
});

test("K411-UI-021 幅 375・768・1440：2 つの小窓を開いても横溢れ 0・小窓は画面の中（足のボタンも高さの中）", async ({
  page,
}) => {
  await setup(page);
  const bad: string[] = [];
  for (const w of [375, 768, 1440]) {
    await openPick(page, w);
    for (const [name, d] of [
      ["相手を選ぶ", pickDialog(page)],
      ["引き継いでもらう", passDialog(page)],
    ] as const) {
      if (name === "引き継いでもらう") await item(page, "佐藤 花子").click();
      await expect(d).toBeVisible();
      const b = await box(d);
      const vh = page.viewportSize()!.height;
      if (b.x < 0 || b.x + b.width > w + 0.5) bad.push(`幅 ${w}・${name}：横が画面の外`);
      const foot = await box(d.getByRole("button", { name: name === "相手を選ぶ" ? "やめる" : PASS }));
      if (foot.y + foot.height > vh + 0.5) bad.push(`幅 ${w}・${name}：足のボタンが画面の下`);
      const o = await overflowX(page);
      if (o !== 0) bad.push(`幅 ${w}・${name}：横溢れ ${o}px`);
    }
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

/** 本番をモックの状態にする手順 */
const DRIVE: Record<string, { skip?: string[]; go: (p: Page, w: number) => Promise<void> }> = {
  "f8-detail-owner": {
    go: async (p, w) => {
      await setup(p);
      await openDetail(p, w);
    },
  },
  "f8-pick": {
    go: async (p, w) => {
      await setup(p);
      await openPick(p, w);
    },
  },
  "f8-pick-search": {
    go: async (p, w) => {
      await setup(p);
      await openPick(p, w);
      await pickDialog(p).getByRole("searchbox", { name: "名前・メールで探す" }).fill("suzuki");
    },
  },
  "f8-pick-none": {
    go: async (p, w) => {
      await setup(p);
      await openPick(p, w);
      await pickDialog(p).getByRole("searchbox", { name: "名前・メールで探す" }).fill("山田");
    },
  },
  "f8-pass": {
    go: async (p, w) => {
      await setup(p);
      await openPass(p, "佐藤 花子", w);
    },
  },
  "f8-pass-error": {
    // モックは 3 つの誤りを同時に描くが、本番は手元の確かめ（理由・期限）と口の断り（相手）が別の回に出る。字は UI-010〜012 が見る
    skip: ["dialog-err:当たった数"],
    go: async (p, w) => {
      const pv = preview();
      await setup(p, {
        pv: { ...pv, candidates: pv.candidates.map((m) => (m.id === TANAKA ? { ...m, state: "active" as const } : m)) },
      });
      await openPass(p, "田中 美咲", w);
      await dueBox(p).fill("2020-01-06T18:00");
      await passDialog(p).getByRole("button", { name: PASS }).click();
      await expect(field(p, "理由").first().locator(".k-err")).toBeVisible();
    },
  },
  "f8-pass-refused": {
    go: async (p, w) => {
      const { h } = await setup(p);
      h.on.pass = () => errReply(409, CODE.waitingOther, { 名前: "鈴木" });
      await openPass(p, "佐藤 花子", w);
      await reasonBox(p).fill(REASON);
      await passDialog(p).getByRole("button", { name: PASS }).click();
      await expect(passDialog(p).getByRole("alert")).toBeVisible();
    },
  },
  "f8-blocked": {
    go: async (p, w) => {
      await setup(p, {
        band: { stage: "doing", run: { phase: "execute", status: "running" } },
        pv: preview({ blocked: "ai_running" }),
      });
      await openPick(p, w);
    },
  },
  "f8-noperm": {
    go: async (p, w) => {
      await setup(p, { me: YAMAGUCHI, role: "viewer", kinds: [] });
      await openDetail(p, w);
    },
  },
  "f8-failed": {
    go: async (p, w) => {
      await setup(p, { list: [BROKEN] });
      await openDetail(p, w);
      await expect(bandsOf(p).getByRole("alert")).toBeVisible();
    },
  },
};

for (const [id, d] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K411-UI-022 ${id} 幅 ${w}：担当者の欄・帯・小窓の値がモックと同じ（共通の道具 matchMock・役は HND_PAIRS）`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(browser, id, w, (p) => d.go(p, w), {
        base: "/dev/mock/f8",
        pairs: HND_PAIRS,
        blur: true,
        ...(d.skip ? { skip: d.skip } : {}),
      });
      expect(rows.length, "比べた役が 1 つも無い").toBeGreaterThan(1);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
}

test("K411-UI-023 口の数（速さ）：渡し中のチケットの詳細を開くと、getTicket は 1 回で帯と返事待ちが出て、記録の読む口・下見の口は 0 回（詳細の口は 6 のまま）", async ({
  page,
}) => {
  const hits: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p === `/api/v1/tickets/${TICKET}/handovers` || p === `/api/v1/tickets/${TICKET}/handover-preview`) hits.push(p);
  });
  const { h } = await setup(page, { list: [hview()] });
  await openDetail(page);
  await expect(bandsOf(page)).toContainText("佐藤さんの返事を待っています（渡し中）");
  await expect(assigneeOf(page)).toContainText("→ 佐藤 花子（返事待ち）");
  expect(h.ticketReads).toBe(1);
  expect(hits).toEqual([]);
});

test("K411-UI-024 返事待ちの字は渡しの種類で分ける：申し出が待っていると担当者の下に返事待ちの字は無く、グループに配った渡しが待っていると「→ グループ「受託開発」（返事待ち）」", async ({
  page,
}) => {
  const r = await setup(page, {
    list: [
      hview({
        kind: "offer",
        from: { member_id: SUZUKI, display_name: "鈴木 一郎" },
        to: { member_id: ME, display_name: "高本 聖斗" },
        reply_due: null,
      }),
    ],
  });
  await openDetail(page);
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(assigneeOf(page)).not.toContainText("返事待ち");
  r.h.list = [hview({ kind: "distribute", to: null, to_scope: GROUP_JD, ticket_scope: GROUP_EG })];
  await openDetail(page);
  await expect(assigneeOf(page)).toContainText("→ グループ「受託開発」（返事待ち）");
});
