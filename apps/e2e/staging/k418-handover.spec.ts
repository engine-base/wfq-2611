// K-418 統合テスト（段 9・F8）：人を招く（K-420）→ 引き継いでもらう（K-411）→ 受ける（K-412）と、配る（人・グループ・K-415）→ グループの人が持つ を、
//   staging（本番と同じ形・D-128.144）の上で端から端まで通す。中の分岐は単体（K-401〜K-415）と中間テスト（K-416・K-417）が開発の環境で持つ。ここで見るのは 2 つだけ：
//   ① 招く → 参加する → 渡す → 受ける／配る → 持つ が、本物のメールと別の住所の口の上で 2〜3 人のブラウザでつながること
//   ② staging でしか出ないもの（招待と渡しの本物のメールの到達・口と画面が別の住所で 2 人目以降のログインの印が通る・接続の束ね役ごしの会社の分け）。
//   流れるのは main から手で起こす staging-e2e.yml の回だけ（K-204・K-65 と同じ）。「できた」はその回の JUnit の記録で決める。チケットの CI（枝）では流れない。
//   ★試験のための抜け道を作らない：page.route を使わない・製品に試験用の分かれ道を足さない・DB は読みも書きもしない（確かめは画面・同じブラウザからの口の読み直し・
//     Resend の記録だけ）・固定の待ちを置かない。★記録に出さない：住所・宛先・確認と招待のリンク・鍵・パスワード・認証アプリの鍵（_lib/scrub-reporter.ts が伏せ直す）。
//   人は steps.ts の person（宛先は Resend の試験用・名前に「統合テスト」・その回のパスワード）。2 段階は画面で付ける（_lib/handover-steps.ts の throughTwoFactor）。
//   試験が作った人・会社・チケットは staging に残す（名前に「統合テスト」）。1 回の通しで登録 2 人・招待で参加 3 人・メールは 8 通前後（無料の枠は 1 日 100 通）。
//   行 ID（K418-STG-NN）を試験の名前の頭に持つ。03（期限切れ）と 04（外のサービスが落ちる）は staging では作れないので試験を持たない（チケットの judge-skip）。
//   テストはチケットを切る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。直すのは道具（_lib）と設定の側
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  answerInQueue,
  bandOf,
  createTicketFor,
  distributeOnScreen,
  enterWithTwoFactor,
  inviteLink,
  inviteOnScreen,
  joinByInvite,
  nthMailTo,
  openQueue,
  openTicket,
  passOnScreen,
  queueRow,
} from "./_lib/handover-steps";
import { countTo, verifyLink } from "./_lib/resend";
import { person, readAs, submitSignup, type Person } from "./_lib/steps";

/** 文言（K-411・K-412・K-415・K-420 の仕様の表・モック /dev/mock/f8・決定 D-148.19・D-148.30 から。実装から書かない） */
const MSG = {
  waiting: "の返事を待っています（渡し中）",
  asked: "から、引き継いでほしいと頼まれています",
  became: "担当者になりました",
  taken: "が引き継ぎました",
  distributed: "から配られました",
  groupWaiting: /^グループ「.+」に配り中$/,
  passMail: /引き継ぎの頼みが届きました/, // 代表に聞くこと 18 の勧め（D-148.19）
  notFound: "見つかりませんでした。消されたか、見る権限が無いかもしれません", // E-PAGE-001
} as const;
const REASON = "先方と面識があるので、こちらから返したほうが早い";
const short = (p: Person): string => p.name.split(/[\s\u3000]/)[0] ?? p.name;
/** 会社の分けを見るため、01 のチケットの id を 02 に渡す（同じ働き手の中だけ・書き出さない） */
const shared: { ticketOf01: string | null } = { ticketOf01: null };

/** 登録の画面 → Resend の記録の確認のメールのリンク →（2 段階）→ /tickets */
async function signUp(page: Page, p: Person): Promise<void> {
  expect(await submitSignup(page, p), "登録の口が受ける").toBe(201);
  const link = verifyLink(await nthMailTo(p.email, 1));
  expect(link, "確認のメールにリンクがある").not.toBeNull();
  await enterWithTwoFactor(page, link!, p);
}
/** 招く人の画面で招き、Resend の記録の招待のメールのリンクから、別のブラウザで参加させる */
async function invited(browser: Browser, owner: Page, p: Person, role: "メンバー" | "マネージャー"): Promise<Page> {
  await inviteOnScreen(owner, p.email, role);
  const mail = await nthMailTo(p.email, 1);
  const link = inviteLink(mail);
  expect(link, "招待のメールに招待のリンクがある").not.toBeNull();
  const page = await (await browser.newContext()).newPage();
  await joinByInvite(page, link!, p);
  return page;
}
/** 口の読み直し：チケットの担当者の名前 */
const assigneeName = async (page: Page, id: string): Promise<string | null> => {
  const r = await readAs(page, `/tickets/${id}`);
  const d = r.data as { assignee?: { display_name?: string } | null } | null;
  return d?.assignee?.display_name ?? null;
};

test("K418-STG-01 招く → 参加する → 引き継いでもらう → 受ける：本物のメールで招いた 2 人目に、画面で渡し、2 人目が承認待ちで受けて担当者になる", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const a = person("k418-01a");
  const b = person("k418-01b");
  await signUp(page, a);
  const pb = await invited(browser, page, b, "メンバー");
  const title = `見積を送る 統合テスト k418-01`;
  const id = await createTicketFor(page, title, a.name, "先方に出す見積のたたき台を作って送る");
  shared.ticketOf01 = id;
  expect(await passOnScreen(page, b.name, REASON), "渡す口が受ける").toBe(201);
  await expect(bandOf(page, new RegExp(MSG.waiting))).toContainText(short(b));
  const mail = await nthMailTo(b.email, 2);
  expect(mail.subject, "渡しのメールが本当に届く").toMatch(MSG.passMail);
  expect(mail.text, "メールに理由を書かない（D-148.19）").not.toContain(REASON);
  expect(mail.lastEvent ?? "", "送れなかったにならない").not.toMatch(/bounced|failed/);
  await openTicket(pb, id, title);
  await expect(bandOf(pb, new RegExp(MSG.asked))).toContainText(REASON);
  await openQueue(pb);
  expect(await answerInQueue(pb, title, "受ける"), "答える口が受ける").toBe(200);
  await expect(queueRow(pb, title)).toHaveCount(0);
  await openTicket(pb, id, title);
  await expect(bandOf(pb, new RegExp(MSG.became))).toBeVisible();
  await expect.poll(() => assigneeName(pb, id), "口の読み直しで担当者が 2 人目").toBe(b.name);
  await openTicket(page, id, title);
  await expect(bandOf(page, new RegExp(MSG.taken))).toContainText(short(b));
  expect(await countTo(a.email), "渡した人に受けてもらえたのメールは出ない（確認と登録完了の 2 通のまま）").toBe(2);
  await pb.context().close();
});

test("K418-STG-02 配る：管理者が、招いたメンバーのチケットを招いたマネージャーへ配る（すぐ担当者が替わり本物のメールが届く）→ 別のチケットをグループに配る → マネージャーが承認待ちで「自分が持つ」。ほかの会社の人のチケットは読めない", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const a = person("k418-02a");
  const b = person("k418-02b");
  const c = person("k418-02c");
  await signUp(page, a);
  const pb = await invited(browser, page, b, "メンバー");
  const pc = await invited(browser, page, c, "マネージャー");
  // 人へ配る
  const t1 = `礼状を送る 統合テスト k418-02 人`;
  const id1 = await createTicketFor(page, t1, b.name, "展示会の来場者に礼状を送る");
  await openTicket(page, id1, t1);
  expect(await distributeOnScreen(page, c.name, "来週の展示会の準備を優先してもらうため"), "配る口が受ける").toBe(201);
  await expect.poll(() => assigneeName(page, id1), "合意なしですぐ担当者が替わる（D-148.16）").toBe(c.name);
  const mail = await nthMailTo(c.email, 2);
  expect(mail.subject.length, "配られたのメールが届く（件名は口の葉が決める）").toBeGreaterThan(0);
  expect(mail.lastEvent ?? "").not.toMatch(/bounced|failed/);
  await openTicket(pc, id1, t1);
  await expect(bandOf(pc, new RegExp(MSG.distributed))).toContainText(short(a));
  // グループへ配る → マネージャーが持つ
  const t2 = `礼状の宛名を確かめる 統合テスト k418-02 グループ`;
  const id2 = await createTicketFor(page, t2, b.name, "礼状の宛名の一覧を確かめる");
  await openTicket(page, id2, t2);
  expect(
    await distributeOnScreen(page, "group", "宛名の確かめはグループで見てほしい"),
    "グループへ配る口が受ける",
  ).toBe(201);
  await expect(bandOf(page, MSG.groupWaiting)).toBeVisible();
  await openQueue(pc);
  expect(await answerInQueue(pc, t2, "自分が持つ"), "持つ口が受ける").toBeLessThan(300);
  await expect(queueRow(pc, t2)).toHaveCount(0);
  await expect.poll(() => assigneeName(pc, id2), "持った人が担当者").toBe(c.name);
  // 会社の分け（接続の束ね役ごし）：01 の会社のチケットは、この会社の人から見えない
  expect(shared.ticketOf01, "01 が先に通ってチケットを作っている").not.toBeNull();
  const other = await readAs(page, `/tickets/${shared.ticketOf01}`);
  expect([403, 404], "ほかの会社のチケットは読めない").toContain(other.status);
  expect(JSON.stringify(other.data ?? null)).not.toContain("k418-01");
  await page.goto(`/tickets/${shared.ticketOf01}`);
  await expect(page.getByText(MSG.notFound)).toBeVisible();
  await pb.context().close();
  await pc.context().close();
});
