// K-470「探す：決定とナレッジ」の単体の試験（口・本物の DB）。名前の頭の行 ID（K470-API-…）は 11_tickets/K-470.md の行の表と 1 対 1。
// 口：GET /api/v1/search。決定の探し方は features/F7/search/decisions.ts、ナレッジは knowledge.ts（今は 0 件）。
//   決定の 1 件：{ kind: "decision", id: 決定の id, title: 決めたこと（改行は空白・80 字まで）, snippet: 「チケットの番号・チケットの題名」, url: /tickets/<チケットの id>#sec-decisions }
//   探す相手：決めたことと理由。見えるチケットの、生きている決定（改められた決定・取り消した決定は出さない）だけ。
// 決定の表（ticket_decisions）の取り消しの列（cancelled_at・cancelled_by・cancel_reason）は段 7 の K-390 が足す。取り消しの行は試験の本体の中で入れる。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ids,
  kindsOf,
  makeTicket,
  makeWorld,
  outsideGroup,
  qs,
  search,
  searchOk,
  setRow,
  setupSearch,
  wide,
  type Hit,
  type Person,
  type SearchKit,
  type World,
} from "./search.harness.js";

let k: SearchKit;
const f = () => k.f;
const world = (prefix = "EG") => makeWorld(f(), prefix);
const ok = (who: Person, q = "") => searchOk(f(), who, q);
const make = (w: World, o: Parameters<typeof makeTicket>[2] = {}) => makeTicket(f(), w, o);

beforeAll(async () => {
  k = await setupSearch();
}, 60_000);
afterAll(async () => {
  await k?.f.close();
});

/** 決定を 1 つ入れる（管理の接続で直に）。返すのは決定の id */
async function decide(
  w: World,
  ticketId: string,
  o: { text: string; reason?: string | null; at?: string; by?: Person },
): Promise<string> {
  const id = (
    await f().admin.query<{ id: string }>(
      "insert into ticket_decisions (tenant_id, ticket_id, text, reason, decided_by) values ($1, $2, $3, $4, $5) returning id",
      [w.tenantId, ticketId, o.text, o.reason ?? null, (o.by ?? w.me).id],
    )
  ).rows[0]!.id;
  if (o.at) await setRow(f(), "ticket_decisions", id, { decided_at: o.at });
  return id;
}
const decisionHits = (h: Hit[]) => h.filter((x) => x.kind === "decision");

describe("K-470 探す：決定", () => {
  it("K470-API-001 決めたことで当たる：鍵は 5 つ・kind decision・title は決めたこと・snippet は「番号・チケットの題名」・url は /tickets/<チケットの id>#sec-decisions", async () => {
    const w = await world();
    const t = await make(w, { title: "請求書を送る" });
    const d = await decide(w, t.id, { text: "請求は月末にまとめて送る" });
    await decide(w, t.id, { text: "別の決めごと" });
    const h = decisionHits(await ok(w.me, qs("月末")));
    expect(h).toEqual([
      {
        kind: "decision",
        id: d,
        title: "請求は月末にまとめて送る",
        snippet: `${t.number}・請求書を送る`,
        url: `/tickets/${t.id}#sec-decisions`,
      },
    ]);
    expect(Object.keys(h[0]!).sort()).toEqual(["id", "kind", "snippet", "title", "url"]);
  });

  it("K470-API-002 理由でも当たる（title は決めたことのまま）。理由の無い決定は理由では当たらない", async () => {
    const w = await world();
    const t = await make(w);
    const d = await decide(w, t.id, { text: "見積は 2 社から取る", reason: "価格の比較が要るため" });
    await decide(w, t.id, { text: "理由なしの決定", reason: null });
    const h = decisionHits(await ok(w.me, qs("価格の比較")));
    expect(ids(h)).toEqual([d]);
    expect(h[0]!.title).toBe("見積は 2 社から取る");
  });

  it("K470-API-003 見えないチケットの決定は出ない（見えるのは見えるチケットの決定だけ）。見る権限を付けた直後は出て、外した直後は出ない", async () => {
    const w = await world();
    const grp = await outsideGroup(f(), w);
    const acct = await f().person(w.tenantId, grp, { name: "経理の人", ticketAbility: "edit" });
    const t = await make({ ...w, me: acct }, { scope: grp, assignee: acct, title: "経理のチケット" });
    const d = await decide({ ...w, me: acct }, t.id, { text: "経理だけの決めごと" });
    const viewer = await f().person(w.tenantId, w.root, { name: "見る人" });
    expect(ids(decisionHits(await ok(viewer, qs("経理だけ"))))).toEqual([]);
    await f().admin.query(
      "insert into permissions (tenant_id, grantee_member_id, target_kind_id, scope_id, ability_id) values ($1, $2, 'tickets', $3, 'view')",
      [w.tenantId, viewer.id, grp],
    );
    expect(ids(decisionHits(await ok(viewer, qs("経理だけ"))))).toEqual([d]);
    await f().admin.query("delete from permissions where grantee_member_id = $1 and scope_id = $2", [viewer.id, grp]);
    expect(ids(decisionHits(await ok(viewer, qs("経理だけ"))))).toEqual([]);
  });

  it("K470-API-004 見るだけの人にも、見えるチケットの決定は出る", async () => {
    const w = await world();
    const t = await make(w);
    const d = await decide(w, t.id, { text: "公開の決めごと" });
    const viewer = await f().person(w.tenantId, w.root, { name: "見るだけの人", ticketAbility: "view" });
    expect(ids(decisionHits(await ok(viewer, qs("公開の決めごと"))))).toEqual([d]);
  });

  it("K470-API-005 消したチケットの決定は出ない（消した本人にも）。取り込みの下書きのチケットの決定は、取り込んだ本人にだけ出る", async () => {
    const w = await world();
    const gone = await make(w, { title: "消すチケット" });
    await decide(w, gone.id, { text: "消したチケットの決めごと" });
    await setRow(f(), "tickets", gone.id, { deleted_at: new Date().toISOString() });
    const draft = await make(w, { title: "下書きのチケット", assignee: w.mate });
    const dd = await decide(w, draft.id, { text: "下書きの決めごと" });
    const imp = (
      await f().admin.query<{ id: string }>(
        "insert into ticket_imports (tenant_id, uploaded_by, scope_id, source) values ($1, $2, $3, 'generic') returning id",
        [w.tenantId, w.me.id, w.root],
      )
    ).rows[0]!.id;
    await setRow(f(), "tickets", draft.id, { draft_import_id: imp });
    expect(ids(decisionHits(await ok(w.me, qs("決めごと"))))).toEqual([dd]);
    expect(ids(decisionHits(await ok(w.mate, qs("決めごと"))))).toEqual([]);
  });

  it("K470-API-006 他の会社の決定は出ない。2 つの会社に入っている人には今のワークスペースの決定だけ", async () => {
    const w = await world("EG");
    const o = await world("OT");
    const there = await f().alsoIn(w.me, o.tenantId, o.root);
    await f().admin.query(
      "insert into permissions (tenant_id, grantee_member_id, target_kind_id, scope_id, ability_id) values ($1, $2, 'tickets', $3, 'view')",
      [o.tenantId, there.id, o.root],
    );
    const theirs = await decide(o, (await make(o)).id, { text: "他社の決めごと" });
    const here = await decide(w, (await make(w)).id, { text: "自社の決めごと" });
    expect(ids(decisionHits(await ok(w.me, qs("決めごと"))))).toEqual([here]);
    expect(ids(decisionHits(await ok(there, qs("決めごと"))))).toEqual([theirs]);
  });

  it("K470-API-007 改められた決定・取り消した決定は出ない（改めた先の生きている決定は出る）", async () => {
    const w = await world();
    const t = await make(w);
    const oldOne = await decide(w, t.id, { text: "古い決めごと" });
    const newOne = await decide(w, t.id, { text: "改めた決めごと" });
    await f().admin.query("update ticket_decisions set superseded_by_id = $2 where id = $1", [oldOne, newOne]);
    const cancelled = await decide(w, t.id, { text: "取り消した決めごと" });
    await f().admin.query(
      "update ticket_decisions set cancelled_at = now(), cancelled_by = $2, cancel_reason = 'やめた' where id = $1",
      [cancelled, w.me.id],
    );
    const live = await decide(w, t.id, { text: "生きている決めごと" });
    expect(new Set(ids(decisionHits(await ok(w.me, qs("決めごと")))))).toEqual(new Set([newOne, live]));
  });

  it("K470-API-008 表記ゆらぎ（全角半角・大文字小文字・前後の空白）と % ・ _ ・ \\ の文字扱いは、題名の探し方と同じ", async () => {
    const w = await world();
    const t = await make(w);
    const api = await decide(w, t.id, { text: "ＡＰＩ の版を固定する" });
    const pct = await decide(w, t.id, { text: "割引 10% を上限にする" });
    await decide(w, t.id, { text: "割引 10 を上限にする" });
    const under = await decide(w, t.id, { text: "a_b を使う" });
    await decide(w, t.id, { text: "axb を使う" });
    const slash = await decide(w, t.id, { text: "c\\d を使う" });
    expect(ids(decisionHits(await ok(w.me, qs(" api "))))).toEqual([api]);
    expect(ids(decisionHits(await ok(w.me, qs(wide("API")))))).toEqual([api]);
    expect(ids(decisionHits(await ok(w.me, qs("10%"))))).toEqual([pct]);
    expect(ids(decisionHits(await ok(w.me, qs("a_b"))))).toEqual([under]);
    expect(ids(decisionHits(await ok(w.me, qs("c\\d"))))).toEqual([slash]);
  });

  it("K470-API-009 並び：決めた日の新しい順 → id の小さい順。種類ごとの上限（既定 5・limit で 1〜5）で切る", async () => {
    const w = await world();
    const t = await make(w);
    const made: string[] = [];
    for (let i = 0; i < 7; i += 1)
      made.push(await decide(w, t.id, { text: `並びの決めごと ${i}`, at: `2026-11-0${i + 1}T00:00:00Z` }));
    const five = ids(decisionHits(await ok(w.me, qs("並びの決めごと"))));
    expect(five).toEqual([made[6], made[5], made[4], made[3], made[2]]);
    expect(ids(decisionHits(await ok(w.me, qs("並びの決めごと", "limit=2"))))).toEqual([made[6], made[5]]);
  });

  it("K470-API-010 title は決めたことの 80 字まで（改行・連続する空白は 1 つの空白）。短い決定はそのまま", async () => {
    const w = await world();
    const t = await make(w);
    const longText = `長い決めごと${"あ".repeat(200)}`;
    const long = await decide(w, t.id, { text: longText });
    const lines = await decide(w, t.id, { text: "改行のある\n決めごと\n\n三行目" });
    const h = decisionHits(await ok(w.me, qs("決めごと")));
    const byId = Object.fromEntries(h.map((x) => [x.id, x]));
    expect([...byId[long]!.title]).toHaveLength(80);
    expect(byId[long]!.title).toBe([...longText].slice(0, 80).join(""));
    expect(byId[lines]!.title).toBe("改行のある 決めごと 三行目");
  });

  it("K470-API-011 kinds：decision だけ・ticket だけ（決定は出ない）・空は全部。チケットの題名と決定が同じ語に当たるときの並びは チケット → 決定", async () => {
    const w = await world();
    const t = await make(w, { title: "請求の件" });
    const d = await decide(w, t.id, { text: "請求は月末" });
    expect(ids(await ok(w.me, qs("請求", "kinds=decision")))).toEqual([d]);
    expect(ids(await ok(w.me, qs("請求", "kinds=ticket")))).toEqual([t.id]);
    const all = await ok(w.me, qs("請求"));
    expect(kindsOf(all)).toEqual(["ticket", "decision"]);
    expect(ids(all)).toEqual([t.id, d]);
  });

  it("K470-API-012 ログに決めたこと・理由・探す言葉が出ない", async () => {
    const w = await world();
    const t = await make(w);
    await decide(w, t.id, { text: "ログに出ない決めごと", reason: "ログに出ない理由" });
    const out: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))),
    );
    try {
      await ok(w.me, qs("ログに出ない"));
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(out.join("\n")).not.toContain("ログに出ない");
  });
});

describe("K-470 探す：ナレッジのページ（今は 0 件）", () => {
  it("K470-API-013 ナレッジ：題名が当たる公開のページがあっても、kinds=knowledge は 200・data は空（ページの見える決まりは F9 が決めるまで出さない・D-151.8）", async () => {
    const w = await world();
    await f().admin.query(
      "insert into knowledge_pages (tenant_id, scope_id, title, owner_member_id, state) values ($1, $2, $3, $4, 'published')",
      [w.tenantId, w.root, "請求のやり方（手順）", w.me.id],
    );
    const r = await search(f(), w.me, qs("請求", "kinds=knowledge"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: [] });
    // 知らない種類の名前（page）は 422 のまま（種類の名前は knowledge）
    expect((await search(f(), w.me, qs("請求", "kinds=page"))).status).toBe(422);
  });

  it("K470-API-014 ナレッジ：種類を絞らないときも、自分のページ・ほかの人の下書きのページを含め、kind が knowledge の行は 1 件も出ない。チケットと決定は今までどおり出る", async () => {
    const w = await world();
    const t = await make(w, { title: "請求の件" });
    const d = await decide(w, t.id, { text: "請求は月末" });
    for (const [state, personal, owner] of [
      ["published", false, w.me],
      ["draft", false, w.mate],
      ["draft", true, w.mate],
    ] as const)
      await f().admin.query(
        "insert into knowledge_pages (tenant_id, scope_id, title, owner_member_id, state, is_personal) values ($1, $2, $3, $4, $5, $6)",
        [w.tenantId, w.root, `請求のページ ${state}`, owner.id, state, personal],
      );
    const all = await ok(w.me, qs("請求"));
    expect(all.filter((x) => x.kind === "knowledge")).toEqual([]);
    expect(ids(all)).toEqual([t.id, d]);
  });
});
