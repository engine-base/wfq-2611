// K-413「画面：渡した人が 催促する・取り消す・別の人にする」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：/dev/mock/f8 の f8-waiting-sender・f8-reminded・f8-withdraw・f8-overdue・f8-declined-sender
//     （代表 OK：2026-11-20 の下絵を見た会話・answer=fabd031f9b37）。
//   口は網の手前で差し替える（前からの土台 mockApi の上に tests/k/handover-mock.ts の mockHandovers）。口の形は K-402・K-406・K-407 の md に合わせる。
//   帯は getTicket の handover（今の渡し）から出る（PM の決め 2026-11-20）。押した直後の口の数は expect.poll で待ち、busy を見てから 2 回目を押す
//   エラーの番号は K-406 の表（E-HND-080 今日はもう催促した）と K-401 の共通（E-HND-005 もう決まっている）。文は正本の 1 件。
//   固定の待ちは使わない（要素と答えを待つ。2 回押しは答えを止めて見る）。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  AT,
  DUE,
  DUE_PAST,
  HND,
  HND_OLD,
  HND_PAIRS,
  ME,
  SATO,
  SUZUKI,
  WHY,
  assigneeOf,
  bandsOf,
  errReply,
  hview,
  incoming,
  mockHandovers,
  openDetail,
  preview,
  type HOptions,
} from "./handover-mock";
import { ROOT, box, overflowX } from "./kit";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";

/** 取り消す・催促するの断り（K-406 の E-HND-080・K-401 の E-HND-005） */
const CODE = { remindOnce: "E-HND-080", decided: "E-HND-005" } as const;
const ERRORS = JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
  errors: { id: string; message: string }[];
};
const msg = (id: string) => ERRORS.errors.find((e) => e.id === id)?.message ?? id;
const firstSentence = (id: string) => {
  const m = msg(id);
  const i = m.indexOf("。");
  return i < 0 ? m : m.slice(0, i + 1);
};
const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const SENDING = "佐藤さんの返事を待っています（渡し中）";
const OVERDUE = "佐藤さんの返事がまだありません";
const DECLINED = "佐藤さんに断られました";
const ACTS = ["催促する", "取り消す", "別の人にする"];

const band = (p: Page, title: string) => bandsOf(p).locator(".k-band").filter({ hasText: title });
const confirm = (p: Page) => p.getByRole("alertdialog", { name: "渡しを取り消しますか？" });
const pickDialog = (p: Page) => p.getByRole("dialog", { name: "担当者を選ぶ" });
const passDialog = (p: Page) => p.getByRole("dialog", { name: "引き継いでもらう" });

/** 渡した人（高本・担当者）として、先頭の渡しを差し替えて開く */
async function asSender(page: Page, o: HOptions = {}) {
  // 既定の見ている人は高本＝担当者・会社を作った人（role_id null）・handover_kinds ["pass"]
  const r = await mockHandovers(page, { list: [hview()], ...o });
  r.h.on.preview = () => ok(preview());
  return r;
}

/** 本物の下見の口の形：待っている渡し（id・相手は佐藤）があれば blocked waiting と waiting を返す（K-401。replaces を知らない） */
const waitingPreview = (id: string) =>
  ok(
    preview({
      blocked: "waiting",
      waiting: {
        id,
        kind: "pass",
        from: { id: ME, name: "高本 聖斗" },
        to: { id: SATO, name: "佐藤 花子" },
        to_scope: null,
        reply_due: DUE,
      },
    }),
  );
/** 止まりの文の後ろ（名前の穴の無い所）と、名前を入れた全体（E-HND-004） */
const HND004_TAIL = msg("E-HND-004").slice(msg("E-HND-004").indexOf("。") + 1);
const HND004_SATO = msg("E-HND-004").replace("{名前}", "佐藤");
const suzukiItem = (p: Page) => pickDialog(p).locator(".k-hnd-pick-item").filter({ hasText: "鈴木 一郎" });

test("K413-UI-001 渡し中の帯のボタン：催促する・取り消す・別の人にする がこの順で、どれも押せる outlined", async ({
  page,
}) => {
  await asSender(page);
  await openDetail(page);
  const b = band(page, SENDING);
  const btns = b.locator(".k-band-acts button");
  await expect(btns).toHaveText(ACTS);
  for (let i = 0; i < 3; i++) {
    await expect(btns.nth(i)).not.toHaveAttribute("aria-disabled", "true");
    await expect(btns.nth(i)).toHaveAttribute("data-variant", "outlined");
  }
});

test("K413-UI-002 催促する：remind に 1 回と冪等の鍵・知らせ・帯は渡し中のまま", async ({ page }) => {
  const { h } = await asSender(page);
  await openDetail(page);
  await band(page, SENDING).getByRole("button", { name: "催促する" }).click();
  await expect(page.getByText("佐藤さんに催促しました（同じ渡しは 1 日 1 回まで）")).toBeVisible();
  expect(h.reminds).toEqual([HND]);
  await expect(band(page, SENDING)).toBeVisible();
});

test("K413-UI-003 催促は 1 日 1 回まで（口 409）：帯の中の alert に正本 E-HND-080 の文・帯はそのまま", async ({
  page,
}) => {
  const { h } = await asSender(page);
  h.on.remind = () => errReply(409, CODE.remindOnce);
  await openDetail(page);
  await band(page, SENDING).getByRole("button", { name: "催促する" }).click();
  await expect(bandsOf(page).getByRole("alert")).toContainText(firstSentence(CODE.remindOnce));
  await expect(band(page, SENDING)).toBeVisible();
});

test("K413-UI-004 取り消す確かめ：題・本文・やめる／取り消す・焦点はやめる。Esc で閉じて焦点は帯の取り消す・口に 0 回", async ({
  page,
}) => {
  const { h } = await asSender(page);
  await openDetail(page);
  const btn = band(page, SENDING).getByRole("button", { name: "取り消す" });
  await btn.click();
  const c = confirm(page);
  await expect(c).toBeVisible();
  await expect(c).toContainText(
    "佐藤さんへの渡しを取り消します。担当者はあなたのままです。佐藤さんに「取り消されました」と知らせます。",
  );
  await expect(c.getByRole("button", { name: "やめる" })).toBeFocused();
  await expect(c.getByRole("button", { name: "取り消す" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(c).toHaveCount(0);
  await expect(btn).toBeFocused();
  expect(h.withdraws).toEqual([]);
});

test("K413-UI-005 取り消す（正常）と再取得：withdraw に 1 回・帯と返事待ちが消える・開き直しても出ない", async ({
  page,
}) => {
  const { h } = await asSender(page);
  await openDetail(page);
  await expect(assigneeOf(page)).toContainText("→ 佐藤 花子（返事待ち）");
  await band(page, SENDING).getByRole("button", { name: "取り消す" }).click();
  await confirm(page).getByRole("button", { name: "取り消す" }).click();
  await expect(confirm(page)).toHaveCount(0);
  expect(h.withdraws).toEqual([HND]);
  await expect(band(page, SENDING)).toHaveCount(0);
  await expect(assigneeOf(page)).not.toContainText("返事待ち");
  await openDetail(page);
  await expect(band(page, SENDING)).toHaveCount(0);
});

test("K413-UI-006 もう答えが出ていた（相手が先に受けた・口 409）：確かめが閉じ、知らせに正本 E-HND-005 の文、読み直して帯が消える", async ({
  page,
}) => {
  const r = await asSender(page);
  r.h.on.withdraw = () => {
    r.h.list = [hview({ state: "accepted", decided_at: AT })];
    r.setAssignee(SATO);
    return errReply(409, CODE.decided, { 状態: "accepted" });
  };
  await openDetail(page);
  await band(page, SENDING).getByRole("button", { name: "取り消す" }).click();
  await confirm(page).getByRole("button", { name: "取り消す" }).click();
  await expect(confirm(page)).toHaveCount(0);
  await expect(page.getByText(firstSentence(CODE.decided))).toBeVisible();
  await expect(band(page, SENDING)).toHaveCount(0);
});

test("K413-UI-007 二度押し：答えを止めた間に 取り消す・催促する を 2 回ずつ押しても、それぞれ口に 1 回", async ({
  page,
}) => {
  const { h } = await asSender(page);
  await openDetail(page);
  let release = h.hold();
  const remind = band(page, SENDING).getByRole("button", { name: "催促する" });
  await remind.click();
  await expect.poll(() => h.reminds.length).toBe(1);
  await expect(remind).toBeDisabled();
  await remind.click({ force: true });
  release();
  await expect(page.getByText("佐藤さんに催促しました（同じ渡しは 1 日 1 回まで）")).toBeVisible();
  expect(h.reminds.length).toBe(1);
  release = h.hold();
  await band(page, SENDING).getByRole("button", { name: "取り消す" }).click();
  const yes = confirm(page).getByRole("button", { name: "取り消す" });
  await yes.click();
  await expect.poll(() => h.withdraws.length).toBe(1);
  await expect(yes).toBeDisabled();
  await yes.click({ force: true });
  release();
  await expect(confirm(page)).toHaveCount(0);
  expect(h.withdraws.length).toBe(1);
});

test("K413-UI-008 送れない（口 500）：催促は帯の中の alert、取り消すは確かめを閉じて帯の中の alert に E-PAGE-007 の 1 文目・帯はそのまま", async ({
  page,
}) => {
  const { h } = await asSender(page);
  const fail = () => ({ status: 500, body: { error: "internal", code: "INTERNAL" } });
  h.on.remind = fail;
  h.on.withdraw = fail;
  await openDetail(page);
  await band(page, SENDING).getByRole("button", { name: "催促する" }).click();
  await expect(bandsOf(page).getByRole("alert")).toContainText(firstSentence("E-PAGE-007"));
  await band(page, SENDING).getByRole("button", { name: "取り消す" }).click();
  await confirm(page).getByRole("button", { name: "取り消す" }).click();
  await expect(confirm(page)).toHaveCount(0);
  // 帯の中の知らせは 1 つ（新しい失敗が前の文を置き換える）
  await expect(bandsOf(page).getByRole("alert")).toHaveCount(1);
  await expect(bandsOf(page).getByRole("alert")).toContainText(firstSentence("E-PAGE-007"));
  await expect(band(page, SENDING)).toBeVisible();
});

test("K413-UI-009 返事が無い帯：題・要約・取り消す／別の人にする／催促する（主）・返事待ちは残る", async ({ page }) => {
  await asSender(page, { list: [hview({ overdue: true, reply_due: DUE_PAST })] });
  await openDetail(page);
  const b = band(page, OVERDUE);
  await expect(b).toBeVisible();
  await expect(b).toContainText("返事の期限 11/19（木）18:00 を過ぎました。佐藤さんは今からでも受ける・断るを押せます");
  await expect(b.locator(".k-band-acts button")).toHaveText(["取り消す", "別の人にする", "催促する"]);
  await expect(b.getByRole("button", { name: "催促する" })).toHaveAttribute("data-variant", "primary");
  await expect(assigneeOf(page)).toContainText("→ 佐藤 花子（返事待ち）");
});

test("K413-UI-010 期限の直前と直後：期限が過去でも overdue が false なら渡し中、期限が先でも overdue が true なら返事が無い（時計で決めない）", async ({
  page,
}) => {
  const r = await asSender(page, { list: [hview({ overdue: false, reply_due: DUE_PAST })] });
  await openDetail(page);
  await expect(band(page, SENDING)).toBeVisible();
  await expect(band(page, OVERDUE)).toHaveCount(0);
  r.h.list = [hview({ overdue: true, reply_due: DUE })];
  await openDetail(page);
  await expect(band(page, OVERDUE)).toBeVisible();
  await expect(band(page, SENDING)).toHaveCount(0);
});

test("K413-UI-011 返事が無い帯から催促・取り消す：remind に 1 回・確かめ → withdraw に 1 回", async ({ page }) => {
  const { h } = await asSender(page, { list: [hview({ overdue: true, reply_due: DUE_PAST })] });
  await openDetail(page);
  await band(page, OVERDUE).getByRole("button", { name: "催促する" }).click();
  await expect.poll(() => h.reminds.length).toBe(1);
  await band(page, OVERDUE).getByRole("button", { name: "取り消す" }).click();
  await confirm(page).getByRole("button", { name: "取り消す" }).click();
  await expect(confirm(page)).toHaveCount(0);
  expect(h.withdraws).toEqual([HND]);
});

test("K413-UI-012 断られた帯：題・要約・理由・閉じる／別の人にする（主）。担当者は高本 聖斗で返事待ちなし・▾ あり", async ({
  page,
}) => {
  await asSender(page, { list: [hview({ state: "declined", decided_at: AT, decline_reason: WHY })] });
  await openDetail(page);
  const b = band(page, DECLINED);
  await expect(b).toBeVisible();
  await expect(b).toContainText("11/20 10:12");
  await expect(b).toContainText(`理由：${WHY}`);
  await expect(b.locator(".k-band-acts button")).toHaveText(["閉じる", "別の人にする"]);
  await expect(b.getByRole("button", { name: "別の人にする" })).toHaveAttribute("data-variant", "primary");
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(assigneeOf(page)).not.toContainText("返事待ち");
  await expect(page.getByRole("button", { name: "担当者 高本 聖斗（担当者を変える）" })).toBeVisible();
});

test("K413-UI-013 断られた帯を閉じる：口に 0 回で消え、開き直しても出ない", async ({ page }) => {
  const { h } = await asSender(page, { list: [hview({ state: "declined", decided_at: AT, decline_reason: WHY })] });
  await openDetail(page);
  await band(page, DECLINED).getByRole("button", { name: "閉じる" }).click();
  await expect(band(page, DECLINED)).toHaveCount(0);
  await openDetail(page);
  await expect(assigneeOf(page)).toContainText("高本 聖斗");
  await expect(band(page, DECLINED)).toHaveCount(0);
  expect(h.withdraws.length + h.reminds.length + h.passes.length).toBe(0);
});

test("K413-UI-014 断られた後に別の人にする：鈴木に渡す・中身に replaces が無い・帯は鈴木さんの渡し中・断られた帯は出ない", async ({
  page,
}) => {
  const { h } = await asSender(page, { list: [hview({ state: "declined", decided_at: AT, decline_reason: WHY })] });
  await openDetail(page);
  await band(page, DECLINED).getByRole("button", { name: "別の人にする" }).click();
  await pickDialog(page).locator(".k-hnd-pick-item").filter({ hasText: "鈴木 一郎" }).click();
  await passDialog(page).locator("textarea").first().fill("営業の会議で話が出たため");
  await passDialog(page).getByRole("button", { name: "引き継いでもらう" }).click();
  await expect(passDialog(page)).toHaveCount(0);
  await expect.poll(() => h.passes.length).toBe(1);
  expect(h.passes[0]!.body.to_member_id).toBe(SUZUKI);
  expect(h.passes[0]!.body.replaces).toBeUndefined();
  await expect(band(page, "鈴木さんの返事を待っています（渡し中）")).toBeVisible();
  await expect(band(page, DECLINED)).toHaveCount(0);
});

test("K413-UI-015 渡し中に別の人にする：渡す口に 1 回で replaces が今の渡しの id・withdraw は呼ばない・帯と返事待ちが鈴木に替わる", async ({
  page,
}) => {
  const { h } = await asSender(page);
  // 本物の下見の口は、今待っている渡しを blocked waiting・waiting.id で返す（K-401）。replaces の渡し自身は止まりに数えない
  h.on.preview = () => waitingPreview(HND);
  await openDetail(page);
  await band(page, SENDING).getByRole("button", { name: "別の人にする" }).click();
  await expect(suzukiItem(page)).toBeVisible();
  // 止まりの文（E-HND-004 の後ろの文・名前の穴の無い所）が小窓に出ない
  await expect(pickDialog(page)).not.toContainText(HND004_TAIL);
  await suzukiItem(page).click();
  await passDialog(page).locator("textarea").first().fill("営業の会議で話が出たため");
  await passDialog(page).getByRole("button", { name: "引き継いでもらう" }).click();
  await expect(passDialog(page)).toHaveCount(0);
  expect(h.passes.map((x) => [x.body.to_member_id, x.body.replaces])).toEqual([[SUZUKI, HND]]);
  expect(h.withdraws).toEqual([]);
  await expect(band(page, "鈴木さんの返事を待っています（渡し中）")).toBeVisible();
  await expect(assigneeOf(page)).toContainText("→ 鈴木 一郎（返事待ち）");
});

test("K413-UI-019 返事が無い帯から別の人にする（下見は blocked waiting・waiting.id が今の渡し）：小窓は止まらず鈴木を選べ、渡す口に 1 回で replaces が今の渡しの id・withdraw は呼ばない", async ({
  page,
}) => {
  const { h } = await asSender(page, { list: [hview({ overdue: true, reply_due: DUE_PAST })] });
  h.on.preview = () => waitingPreview(HND);
  await openDetail(page);
  await band(page, OVERDUE).getByRole("button", { name: "別の人にする" }).click();
  await expect(suzukiItem(page)).toBeVisible();
  await expect(pickDialog(page)).not.toContainText(HND004_TAIL);
  await suzukiItem(page).click();
  await passDialog(page).locator("textarea").first().fill("営業の会議で話が出たため");
  await passDialog(page).getByRole("button", { name: "引き継いでもらう" }).click();
  await expect(passDialog(page)).toHaveCount(0);
  expect(h.passes.map((x) => [x.body.to_member_id, x.body.replaces])).toEqual([[SUZUKI, HND]]);
  expect(h.withdraws).toEqual([]);
});

for (const [label, list, title] of [
  [
    "(a) replaces の無い開き方（断られた帯）",
    [hview({ state: "declined", decided_at: AT, decline_reason: WHY })],
    DECLINED,
  ],
  ["(b) replaces は今の渡し・下見の waiting は別の渡し（渡し中の帯）", [hview()], SENDING],
] as const) {
  test(`K413-UI-020 別の渡しが待っているときは止める ${label}：小窓に名前つきの E-HND-004・鈴木の行は押せない・渡す口は 0 回`, async ({
    page,
  }) => {
    const { h } = await asSender(page, { list: [...list] });
    h.on.preview = () => waitingPreview(HND_OLD);
    await openDetail(page);
    await band(page, title).getByRole("button", { name: "別の人にする" }).click();
    await expect(pickDialog(page)).toContainText(HND004_SATO);
    await expect(suzukiItem(page)).toHaveAttribute("aria-disabled", "true");
    await expect(passDialog(page)).toHaveCount(0);
    expect(h.passes).toEqual([]);
  });
}

for (const [who, me, list] of [
  ["渡された人（佐藤）", SATO, [incoming()]],
  ["ほかの人（鈴木）", SUZUKI, [hview({ can: { answer: false, withdraw: false, remind: false, reassign: false } })]],
] as const) {
  test(`K413-UI-016 ほかの人にはボタンが出ない：${who} の詳細に 催促する・取り消す・別の人にする が 0 個`, async ({
    page,
  }) => {
    await mockHandovers(page, { me, role: "member", list: [...list] });
    await openDetail(page);
    await expect(assigneeOf(page)).toContainText("高本 聖斗");
    for (const a of ACTS) await expect(bandsOf(page).getByRole("button", { name: a })).toHaveCount(0);
  });
}

test("K413-UI-017 幅 375・768・1440：渡し中・返事が無い・断られた帯で横溢れ 0・ボタンは帯の中。取り消す確かめは画面の中", async ({
  page,
}) => {
  const r = await asSender(page);
  const bad: string[] = [];
  const cases = [
    [SENDING, hview()],
    [OVERDUE, hview({ overdue: true, reply_due: DUE_PAST })],
    [DECLINED, hview({ state: "declined", decided_at: AT, decline_reason: WHY })],
  ] as const;
  for (const w of [375, 768, 1440]) {
    for (const [title, v] of cases) {
      r.h.list = [v];
      await openDetail(page, w);
      const b = band(page, title);
      await expect(b).toBeVisible();
      const bb = await box(b);
      const btns = b.locator(".k-band-acts button");
      for (let i = 0; i < (await btns.count()); i++) {
        const x = await box(btns.nth(i));
        if (x.x + x.width > bb.x + bb.width + 0.5) bad.push(`幅 ${w}・${title}：ボタンが帯の外`);
      }
      const o = await overflowX(page);
      if (o !== 0) bad.push(`幅 ${w}・${title}：横溢れ ${o}px`);
    }
    r.h.list = [hview()];
    await openDetail(page, w);
    await band(page, SENDING).getByRole("button", { name: "取り消す" }).click();
    const c = await box(confirm(page));
    if (c.x < 0 || c.x + c.width > w + 0.5) bad.push(`幅 ${w}：確かめが画面の外`);
    await page.keyboard.press("Escape");
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

/** 本番をモックの状態にする手順（小さな知らせは役に入れないので、f8-reminded は催促を押した後の帯を比べる） */
const DRIVE: Record<string, (p: Page, w: number) => Promise<void>> = {
  "f8-waiting-sender": async (p, w) => {
    await asSender(p);
    await openDetail(p, w);
    await expect(band(p, SENDING)).toBeVisible();
  },
  "f8-reminded": async (p, w) => {
    await asSender(p);
    await openDetail(p, w);
    await band(p, SENDING).getByRole("button", { name: "催促する" }).click();
    await expect(p.getByText("佐藤さんに催促しました（同じ渡しは 1 日 1 回まで）")).toBeVisible();
  },
  "f8-withdraw": async (p, w) => {
    await asSender(p);
    await openDetail(p, w);
    await band(p, SENDING).getByRole("button", { name: "取り消す" }).click();
    await expect(confirm(p)).toBeVisible();
  },
  "f8-overdue": async (p, w) => {
    await asSender(p, { list: [hview({ overdue: true, reply_due: DUE_PAST })] });
    await openDetail(p, w);
    await expect(band(p, OVERDUE)).toBeVisible();
  },
  "f8-declined-sender": async (p, w) => {
    await asSender(p, { list: [hview({ state: "declined", decided_at: AT, decline_reason: WHY })] });
    await openDetail(p, w);
    await expect(band(p, DECLINED)).toBeVisible();
  },
};

for (const [id, go] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K413-UI-018 ${id} 幅 ${w}：帯・担当者の欄・取り消す確かめの値がモックと同じ（共通の道具 matchMock・役は HND_PAIRS）`, async ({
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
