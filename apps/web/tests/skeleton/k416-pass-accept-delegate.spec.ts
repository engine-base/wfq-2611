// K-416 中間テスト（段 9・M1）：引き継いでもらう（K-411）→ 承認待ちで受ける（K-412）→ 担当者と選んだ子が移る（K-404）→ 新しい担当者が AI に任せられる
//   （流れをまたぐ F8 → F5 の 1 行）を、本物のブラウザ 2 つ（渡す人・渡された人）・本物の DB・本物の口と、試験の PC でつなぐ。
//   中の 1 本 1 本の分岐は単体の試験（口：K-402〜K-405 の apps/api/test/features/F8・画面：K-411・K-412 の apps/web/tests/k）が持つ。
//   ここは「つないだときにだけ出るもの」を見る：渡す人の画面の操作が渡された人の承認待ちに並ぶか・受けると担当者と子が DB でそろって移り、
//   両方の画面がそれを出すか・知らせ（受け箱の行とメール）が決めた人にだけ届くか・新しい担当者の AI（押した人の PC）が動くか・
//   承認する人が新しい担当者に替わるか・渡し中に AI に任せたら受けられないか・開いたままの古い画面から二度は受けられないか。
//   口は網の手前で差し替えない（1 人目だけ届く頭 x-forwarded-for を足す）。2 人目は prep.ts の teammate を _lib/f8-flow.ts の mateOf で別のブラウザに持たせる。
//   PC は K-58 の試験の PC（_lib/test-pc.ts）・AI は決まった答え（_lib/f5-flow.ts の AI）。この PC の中だけの口（38617）は開かない。
//   メールは試験の受け箱（_lib/mailbox.ts）。固定の待ちは置かない（口の答え・画面・DB の値が変わるのを待つ）。
//   ★前提：CI の web の組の G59 と同じ（API を試験の受け箱へ・画面は BASE_URL）。
//   テストはチケットを切る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）
import { expect, test, type Page } from "@playwright/test";
import { admin } from "../_lib/api";
import { AI, approvalsOf, workOf, type Job, type PcWork } from "../_lib/f5-flow";
import {
  acceptInQueue,
  assigneeOf,
  bandOf,
  childOf,
  handoverBands,
  handoverNotesOf,
  handoversOf,
  mateOf,
  openQueue,
  openTicket,
  panelAssignee,
  passOnScreen,
  queueRow,
  san,
  shortOf,
  type Mate,
} from "../_lib/f8-flow";
import { Mailbox } from "../_lib/mailbox";
import { newcomer, ownIp, type Newcomer } from "../_lib/newcomer";
import { pairedPc, ticketOf } from "../_lib/prep";
import type { TestPc } from "../_lib/test-pc";

const box = new Mailbox();
test.beforeAll(() => box.open());
test.afterAll(() => box.close());
// 1 本の上限：登録（画面とメール）・2 人目の用意・画面の行き来が 1 本に 6〜10 回。CI の台は VM が同時に走るので 120 秒（K-64 と同じ考え）
test.describe.configure({ timeout: 120_000 });
test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await ownIp(context, 65);
});
const pcs: TestPc[] = [];
const mates: Mate[] = [];
test.afterEach(async () => {
  await Promise.all(pcs.splice(0).map((p) => p.close()));
  await Promise.all(mates.splice(0).map((m) => m.ctx.close()));
});

/** 文言（K-411・K-412 の仕様の表・モック /dev/mock/f8・決定 D-148.6・D-148.19・D-148.21 から。実装から書かない） */
const MSG = {
  waiting: "の返事を待っています（渡し中）", // 渡した人の帯（f8-waiting-sender）
  asked: "から、引き継いでほしいと頼まれています", // 渡された人の帯（f8-waiting-recipient）
  became: "担当者になりました", // 受けた人の帯（f8-accepted）
  taken: "が引き継ぎました", // 渡した人の帯（f8-taken-sender）
  aiBusy: "AI の実行（承認）が終わってから渡してください", // D-148.6（受けるときも同じ文）
  mail: /引き継ぎの頼みが届きました/, // 渡された人へのメールの件名（代表に聞くこと 18 の勧め・D-148.19）
  empty: "いま決めるものはありません", // K-63 の承認待ちの画面・空
} as const;
const SECTIONS = {
  purpose: "先方に出す見積のたたき台を作って送る",
  done: "先方が見積を受け取った",
  todo: "- 見積を作る\n- 先方に送る",
} as const;
const REASON = "先方と面識があるので、こちらから返したほうが早い";
const ASK = "今日中に一次返信だけお願いします";

interface Ready {
  me: Newcomer;
  mate: Mate;
  t: string;
  title: string;
}
async function ready(page: Page, browser: Parameters<typeof mateOf>[0], tag: string): Promise<Ready> {
  const me = await newcomer(page, box, tag);
  const mate = await mateOf(browser, me, `佐藤 ${tag}`);
  mates.push(mate);
  const title = `見積を送る 中間9 ${tag}`;
  const t = await ticketOf(page, me, title, SECTIONS);
  return { me, mate, t, title };
}
const delegateBtn = (page: Page) => page.getByRole("button", { name: "AI に任せる", exact: true });
async function takeSoon(w: PcWork, what: string): Promise<Job> {
  let job: Job | null = null;
  await expect.poll(async () => (job ??= await w.take()), what).not.toBeNull();
  return job!;
}

test("K416-M1-01 正常：渡す人が画面で引き継いでもらう（子 1 件も）→ 渡された人の承認待ちに並ぶ → 受ける → 担当者と子が移り、両方の画面と知らせがそろう", async ({
  page,
  browser,
}) => {
  const r = await ready(page, browser, "m1-01");
  const child = await childOf(page, r.me, r.t, `見積の内訳を作る 中間9 m1-01`, r.me.memberId, SECTIONS);
  // 渡す（1 人目の画面）
  await openTicket(page, r.t, r.title);
  expect(await passOnScreen(page, r.mate.name, { reason: REASON, ask: ASK, children: true }), "渡す口が受ける").toBe(
    201,
  );
  await expect(bandOf(page, new RegExp(MSG.waiting))).toContainText(shortOf(r.mate.name));
  await expect(panelAssignee(page), "受けるまで担当者は渡す人のまま（D-125.88）").toContainText(r.me.name);
  const [h] = await handoversOf(r.t);
  expect(h).toMatchObject({
    kind: "pass",
    state: "waiting",
    from_member_id: r.me.memberId,
    to_member_id: r.mate.memberId,
    reason: REASON,
  });
  expect(await assigneeOf(r.t)).toBe(r.me.memberId);
  // 渡された人：メール 1 通（理由とお願いは書かない）・受け箱の行・承認待ちの行・答える前の詳細
  const mail = await box.waitFor(r.mate.email, 1, MSG.mail);
  expect(mail.text, "メールに理由とお願いは書かない（D-148.19）").not.toContain(REASON);
  expect(mail.text).not.toContain(ASK);
  expect(await handoverNotesOf(r.mate.memberId, r.t), "渡された人の受け箱に 1 行").toHaveLength(1);
  await openTicket(r.mate.page, r.t, r.title);
  await expect(bandOf(r.mate.page, new RegExp(MSG.asked))).toContainText(REASON);
  await expect(panelAssignee(r.mate.page), "答える前の担当者は渡す人のまま（D-125.88）").toContainText(r.me.name);
  await openQueue(r.mate.page);
  await expect(queueRow(r.mate.page, r.title)).toContainText("渡された");
  // 受ける
  expect(await acceptInQueue(r.mate.page, r.title), "答える口が受ける").toBe(200);
  await expect(queueRow(r.mate.page, r.title)).toHaveCount(0);
  await expect.poll(() => assigneeOf(r.t), "担当者が渡された人に移る").toBe(r.mate.memberId);
  expect(await assigneeOf(child), "印を付けた子（渡す人が担当）も移る").toBe(r.mate.memberId);
  const [done] = await handoversOf(r.t);
  expect(done!.state).toBe("accepted");
  expect(done!.decided_at).not.toBeNull();
  // 両方の画面
  await openTicket(r.mate.page, r.t, r.title);
  await expect(bandOf(r.mate.page, new RegExp(MSG.became))).toBeVisible();
  await expect(panelAssignee(r.mate.page)).toContainText(r.mate.name);
  await openTicket(page, r.t, r.title);
  await expect(bandOf(page, new RegExp(`${san(r.mate.name).source}${MSG.taken}`))).toBeVisible();
  await expect(panelAssignee(page)).toContainText(r.mate.name);
  await openTicket(page, r.t, r.title);
  await expect(handoverBands(page), "「引き継ぎました」は 1 回だけ（D-148.35）").toHaveCount(0);
  // 知らせ：渡した人には受け箱の行だけ（受けてもらえたはメールを出さない・D-148.19）
  expect(await handoverNotesOf(r.me.memberId, r.t)).toHaveLength(1);
  expect(box.mails(r.me.email, /引き継/), "渡した人にメールは出ない").toHaveLength(0);
});

test("K416-M1-02 F8 → F5：受けた新しい担当者が AI に任せられ、仕事は押した人（新しい担当者）の PC に届く。作り終えると承認する人は新しい担当者になり、前の担当者の承認待ちは空（D-128.138・D-128.25）", async ({
  page,
  browser,
}) => {
  const r = await ready(page, browser, "m1-02");
  await openTicket(page, r.t, r.title);
  expect(await passOnScreen(page, r.mate.name, { reason: REASON })).toBe(201);
  await openQueue(r.mate.page);
  expect(await acceptInQueue(r.mate.page, r.title)).toBe(200);
  await expect.poll(() => assigneeOf(r.t)).toBe(r.mate.memberId);
  // 新しい担当者の PC をつなぎ、画面で任せる
  const pc = await pairedPc(r.mate.page, r.mate.token, `中間9 の MacBook (m1-02)`);
  pcs.push(pc);
  const w = workOf(pc);
  await openTicket(r.mate.page, r.t, r.title);
  await delegateBtn(r.mate.page).click();
  const job = await takeSoon(w, "任せた仕事は新しい担当者の PC に渡る（D-125.156）");
  expect(job).toMatchObject({ kind: "ticket", ticket_id: r.t, phase: "make" });
  const [owner] = await admin<{ member_id: string }>("select member_id from bridge_jobs where id = $1", [job.job_id]);
  expect(owner?.member_id, "仕事の持ち主は押した人（新しい担当者）").toBe(r.mate.memberId);
  // 作り終えたら、承認する人は新しい担当者
  expect((await w.finish(job.job_id, { state: "done", result: AI.made })).outcome).toBe("awaiting_approval");
  const [a] = await approvalsOf(r.t);
  expect(a!.approver_member_id, "承認する人が新しい担当者に替わる").toBe(r.mate.memberId);
  await openQueue(r.mate.page);
  await expect(r.mate.page.getByRole("link", { name: r.title })).toBeVisible();
  await openQueue(page);
  await expect(page.getByText(MSG.empty)).toBeVisible();
});

test("K416-M1-03 一緒に移す印を外して渡す → 受けても子は渡す人のまま（担当者だけが移る）", async ({
  page,
  browser,
}) => {
  const r = await ready(page, browser, "m1-03");
  const child = await childOf(page, r.me, r.t, `見積の内訳を作る 中間9 m1-03`, r.me.memberId, SECTIONS);
  await openTicket(page, r.t, r.title);
  expect(await passOnScreen(page, r.mate.name, { reason: REASON, children: false })).toBe(201);
  await openQueue(r.mate.page);
  expect(await acceptInQueue(r.mate.page, r.title)).toBe(200);
  await expect.poll(() => assigneeOf(r.t)).toBe(r.mate.memberId);
  expect(await assigneeOf(child), "印を外した子は移らない").toBe(r.me.memberId);
});

test("K416-M1-04 ほかの人が担当の子はそのまま：小窓は「子チケット 1 件も渡す（ほかの人の 1 件はそのまま）」と出し、受けると自分の子だけが移る（D-148.11）", async ({
  page,
  browser,
}) => {
  const r = await ready(page, browser, "m1-04");
  const third = await mateOf(browser, r.me, "田中 m1-04");
  mates.push(third);
  const mine = await childOf(page, r.me, r.t, `見積の内訳を作る 中間9 m1-04`, r.me.memberId, SECTIONS);
  const theirs = await childOf(page, r.me, r.t, `見積の宛名を確かめる 中間9 m1-04`, third.memberId, SECTIONS);
  await openTicket(page, r.t, r.title);
  await page.getByRole("button", { name: /^担当者 .+（担当者を変える）$/ }).click();
  await page
    .getByRole("dialog", { name: "担当者を選ぶ" })
    .getByRole("button", { name: new RegExp(`^${r.mate.name}`) })
    .click();
  await expect(
    page.getByRole("dialog", { name: "引き継いでもらう" }).getByRole("checkbox", { name: /^子チケット/ }),
  ).toHaveAccessibleName("子チケット 1 件も渡す（ほかの人の 1 件はそのまま）");
  await page
    .getByRole("dialog", { name: "引き継いでもらう" })
    .getByRole("button", { name: "やめる", exact: true })
    .click();
  expect(await passOnScreen(page, r.mate.name, { reason: REASON, children: true })).toBe(201);
  await openQueue(r.mate.page);
  expect(await acceptInQueue(r.mate.page, r.title)).toBe(200);
  await expect.poll(() => assigneeOf(mine)).toBe(r.mate.memberId);
  expect(await assigneeOf(theirs), "ほかの人が担当の子はそのまま").toBe(third.memberId);
});

test("K416-M1-05 渡し中に渡す人が AI に任せた → 渡された人が受けると「AI の実行（承認）が終わってから渡してください」・渡しは待ったまま・担当者は渡す人のまま（D-148.5・D-148.6）", async ({
  page,
  browser,
}) => {
  const r = await ready(page, browser, "m1-05");
  const pc = await pairedPc(page, r.me.token, `中間9 の MacBook (m1-05)`);
  pcs.push(pc);
  await openTicket(page, r.t, r.title);
  expect(await passOnScreen(page, r.mate.name, { reason: REASON })).toBe(201);
  await openTicket(page, r.t, r.title);
  await delegateBtn(page).click(); // 渡し中も渡した人は全部できる（D-148.5）
  await takeSoon(workOf(pc), "渡し中でも渡す人の AI が動く");
  await openQueue(r.mate.page);
  expect(await acceptInQueue(r.mate.page, r.title), "受けられない").toBe(409);
  await expect(r.mate.page.getByRole("alert").filter({ hasText: MSG.aiBusy })).toBeVisible();
  const [h] = await handoversOf(r.t);
  expect(h!.state).toBe("waiting");
  expect(await assigneeOf(r.t)).toBe(r.me.memberId);
});

test("K416-M1-06 操作の揺れ：渡された人が詳細の帯と承認待ちを 2 つのタブで開き、承認待ちで受けた後に古い帯の「受ける」を押す → 口は断り（409・E-HND-005）、読み直した後に帯が「担当者になりました」に替わり、渡しの行も担当者も 1 回目のまま", async ({
  page,
  browser,
}) => {
  const r = await ready(page, browser, "m1-06");
  await openTicket(page, r.t, r.title);
  expect(await passOnScreen(page, r.mate.name, { reason: REASON })).toBe(201);
  const tabB = await r.mate.ctx.newPage();
  await openTicket(tabB, r.t, r.title);
  await expect(bandOf(tabB, new RegExp(MSG.asked))).toBeVisible();
  await openQueue(r.mate.page);
  expect(await acceptInQueue(r.mate.page, r.title)).toBe(200);
  const [first] = await handoversOf(r.t);
  const res = tabB.waitForResponse((x) => x.request().method() === "PATCH" && /\/ticket_handovers\//.test(x.url()));
  await bandOf(tabB, new RegExp(MSG.asked)).getByRole("button", { name: "受ける", exact: true }).click();
  expect((await res).status(), "二度は受けない").toBe(409);
  await expect(bandOf(tabB, new RegExp(MSG.became)), "読み直した後、古い帯は受けた帯に替わる").toBeVisible();
  const [after] = await handoversOf(r.t);
  expect(after, "渡しの行は 1 回目のまま").toEqual(first);
  expect(await handoversOf(r.t)).toHaveLength(1);
  expect(await assigneeOf(r.t)).toBe(r.mate.memberId);
});
