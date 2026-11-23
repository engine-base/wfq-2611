// K-393「やり取りに書き込む（書く欄・@ の候補・知らせる人・引用・送れなかった・二度押し・書きかけを残す）」の画面の試験（実 Chrome・実装より先に積む）。
//   正のモック：/dev/mock/f6/talk-compose・talk-send・talk-cannot（本番と同じ部品 features/F6/thread/views.tsx の Composer）。
//   詳細は前からの土台で開き、やり取りの口は共通の道具 thread-mock.ts（K-392 が持つ・読むだけで使う）で差し替える。
//   書く口の入力と答えの形は口の葉 K-385（createTicketMessage）の md に合わせた。固定の待ちは使わない（答えを hold() で止める）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）
import { expect, test, type Page } from "@playwright/test";
import { CATALOG as ENTRIES } from "../../../../packages/errors/src/catalog";
import { countWrites, expectInert } from "./kit";
import { MATCH_WIDTHS, matchMock } from "./stage2-match";
import {
  COMPOSE_PAIRS,
  CREATED,
  KEN,
  ME,
  MOCK_BASE,
  OUTSIDER,
  P_TAKA_ID,
  PEOPLE,
  SATO,
  SUZU,
  TICKET,
  box,
  cssOf,
  err,
  feed,
  meta,
  mockThread,
  openThread,
  overflowX,
  pair,
  panel,
  post,
  postOf,
  SUZU_W,
  TAKA_W,
} from "./thread-mock";

test.use({ timezoneId: "Asia/Tokyo" });

/** 正本の文（生成物 packages/errors/src/catalog.ts・07_qa/test-specs/errors.json から作る）。試験はファイルを読まずに import する */
const CATALOG: Record<string, string> = Object.fromEntries(Object.values(ENTRIES).map((e) => [e.id, e.message]));
const FAILED = "送れませんでした。もう一度お試しください（書いた字は残っています）";
/** 404 E-PAGE-001（選べない人・引用元）の部品の字（K-385 の申し送り・どの欄かは言えない） */
const UNPICKABLE = "選べない人がいます。選び直してください（書いた字は残っています）";
const DRAFT_KEY = `kaname.thread.draft.${TICKET}`;
const send = (page: Page) => panel(page).getByRole("button", { name: /^(書き込む|送っています…)$/ });
const notifyList = (page: Page) => panel(page).getByRole("list", { name: "知らせる人" });
const candidates = (page: Page) =>
  panel(page).getByRole("listbox", { name: "呼べる人（このチケットを見られる人だけ）" });
const composerAlert = (page: Page) => panel(page).locator(".k-talk-composer").getByRole("alert");

// ---------------------------------------------------------------- モックと本番の突き合わせ
/** matchMock がモックを開く画面の大きさ（stage2-match.ts と同じ）。openThread（土台の openTicket）は高さを 1000 にするので、比べる前に戻す
 *  （書く欄はパネルの下に付くので、高さが違うとパネルの上端からの y がずれる） */
const matchViewport = (page: Page, w: number) => page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
const DRIVE: Record<string, (page: Page, w: number) => Promise<void>> = {
  "talk-compose": async (page, w) => {
    await mockThread(page, { items: [CREATED()] });
    await openThread(page, w);
    await matchViewport(page, w);
    await box(page).fill("了解です。@鈴");
    await expect(candidates(page)).toBeVisible();
    // モックは打つ所に焦点が無い（箱の線は焦点の色でない）。候補は字と打つ所で決まるので、焦点を外しても開いたまま
    await box(page).blur();
    await expect(candidates(page)).toBeVisible();
  },
  "talk-send": async (page, w) => {
    const t = await mockThread(page, { items: [CREATED()] });
    t.on.post = () => err(503, "SERVICE_UNAVAILABLE");
    await openThread(page, w);
    await matchViewport(page, w);
    await box(page).fill("了解です。10/19 分を外して今日中に送ります");
    await send(page).click();
    await expect(composerAlert(page)).toContainText(FAILED);
  },
  "talk-cannot": async (page, w) => {
    await mockThread(page, { band: { stage: "done", completed: { at: "2026-11-02T06:30:00Z", by: "高本 聖斗" } } });
    await openThread(page, w);
    await matchViewport(page, w);
  },
};
/** 道具の並びの比べ方：talk-compose・talk-send のモックは状態 ▾ が押せる形（K-396 の後の形・12px）。この葉は押せない形（K-382 の「まだ」の形）なので、
 *  状態 ▾ を除いた担当 ▾ と 📎 の y・字・大きさを比べる（x は状態 ▾ の幅で動く。状態 ▾ の形と x は K-396 の突き合わせが見る）。talk-cannot はどちらも押せない形なのでそのまま */
const TOOLS_WITHOUT_STAGE = pair(
  "talk-tools",
  'aside.k-detail-panel .k-talk-tools button[aria-label$="（まだ使えません）"]',
  ["y", "font-size", "texts"],
);
const pairsOf = (id: string) =>
  id === "talk-cannot" ? COMPOSE_PAIRS : COMPOSE_PAIRS.map((p) => (p.name === "talk-tools" ? TOOLS_WITHOUT_STAGE : p));
for (const [id, drive] of Object.entries(DRIVE)) {
  for (const w of MATCH_WIDTHS) {
    test(`K393-UI-001 ${id} 幅 ${w}：書く欄（箱・打つ所・道具・@ の候補・知らせる人・書き込む・失敗の知らせ・補足）の値がモックと同じ`, async ({
      browser,
    }) => {
      const { rows, bad } = await matchMock(browser, id, w, (page) => drive(page, w), {
        pairs: pairsOf(id),
        base: MOCK_BASE,
      });
      expect(new Set(rows.map((r) => r.part)), "書く欄で比べた").toContain("talk-box");
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
}

// ---------------------------------------------------------------- 書く欄の形

for (const w of [375, 768, 1440]) {
  test(`K393-UI-002 幅 ${w}：書く欄は 1 行の高さから・打った字は ${w <= 767 ? "16px" : "13px"}・薄い案内の字はどの幅も 13px。知らせる人は最初から担当者と承認する人（自分は入れない）。担当 ▾ と 📎 は押せない形・補足の字`, async ({
    page,
  }) => {
    await mockThread(page);
    const writes = countWrites(page);
    await openThread(page, w);
    await expect(box(page)).toHaveAttribute("placeholder", "書き込む（@ で人を呼べます）");
    expect(await cssOf(box(page), "font-size")).toBe(w <= 767 ? "16px" : "13px");
    // 薄い案内の字：getComputedStyle の ::placeholder は前例が無く値が返る保証が無いので、ページに効いている CSS の規則を読む
    //   （この幅で効く @media の中も含め、打つ所に当たる ::placeholder の規則のうち最後の font-size。var() はその場の値に直す）
    const ph = await box(page).evaluate((el) => {
      const sizes: string[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const r of Array.from(rules)) {
          if (r instanceof CSSMediaRule) {
            if (matchMedia(r.conditionText).matches) walk(r.cssRules);
          } else if (r instanceof CSSGroupingRule) walk(r.cssRules);
          else if (r instanceof CSSStyleRule && r.selectorText.includes("::placeholder") && r.style.fontSize) {
            const sels = r.selectorText
              .split(",")
              .filter((x) => x.includes("::placeholder"))
              .map((x) => x.replace(/::placeholder/g, "").trim());
            if (sels.some((x) => el.matches(x))) sizes.push(r.style.fontSize);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
      const last = sizes.at(-1) ?? "";
      const v = last.match(/^var\((--[\w-]+)\)$/);
      return v ? getComputedStyle(el).getPropertyValue(v[1]!).trim() : last;
    });
    expect(ph, "打つ所に当たる ::placeholder の font-size の規則").toBe("13px");
    // 箱の高さから上下の余白を引いた中身の高さが 2 行分より低い（K-382 の thread.css の min-height は余白込み 40px・行の高さは 13px で 19.5px）
    const lh = Number.parseFloat(await cssOf(box(page), "line-height"));
    const pad =
      Number.parseFloat(await cssOf(box(page), "padding-top")) +
      Number.parseFloat(await cssOf(box(page), "padding-bottom"));
    const h = (await box(page).boundingBox())!.height;
    expect(h - pad, "1 行の高さ（中身は 2 行分より低い）").toBeLessThan(lh * 2);
    await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveText([/鈴木/, /佐藤/]);
    await expect(notifyList(page)).not.toContainText("高本");
    await expectInert(
      page,
      panel(page).getByRole("button", { name: "担当 変えない（まだ使えません）" }),
      "担当 ▾",
      writes,
    );
    await expectInert(
      page,
      panel(page).getByRole("button", { name: "ファイルを添える（まだ使えません）" }),
      "📎",
      writes,
    );
    await expect(panel(page).locator(".k-talk-composer > p.k-talk-sub")).toHaveText(
      "状態を変えると、この書き込みと一緒に残る ・ @ で呼ぶ",
    );
  });
}

// ---------------------------------------------------------------- 書き込む

test("K393-UI-003 手順 S1：書いて「書き込む」→ POST /tickets/:id/messages（本文・@ の人・知らせる人・引用元の 4 つだけ・冪等キー）。答えの行が一覧のいちばん下に足され（読み直さない）、打つ所は空・知らせる人は最初の 2 人に戻る", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await notifyList(page).getByRole("button", { name: "佐藤 を外す" }).click();
  await box(page).fill("了解です。今日中に送ります");
  await send(page).click();
  await expect(postOf(page, "高本 聖斗", "11:02")).toBeVisible();
  expect(t.posts).toHaveLength(1);
  expect(t.posts[0]!.body).toEqual({
    body: "了解です。今日中に送ります",
    mention_member_ids: [],
    notify_member_ids: [SUZU],
    quote_of_id: null,
  });
  expect(t.posts[0]!.key, "冪等キー").toBeTruthy();
  await expect(feed(page).getByRole("article").last()).toHaveAttribute("aria-label", "高本 聖斗 11:02");
  await expect(postOf(page, "高本 聖斗", "11:02")).toContainText("知らせた：鈴木・佐藤");
  await expect(box(page)).toHaveValue("");
  await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveText([/鈴木/, /佐藤/]);
  expect(t.reads, "書いた後に読み直さない").toHaveLength(1);
});

test("K393-UI-004 二度押し：送っている間は「送っています…」で押せない。押し直し・Enter でも口は 1 回", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await box(page).fill("了解です");
  const open = t.hold();
  await send(page).click();
  await expect(send(page)).toHaveText("送っています…");
  await expect(send(page)).toBeDisabled();
  await send(page).click({ force: true });
  await send(page).press("Enter");
  expect(t.posts).toHaveLength(1);
  open();
  await expect(postOf(page, "高本 聖斗", "11:02")).toBeVisible();
  expect(t.posts).toHaveLength(1);
});

for (const [label, kind] of [
  ["503", "503"],
  ["網の切れ", "abort"],
] as const) {
  test(`K393-UI-005 手順 S1 の失敗（${label}）：「${FAILED}」・書いた字と知らせる人は残る。押し直すと同じ冪等キーで送り、届いたら知らせは消える`, async ({
    page,
  }) => {
    const t = await mockThread(page);
    await openThread(page);
    if (kind === "abort")
      await page.route(new RegExp(`/api/v1/tickets/${TICKET}/messages$`), (route) => route.abort("failed"), {
        times: 1,
      });
    else t.on.post = () => err(503, "SERVICE_UNAVAILABLE");
    await box(page).fill("了解です。10/19 分を外して今日中に送ります");
    await send(page).click();
    await expect(composerAlert(page)).toContainText(FAILED);
    await expect(box(page)).toHaveValue("了解です。10/19 分を外して今日中に送ります");
    await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveCount(2);
    const firstKey = t.posts[0]?.key;
    t.on.post = (b) => ({ status: 201, body: { data: post(TAKA_W, "2025-11-01 11:02", String(b["body"])) } });
    await send(page).click();
    await expect(postOf(page, "高本 聖斗", "11:02")).toBeVisible();
    await expect(composerAlert(page)).toHaveCount(0);
    if (firstKey) expect(t.posts.at(-1)!.key, "同じ冪等キー").toBe(firstKey);
  });
}

for (const [status, code, shown] of [
  [403, "E-PAGE-002", "E-PAGE-002"],
  // チケットが無い・見えない・消した（K-385 の 404 NOT_FOUND）。正本に無い番号なので、答えの種類で E-PAGE-001 の文（errorCodeOf）
  [404, "NOT_FOUND", "E-PAGE-001"],
  // 409 は段を一緒に変えたとき（K-389 の E-CONF-030・K-396）に出る。この葉の時点の正本に在る 409 の番号で、扱いの形（正本の文・字は残る・reset しない）だけを見る。
  //   409 のときに読み直しの afterPost を呼ぶことは、afterPost に中身が入る K-396 の K396-UI-008 が見る（この葉の afterPost は何もしない形）
  [409, "E-CONF-019", "E-CONF-019"],
] as const) {
  test(`K393-UI-006 手順 S1 の失敗（${status} ${code}）：正本の文（${shown}）を書く欄の上に出し、書いた字は残る`, async ({
    page,
  }) => {
    const t = await mockThread(page);
    t.on.post = () => err(status, code);
    await openThread(page);
    await box(page).fill("了解です");
    await send(page).click();
    await expect(composerAlert(page)).toContainText(CATALOG[shown]!);
    await expect(box(page)).toHaveValue("了解です");
  });
}
test("K393-UI-006 手順 S1 の失敗（404 E-PAGE-001＝選べない人・引用元・K-385 の申し送り）：「選べない人がいます」を書く欄の上に出し、読む口を 1 回読み直して候補と知らせる人から見られなくなった人を外す。書いた字は残る", async ({
  page,
}) => {
  const t = await mockThread(page);
  t.on.post = () => err(404, "E-PAGE-001");
  await openThread(page);
  await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveText([/鈴木/, /佐藤/]);
  // 書いている間に佐藤が抜けた：読み直した答えの meta.people に佐藤が居ない
  t.on.timeline = () => ({
    status: 200,
    body: { data: [CREATED()], meta: meta({ post_count: 0, people: PEOPLE.filter((p) => p.member_id !== SATO) }) },
  });
  await box(page).fill("了解です");
  await send(page).click();
  await expect(composerAlert(page)).toContainText(UNPICKABLE);
  await expect(composerAlert(page)).not.toContainText(CATALOG["E-PAGE-001"]!);
  await expect.poll(() => t.reads.length, "読む口を 1 回読み直す").toBe(2);
  await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveText([/鈴木/]);
  await expect(box(page)).toHaveValue("了解です");
  expect(t.posts, "勝手に送り直さない").toHaveLength(1);
});
test("K393-UI-006 手順 S1 の失敗（422 E-VAL-027）：口の項目の理由（本文）を出し、書いた字は残る（選べない人・引用元は 404 E-PAGE-001＝上の 404 の行・K-385）", async ({
  page,
}) => {
  const t = await mockThread(page);
  t.on.post = () => ({
    status: 422,
    body: {
      error: "invalid",
      code: "E-VAL-027",
      details: [{ field: "body", message: "書き込む文を書いてください" }],
    },
  });
  await openThread(page);
  await box(page).fill("了解です");
  await send(page).click();
  await expect(composerAlert(page)).toContainText("書き込む文を書いてください");
  await expect(box(page)).toHaveValue("了解です");
});

test("K393-UI-007 手順 S1 の失敗（401）：ログインへ移り、書きかけの字はこの端末に残る（入り直して開くと戻る）", async ({
  page,
}) => {
  const t = await mockThread(page);
  t.on.post = () => err(401, "UNAUTHENTICATED");
  await openThread(page);
  await box(page).fill("入り直しても残る字");
  await send(page).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), DRAFT_KEY)).toContain("入り直しても残る字");
  t.on.post = (b) => ({ status: 201, body: { data: post(TAKA_W, "2025-11-01 11:02", String(b["body"])) } });
  await openThread(page);
  await expect(box(page)).toHaveValue("入り直しても残る字");
});

test("K393-UI-008 空白だけ・何も書いていないときは「書き込む」を押せない（口を呼ばない）", async ({ page }) => {
  const t = await mockThread(page);
  await openThread(page);
  await expect(send(page)).toBeDisabled();
  await box(page).fill("  \n　");
  await expect(send(page)).toBeDisabled();
  expect(t.posts).toHaveLength(0);
});

// ---------------------------------------------------------------- @ の候補

test("K393-UI-009 @ の候補：「@鈴」でそのチケットを見られる人のうち名前が合う人だけ（鈴木 一郎・鈴木 健。見られない人と自分は出ない）。↓ と Enter で選ぶと「@鈴木 」を入れ、送る @ の人に入る。押して選んでも同じ。Esc で閉じる", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await box(page).fill("了解です。@鈴");
  await expect(candidates(page).getByRole("option")).toHaveText([/鈴木 一郎\s*担当者/, /鈴木 健\s*経理グループ/]);
  await box(page).press("ArrowDown");
  await expect(candidates(page).getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await box(page).press("ArrowUp");
  await box(page).press("Enter");
  await expect(box(page)).toHaveValue("了解です。@鈴木 ");
  await expect(candidates(page)).toHaveCount(0);
  await box(page).pressSequentially("と@");
  await expect(candidates(page).getByRole("option")).toHaveText([/鈴木 一郎/, /佐藤 花子/, /鈴木 健/]);
  await expect(candidates(page)).not.toContainText("高本");
  await candidates(page)
    .getByRole("option", { name: /鈴木 健/ })
    .click();
  await expect(box(page)).toHaveValue("了解です。@鈴木 と@鈴木 健 ");
  await box(page).pressSequentially("@");
  await expect(candidates(page)).toBeVisible();
  await box(page).press("Escape");
  await expect(candidates(page)).toHaveCount(0);
  await send(page).click();
  await expect.poll(() => t.posts.length).toBe(1);
  expect(t.posts[0]!.body["mention_member_ids"]).toEqual([SUZU, KEN]);
  expect(JSON.stringify(t.posts[0]!.body)).not.toContain(OUTSIDER);
});

test("K393-UI-010 表記ゆらぎと入力中の字：全角の「＠」でも候補が出る。かな漢字の変換中の Enter では候補を選ばない", async ({
  page,
}) => {
  await mockThread(page);
  await openThread(page);
  await box(page).fill("＠佐");
  await expect(candidates(page).getByRole("option")).toHaveText([/佐藤 花子/]);
  await box(page).evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
    ),
  );
  await expect(box(page)).toHaveValue("＠佐");
  await expect(candidates(page)).toBeVisible();
});

test("K393-UI-011 送る前に「@鈴木」の字を消したら、その人は送る @ の人に入れない（字に残っている人だけ）", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await box(page).fill("@鈴");
  await box(page).press("Enter");
  await expect(box(page)).toHaveValue("@鈴木 ");
  await box(page).fill("やっぱり呼ばない");
  await send(page).click();
  await expect.poll(() => t.posts.length).toBe(1);
  expect(t.posts[0]!.body["mention_member_ids"]).toEqual([]);
});

// ---------------------------------------------------------------- 知らせる人

test("K393-UI-012 知らせる人：× で外す・＋ で「知らせる人を選ぶ」の小窓（今の部品 NotifyPicker・絞る欄の見出しは「知らせる人」・候補はそのチケットを見られる人だけ・自分は出ない・名前で絞れる・合う人がいません）。選んだ人を送る", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await notifyList(page).getByRole("button", { name: "佐藤 を外す" }).click();
  await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveText([/鈴木/]);
  await notifyList(page).getByRole("button", { name: "知らせる人を足す" }).click();
  const dlg = page.getByRole("dialog", { name: "知らせる人を選ぶ" });
  await expect(dlg).toBeVisible();
  const people = dlg.getByRole("group", { name: "知らせる人の候補" }).getByRole("checkbox");
  await expect(people).toHaveCount(3); // 鈴木 一郎・佐藤 花子・鈴木 健（見られない人・自分は出ない）
  await expect(dlg).not.toContainText("高本");
  // NotifyPicker の字の口（この葉が足す label・placeholder）：作る画面の字（作ったことを知らせる人・自動で届く）は出さない
  const filter = dlg.getByRole("textbox", { name: "知らせる人", exact: true });
  await expect(filter).toHaveAttribute("placeholder", "名前で絞り込む");
  await expect(dlg).not.toContainText("作ったことを知らせる人");
  await filter.fill("ｹﾝ");
  await expect(dlg.getByText("合う人がいません")).toBeVisible();
  await filter.fill("健");
  await dlg.getByRole("checkbox", { name: "鈴木 健" }).check();
  await dlg.getByRole("button", { name: "閉じる" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(notifyList(page).locator(".k-talk-notify-who")).toHaveText([/鈴木/, /鈴木 健/]);
  await box(page).fill("確認お願いします");
  await send(page).click();
  await expect.poll(() => t.posts.length).toBe(1);
  expect(t.posts[0]!.body["notify_member_ids"]).toEqual([SUZU, KEN]);
  expect(t.posts[0]!.body["notify_member_ids"]).not.toContain(ME);
});

// ---------------------------------------------------------------- 引用

test("K393-UI-013 引用：書き込みの「引用」を押すと書く欄の上に頭の 1〜2 行（3 行目からは「…」）と「引用を外す」。送ると引用元の id を送り、外すと送らない", async ({
  page,
}) => {
  const t = await mockThread(page, {
    items: [post(SUZU_W, "2025-11-01 10:20", "1 行目の字\n2 行目の字\n3 行目の字", { id: P_TAKA_ID })],
  });
  await openThread(page);
  await postOf(page, "鈴木 一郎", "10:20").getByRole("button", { name: "引用" }).click();
  const quote = panel(page).locator(".k-talk-composer .k-talk-quote");
  await expect(quote).toHaveText(/^1 行目の字\s*2 行目の字…$/);
  await expect(box(page)).toBeFocused();
  await box(page).fill("この件です");
  await send(page).click();
  await expect.poll(() => t.posts.length).toBe(1);
  expect(t.posts[0]!.body["quote_of_id"]).toBe(P_TAKA_ID);
  await expect(quote).toHaveCount(0);
  await postOf(page, "鈴木 一郎", "10:20").getByRole("button", { name: "引用" }).click();
  await panel(page).getByRole("button", { name: "引用を外す" }).click();
  await expect(quote).toHaveCount(0);
  await box(page).fill("引用なし");
  await send(page).click();
  await expect.poll(() => t.posts.length).toBe(2);
  expect(t.posts[1]!.body["quote_of_id"]).toBeNull();
});

// ---------------------------------------------------------------- 書きかけ

test("K393-UI-014 書きかけ：送るまでその端末に残る（一覧へ移って戻る・開き直す）。別のチケットの書く欄には出ない。送れたら消える・送れなかったら残る", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await box(page).fill("書きかけの字");
  await page.getByRole("link", { name: "チケット", exact: true }).first().click();
  await expect(page).toHaveURL(/\/tickets(\?|$)/);
  await openThread(page);
  await expect(box(page)).toHaveValue("書きかけの字");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /11 月分の請求書を送る/ })).toBeVisible();
  await panel(page)
    .getByRole("navigation", { name: "パネルのタブ" })
    .getByRole("button", { name: /^やり取り/ })
    .click();
  await expect(box(page)).toHaveValue("書きかけの字");
  expect(
    await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("kaname.thread.draft."))),
  ).toEqual([DRAFT_KEY]);
  t.on.post = () => err(503, "SERVICE_UNAVAILABLE");
  await send(page).click();
  await expect(composerAlert(page)).toContainText(FAILED);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), DRAFT_KEY)).toContain("書きかけの字");
  t.on.post = (b) => ({ status: 201, body: { data: post(TAKA_W, "2025-11-01 11:02", String(b["body"])) } });
  await send(page).click();
  await expect(postOf(page, "高本 聖斗", "11:02")).toBeVisible();
  expect(await page.evaluate((k) => window.localStorage.getItem(k), DRAFT_KEY)).toBeNull();
});

// ---------------------------------------------------------------- 誰でも・どの段でも書ける

test("K393-UI-015 完了したチケットにも書ける（⑭）：書く欄は押せ、状態 ▾ は押せない形。書いても段は変わらない（送る値に段を入れない）", async ({
  page,
}) => {
  const t = await mockThread(page, {
    band: { stage: "done", completed: { at: "2026-11-02T06:30:00Z", by: "高本 聖斗" } },
  });
  await openThread(page);
  await expect(panel(page).getByRole("button", { name: /^状態 変えない/ })).toHaveAttribute("aria-disabled", "true");
  await box(page).fill("お疲れさまでした");
  await send(page).click();
  await expect(postOf(page, "高本 聖斗", "11:02")).toBeVisible();
  expect(Object.keys(t.posts[0]!.body).sort()).toEqual([
    "body",
    "mention_member_ids",
    "notify_member_ids",
    "quote_of_id",
  ]);
});

test("K393-UI-016 段を変えられない人（閲覧のみ・can.progress が false）も書ける（⑧ 読める人は書ける）", async ({
  page,
}) => {
  const t = await mockThread(page, { extra: { can: { delegate: false, complete: false, progress: false } } });
  await openThread(page);
  await box(page).fill("質問です");
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(postOf(page, "高本 聖斗", "11:02")).toBeVisible();
  expect(t.posts).toHaveLength(1);
});

test("K393-UI-017 書いた行が見える所まで動く（一覧が長くても、足した行がパネルの見える所に入る）", async ({ page }) => {
  const many = Array.from({ length: 20 }, (_, i) =>
    post(SUZU_W, `2025-11-01 0${Math.floor(i / 10)}:${String(10 + i).slice(-2)}`, `書き込み ${i}`),
  );
  await mockThread(page, { items: many });
  await openThread(page);
  await box(page).fill("いちばん下に足す");
  await send(page).click();
  await expect(postOf(page, "高本 聖斗", "11:02")).toBeInViewport();
});

for (const w of [320, 375, 768, 1024, 1440]) {
  test(`K393-UI-018 幅 ${w}：知らせる人が多く長い名前でも書く欄が溢れない（横溢れ 0）`, async ({ page }) => {
    await mockThread(page);
    await openThread(page, w);
    await notifyList(page).getByRole("button", { name: "知らせる人を足す" }).click();
    const dlg = page.getByRole("dialog", { name: "知らせる人を選ぶ" });
    await dlg.getByRole("checkbox", { name: "鈴木 健" }).check();
    await dlg.getByRole("button", { name: "閉じる" }).click();
    await box(page).fill("長い字".repeat(80));
    expect(await overflowX(page)).toBe(0);
  });
}

test("K393-UI-019 キーボード：打つ所 → 状態 ▾ → 担当 ▾ と 📎（押せない物は飛ばす）→ 知らせる人の × と ＋ → 書き込む の順に Tab で移り、書き込むは Enter で送る", async ({
  page,
}) => {
  const t = await mockThread(page);
  await openThread(page);
  await box(page).fill("キーボードで送る");
  const order: string[] = [];
  for (let i = 0; i < 10 && order.at(-1) !== "書き込む"; i++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "",
      ),
    );
  }
  // 状態 ▾ はこの葉では押せない形（押せるのは K-396）。押せない物（tabIndex -1）は飛ばす
  expect(order.filter((n) => !/^状態/.test(n))).toEqual(["鈴木 を外す", "佐藤 を外す", "知らせる人を足す", "書き込む"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => t.posts.length).toBe(1);
});
