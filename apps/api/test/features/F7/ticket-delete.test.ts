// K-488「消す（deleteTicket）」の単体の試験（口・本物の DB）。名前の頭の行 ID（K488-API-…）は 11_tickets/K-488.md の行の表と 1 対 1。
// 口：DELETE /api/v1/tickets/:id?children=move|cascade|detach&parent_id=<移し先>&reason=<理由>
//   → 200 { data: { id, deleted_count, withdrawn_approvals, stopped_runs, restorable_until } }
//   消せる人は作った人か、そのグループで tickets の edit を持つ人（D-125.62・P14）。子・孫がいる親は children で扱いを選ぶ（D-125.62）：
//   move＝子を別の親（parent_id）へ・cascade＝子・孫も一緒に消す・detach＝子の親を外して単体に。理由は任意（400 字まで・証跡に残る）。
//   承認待ちは取り下げ・走っている AI の実行は止める・つながり・添付・成果物には何も書かない。消すのは deleted_at を立てるだけ（段 9 の渡しの自動の取り消しの引き金が働く）。
// 土台は ticket-delete.harness.ts（口の振る舞いは apps/api/src/hooks/ticket-delete.ts を最初の要求のときに読む）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。時刻は眠らずに DB の行の時刻を動かす。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { data, json, setupDelete, withLimit, type DeleteWorld, type Person } from "./ticket-delete.harness.js";

let w: DeleteWorld;
beforeAll(async () => {
  w = await setupDelete(["ticket-delete"]);
}, 90_000);
afterAll(async () => {
  await w?.k.close();
});

const DEL_KEYS = ["deleted_count", "id", "restorable_until", "stopped_runs", "withdrawn_approvals"];
type Done = {
  id: string;
  deleted_count: number;
  withdrawn_approvals: number;
  stopped_runs: number;
  restorable_until: string;
};
const done = async (p: Person, id: string, q: Parameters<DeleteWorld["del"]>[2] = {}): Promise<Done> => {
  const r = await w.del(p, id, q);
  expect(r.status, await r.clone().text()).toBe(200);
  return data<Done>(r);
};
const code = async (r: Response) => (await json(r)).code;
const isDeleted = async (id: string) => (await w.row(id)).deleted_at !== null;
const fresh = (name: string) => w.k.f.person(w.k.T.tenantId, w.k.T.rootScope, { name, ticketAbility: "edit" });
const q = <R extends Record<string, unknown>>(sql: string, p: unknown[] = []) => w.k.q<R>(sql, p);
const notices = () => w.k.n("select count(*) as n from notifications where tenant_id = $1", [w.k.T.tenantId]);

describe("K-488 消す：チケット 1 枚（子なし）", () => {
  it("K488-API-001 作った人（edit あり）が消す：200・deleted_at と deleted_by・証跡 1 行・再取得で見えない。答えの鍵は 5 個ちょうど・restorable_until は消した時刻の 30 日後", async () => {
    const t = await w.make(w.creator, { title: "重複して作った請求書" });
    const r = await w.del(w.creator, t);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(r.headers.get("cache-control") ?? "").toMatch(/private/);
    expect(r.headers.get("cache-control") ?? "").toMatch(/no-store/);
    const v = (await json(r))["data"] as Done;
    expect(Object.keys(v).sort()).toEqual(DEL_KEYS);
    expect(v).toMatchObject({ id: t, deleted_count: 1, withdrawn_approvals: 0, stopped_runs: 0 });
    const row = await w.row(t);
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_by).toBe(w.creator.id);
    expect(Date.parse(v.restorable_until) - row.deleted_at!.getTime()).toBe(30 * 86400_000);
    const audits = await w.audit("tickets.delete", t);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_member_id).toBe(w.creator.id);
    expect((await w.k.f.req("GET", `/tickets/${t}`, { headers: w.creator.auth })).status).toBe(404);
    const list = await w.k.f.req("GET", "/tickets?view=all&limit=100", { headers: w.creator.auth });
    expect(((await json(list))["data"] as { id: string }[]).some((x) => x.id === t)).toBe(false);
  });

  it("K488-API-002 作った人（edit の無い人でも）・edit を持つ別の人が消せる", async () => {
    const mine = await w.make(w.creator);
    await w.k.f.admin.query("update tickets set created_by = $2 where id = $1", [mine, w.assignee.id]);
    expect((await w.del(w.assignee, mine)).status).toBe(200); // 作った人・edit なし
    const theirs = await w.make(w.creator);
    expect((await w.del(w.editor, theirs)).status).toBe(200); // 作った人でない・edit あり
    expect((await w.row(theirs)).deleted_by).toBe(w.editor.id);
  });

  it("K488-API-003 消せない人（見るだけ・担当者だけ・マネージャー・管理者で edit が無く作った人でもない）：403・E-DEL-001。何も変わらない", async () => {
    const t = await w.make(w.creator, { assignee: w.assignee });
    // 管理者は会員にした時に役割の束で tickets の edit（会社全体）を持つ。「edit の無い管理者」を作るため、その束の行だけを一時的に失効させる（終わりに必ず戻す）
    const bundle = "grantee_member_id = $1 and target_kind_id = 'tickets' and bundle_role is not null";
    await w.k.f.admin.query(`update permissions set revoked_at = now() where ${bundle}`, [w.admin.id]);
    try {
      for (const p of [w.viewer, w.assignee, w.manager, w.admin]) {
        const r = await w.del(p, t);
        expect(r.status, p.id).toBe(403);
        expect(await code(r), p.id).toBe("E-DEL-001");
      }
    } finally {
      await w.k.f.admin.query(`update permissions set revoked_at = null where ${bundle}`, [w.admin.id]);
    }
    expect(await isDeleted(t)).toBe(false);
    expect(await w.audit("tickets.delete", t)).toHaveLength(0);
  });

  it("K488-API-004 見えない人・無い id・もう消した物：404（別の会社・見えないグループ・無い id・二度目）", async () => {
    const t = await w.make(w.creator);
    expect((await w.del(w.outsider, t)).status).toBe(404);
    expect((await w.del(w.stranger, t)).status).toBe(404);
    expect((await w.del(w.creator, randomUUID())).status).toBe(404);
    expect(await isDeleted(t)).toBe(false);
    await done(w.creator, t);
    expect((await w.del(w.creator, t)).status).toBe(404);
    expect(await w.audit("tickets.delete", t)).toHaveLength(1);
  });

  it("K488-API-005 理由（任意・400 字まで）：証跡の payload に前後の空白を落とした文で残る。空白だけは無いのと同じ。401 字は 422 で何も変わらない", async () => {
    const a = await w.make(w.creator);
    await done(w.creator, a, { reason: "　重複して作ってしまった \n" });
    expect((await w.audit("tickets.delete", a))[0]!.payload["reason"]).toBe("重複して作ってしまった");
    const b = await w.make(w.creator);
    await done(w.creator, b, { reason: "   " });
    expect((await w.audit("tickets.delete", b))[0]!.payload["reason"] ?? null).toBeNull();
    const c = await w.make(w.creator);
    await done(w.creator, c, { reason: "あ".repeat(400) });
    expect(String((await w.audit("tickets.delete", c))[0]!.payload["reason"])).toHaveLength(400);
    const d = await w.make(w.creator);
    const r = await w.del(w.creator, d, { reason: "あ".repeat(401) });
    expect(r.status).toBe(422);
    expect(((await json(r))["details"] as { field: string }[]).map((x) => x.field)).toEqual(["reason"]);
    expect(await isDeleted(d)).toBe(false);
    // 字数は前後の空白を落とす前で数える（落とせば 400 字に収まっても、契約の maxLength 400 を超えたら 422）
    const e = await w.make(w.creator);
    const padded = await w.del(w.creator, e, { reason: `\u3000\u3000${"あ".repeat(400)}` });
    expect(padded.status).toBe(422);
    expect(((await json(padded))["details"] as { field: string }[]).map((x) => x.field)).toEqual(["reason"]);
    expect(await isDeleted(e)).toBe(false);
  });

  it("K488-API-006 消しただけで済む物：添付・成果物・つながりには何も書かない（戻すときそのまま見える）。チケットの番号と題名は変わらない", async () => {
    const pc = await w.pcOf(w.creator);
    const t = await w.make(w.creator, { title: "そのまま残す題名" });
    const other = await w.make(w.creator);
    const { jobId } = await w.runningRun(w.creator, pc, t);
    const att = await w.attachment(t, w.creator);
    const art = await w.artifact(jobId, w.creator);
    await w.link(t, other);
    const before = await w.row(t);
    await done(w.creator, t);
    const after = await w.row(t);
    expect([after.number, after.title]).toEqual([before.number, before.title]);
    expect((await q("select deleted_at from attachments where id = $1", [att]))[0]!["deleted_at"]).toBeNull();
    expect((await q("select deleted_at from artifacts where id = $1", [art]))[0]!["deleted_at"]).toBeNull();
    expect(
      (await q("select deleted_at from ticket_links where from_ticket_id = $1", [t]))[0]!["deleted_at"],
    ).toBeNull();
    expect(await isDeleted(other)).toBe(false);
  });
});

describe("K-488 消す：子・孫がいる親の扱い（D-125.62）", () => {
  it("K488-API-007 子がいるのに扱いを選ばない：409・E-DEL-010。親も子も消えない", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const r = await w.del(w.creator, p);
    expect(r.status).toBe(409);
    const body = await json(r);
    expect(body.code).toBe("E-DEL-010");
    expect((body["details"] ?? null) === null).toBe(true); // 409 には details を付けない
    expect(await isDeleted(p)).toBe(false);
    expect(await isDeleted(c)).toBe(false);
  });

  it("K488-API-008 move（別の親へ移す）：子は移し先の子になり孫は子の下のまま。親だけが消える。deleted_count は 1", async () => {
    const p = await w.make(w.creator);
    const c1 = await w.make(w.creator, { parent: p });
    const c2 = await w.make(w.creator, { parent: p });
    const g = await w.make(w.creator, { parent: c1 });
    const dest = await w.make(w.creator);
    const v = await done(w.creator, p, { children: "move", parent_id: dest });
    expect(v.deleted_count).toBe(1);
    expect(await isDeleted(p)).toBe(true);
    expect((await w.row(c1)).parent_ticket_id).toBe(dest);
    expect((await w.row(c2)).parent_ticket_id).toBe(dest);
    expect((await w.row(g)).parent_ticket_id).toBe(c1);
    expect(await isDeleted(c1)).toBe(false);
    const got = await data<{ ticket: { parent_ticket_id: string | null } }>(
      await w.k.f.req("GET", `/tickets/${c1}`, { headers: w.creator.auth }),
    );
    expect(got.ticket.parent_ticket_id).toBe(dest);
  });

  it("K488-API-009 move の移し先が使えない：見えない・別の会社・無い・消えている・指していない（parent_id が無い・空）→ 404・E-DEL-014（欄は付けない）。何も変わらない", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const hidden = await w.make(w.stranger, { scope: w.otherScope });
    const gone = await w.make(w.creator);
    await w.k.f.admin.query("update tickets set deleted_at = now() where id = $1", [gone]);
    const foreign = await w.k.ticket(w.outsider, { scope: w.k.O.rootScope });
    for (const dest of [hidden, foreign, randomUUID(), gone]) {
      const r = await w.del(w.creator, p, { children: "move", parent_id: dest });
      expect(r.status, dest).toBe(404);
      expect(await code(r), dest).toBe("E-DEL-014");
    }
    for (const query of [{ children: "move" }, { children: "move", parent_id: "" }]) {
      const r = await w.del(w.creator, p, query); // 移し先を指していない move は、指した物が無いのと同じ答え（422 にしない）
      expect(r.status, JSON.stringify(query)).toBe(404);
      const body = await json(r);
      expect(body["code"], JSON.stringify(query)).toBe("E-DEL-014");
      expect(body["field"], JSON.stringify(query)).toBeUndefined();
      expect(body["details"], JSON.stringify(query)).toBeUndefined();
    }
    expect(await isDeleted(p)).toBe(false);
    expect((await w.row(c)).parent_ticket_id).toBe(p);
  });

  it("K488-API-010 move の移し先が自分・自分の孫：409・E-DEL-011（輪にしない）。何も変わらない", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const g = await w.make(w.creator, { parent: c });
    for (const dest of [p, c, g]) {
      const r = await w.del(w.creator, p, { children: "move", parent_id: dest });
      expect(r.status, dest).toBe(409);
      expect(await code(r), dest).toBe("E-DEL-011");
    }
    expect(await isDeleted(p)).toBe(false);
    expect((await w.row(c)).parent_ticket_id).toBe(p);
  });

  it("K488-API-011 move で 3 段を超える（孫のいる子を、深い所へ移す）：409・E-DEL-012。何も変わらない（子の付け替えも戻る）", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const c2 = await w.make(w.creator, { parent: p });
    await w.make(w.creator, { parent: c }); // c は孫を持つ
    const m = await w.make(w.creator);
    const n = await w.make(w.creator, { parent: m }); // n は 2 段目
    const r = await w.del(w.creator, p, { children: "move", parent_id: n });
    expect(r.status).toBe(409);
    expect(await code(r)).toBe("E-DEL-012");
    expect(await isDeleted(p)).toBe(false);
    expect((await w.row(c)).parent_ticket_id).toBe(p);
    expect((await w.row(c2)).parent_ticket_id).toBe(p); // 先に付け替えた子も戻る
  });

  it("K488-API-012 detach（親を外して単体にする）：子の親は null・孫は子の下のまま・親だけが消える", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const g = await w.make(w.creator, { parent: c });
    const v = await done(w.creator, p, { children: "detach" });
    expect(v.deleted_count).toBe(1);
    expect((await w.row(c)).parent_ticket_id).toBeNull();
    expect((await w.row(g)).parent_ticket_id).toBe(c);
    expect([await isDeleted(p), await isDeleted(c), await isDeleted(g)]).toEqual([true, false, false]);
  });

  it("K488-API-013 cascade（一緒に消す）：子・孫も消える（同じ時刻・同じ人）。deleted_count は 3・証跡は 1 枚ごと・親の証跡に扱いが残る", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const g = await w.make(w.creator, { parent: c });
    const survivor = await w.make(w.creator); // 関係の無いチケット
    const v = await done(w.creator, p, { children: "cascade", reason: "案件ごと取りやめ" });
    expect(v.deleted_count).toBe(3);
    const rows = await Promise.all([p, c, g].map((id) => w.row(id)));
    expect(new Set(rows.map((x) => x.deleted_at!.toISOString())).size).toBe(1);
    expect(rows.every((x) => x.deleted_by === w.creator.id)).toBe(true);
    expect(await isDeleted(survivor)).toBe(false);
    for (const id of [p, c, g]) expect(await w.audit("tickets.delete", id)).toHaveLength(1);
    expect((await w.audit("tickets.delete", p))[0]!.payload).toMatchObject({
      children: "cascade",
      reason: "案件ごと取りやめ",
    });
    expect((await w.audit("tickets.delete", c))[0]!.payload).toMatchObject({ cause: "cascade" });
  });

  it("K488-API-014 cascade の子に、自分が消せない物（別のグループで edit が無く作った人でもない）がある：403・E-DEL-013。親も子も消えない。見えない子がいる親は扱いを選ばなければ E-DEL-010・move と detach は通る", async () => {
    const p = await w.make(w.creator);
    const mine = await w.make(w.creator, { parent: p });
    const theirs = await w.make(w.creator, { parent: p });
    await w.k.f.admin.query("update tickets set scope_id = $2, created_by = $3 where id = $1", [
      theirs,
      w.otherScope,
      w.stranger.id,
    ]);
    const r = await w.del(w.creator, p, { children: "cascade" });
    expect(r.status).toBe(403);
    expect(await code(r)).toBe("E-DEL-013");
    expect([await isDeleted(p), await isDeleted(mine), await isDeleted(theirs)]).toEqual([false, false, false]);
    // 見えない子（別のグループ・作った人でも edit でもない）がいる親：関数は定義者の権限で子を全部数える（K-487 の下見と同じ数え方）。
    // 扱いを選ばなければ E-DEL-010・move と detach は見えない子も付け替えて通る（見えない子を残して親だけが消えることは無い）
    const hiddenOf = async (parent: string) => {
      const h = await w.make(w.creator, { parent });
      await w.k.f.admin.query("update tickets set scope_id = $2, created_by = $3 where id = $1", [
        h,
        w.otherScope,
        w.stranger.id,
      ]);
      return h;
    };
    const p2 = await w.make(w.creator);
    const hidden2 = await hiddenOf(p2);
    const none = await w.del(w.creator, p2);
    expect(none.status).toBe(409);
    expect(await code(none)).toBe("E-DEL-010");
    expect(await isDeleted(p2)).toBe(false);
    const dest = await w.make(w.creator);
    const moved = await w.del(w.creator, p2, { children: "move", parent_id: dest });
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect((await w.row(hidden2)).parent_ticket_id).toBe(dest);
    const p3 = await w.make(w.creator);
    const hidden3 = await hiddenOf(p3);
    const detached = await w.del(w.creator, p3, { children: "detach" });
    expect(detached.status, await detached.clone().text()).toBe(200);
    expect((await w.row(hidden3)).parent_ticket_id).toBeNull();
  });

  it("K488-API-015 子が無いのに children を付けても、move 以外に parent_id を付けても無視する：200（子が消えた後・別のタブで先に外された後でも消せる。detach・cascade の parent_id は読まない）", async () => {
    const a = await w.make(w.creator);
    await done(w.creator, a, { children: "cascade" });
    const b = await w.make(w.creator);
    await done(w.creator, b, { children: "detach" });
    const c = await w.make(w.creator);
    await done(w.creator, c, { children: "move", parent_id: randomUUID() }); // 子が無いので移し先は見ない
    const dest = await w.make(w.creator);
    const p1 = await w.make(w.creator);
    const c1 = await w.make(w.creator, { parent: p1 });
    const detached = await done(w.creator, p1, { children: "detach", parent_id: dest }); // detach は parent_id を読まない
    expect(detached.deleted_count).toBe(1);
    expect((await w.row(c1)).parent_ticket_id).toBeNull();
    const p2 = await w.make(w.creator);
    const c2 = await w.make(w.creator, { parent: p2 });
    const cascaded = await done(w.creator, p2, { children: "cascade", parent_id: dest }); // cascade も読まない
    expect(cascaded.deleted_count).toBe(2);
    expect(await isDeleted(c2)).toBe(true);
    expect(await isDeleted(dest)).toBe(false);
  });

  it("K488-API-016 形の誤り：知らない children の値・parent_id が uuid でない → 422（欄 children・parent_id）。何も変わらない（移し先の組み合わせは 422 にしない・K488-API-009・015）", async () => {
    const p = await w.make(w.creator);
    await w.make(w.creator, { parent: p });
    const fields = async (r: Response) => ((await json(r))["details"] as { field: string }[]).map((x) => x.field);
    const bad = await w.del(w.creator, p, { children: "remove" });
    expect(bad.status).toBe(422);
    expect(await fields(bad)).toEqual(["children"]);
    const notUuid = await w.del(w.creator, p, { children: "move", parent_id: "not-a-uuid" });
    expect(notUuid.status).toBe(422);
    expect(await fields(notUuid)).toEqual(["parent_id"]);
    expect(await isDeleted(p)).toBe(false);
  });
});

describe("K-488 消す：承認待ち・走っている AI・消えた後の見え方", () => {
  it("K488-API-017 承認待ちは取り下げる：決まっていない承認だけ（withdrawn_at・status withdrawn）。決まった承認は触らない。答えの withdrawn_approvals で件数が分かる", async () => {
    const t = await w.make(w.creator);
    const open1 = await w.approval(t, w.creator);
    const open2 = await w.approval(t, w.creator);
    const decided = await w.approval(t, w.creator, { decided: true });
    const v = await done(w.creator, t);
    expect(v.withdrawn_approvals).toBe(2);
    const rows = await q<{ id: string; withdrawn_at: Date | null; status_id: string; decision: string | null }>(
      "select id, withdrawn_at, status_id, decision from approvals where ticket_id = $1",
      [t],
    );
    const by = Object.fromEntries(rows.map((x) => [x.id, x]));
    for (const id of [open1, open2]) {
      expect(by[id]!.withdrawn_at).not.toBeNull();
      expect(by[id]!.status_id).toBe("withdrawn");
    }
    expect(by[decided]!).toMatchObject({ withdrawn_at: null, decision: "approve" });
  });

  it("K488-API-018 走っている AI（動いている）は止まる：仕事・実行が stopped（理由はチケットが消されたので止めました）・旗が下りる・段は作業中に戻る・PC に止める合図・後から結果が来ても生き返らない。答えの stopped_runs は 1（担当者への知らせが出ないことは K-597 の K597-X1-03 が見る）", async () => {
    const p = await fresh("動いているのを消す人");
    const pc = await w.pcOf(p);
    const t = await w.make(p);
    const { runId, jobId } = await w.runningRun(p, pc, t);
    const v = await done(p, t);
    expect(v.stopped_runs).toBe(1);
    const stopped = "チケットが消されたので止めました";
    expect((await q("select * from action_runs where id = $1", [runId]))[0]).toMatchObject({
      status_id: "stopped",
      error_summary: stopped,
    });
    expect((await q("select * from bridge_jobs where id = $1", [jobId]))[0]).toMatchObject({
      state_id: "stopped",
      stopped_reason: stopped,
    });
    expect((await q("select delegated_to_clone as d from tickets where id = $1", [t]))[0]!["d"]).toBe(false);
    expect(await w.k.stageOf(t)).toBe("doing"); // 「実行中」のまま固まらない（戻したときに任せ直せる・K489-API-012）
    const c = await w.k.control(pc, jobId);
    expect(((await json(c))["data"] as { stop: boolean }).stop).toBe(true);
    const late = await w.k.finish(pc, jobId, { state: "done", result: "遅れて返ってきた成果物" });
    expect(late.status).toBe(404);
    expect((await q("select status_id from action_runs where id = $1", [runId]))[0]!["status_id"]).toBe("stopped");
  });

  it("K488-API-029 失敗（手順 S4：止めた PC への合図）：PC が止める合図を読まないまま結果を返しても 404 で拒まれる（2 回返しても同じ）。実行・仕事は stopped のまま理由も変わらず、合図はその後も stop を返し続ける", async () => {
    const p = await fresh("合図を読まない PC");
    const pc = await w.pcOf(p);
    const t = await w.make(p);
    const { runId, jobId } = await w.runningRun(p, pc, t);
    await done(p, t);
    const stopped = "チケットが消されたので止めました";
    for (const result of ["合図を読まずに返した成果物", "もう一度返した成果物"]) {
      expect((await w.k.finish(pc, jobId, { state: "done", result })).status).toBe(404);
    }
    expect((await q("select * from action_runs where id = $1", [runId]))[0]).toMatchObject({
      status_id: "stopped",
      error_summary: stopped,
    });
    expect((await q("select * from bridge_jobs where id = $1", [jobId]))[0]).toMatchObject({
      state_id: "stopped",
      stopped_reason: stopped,
    });
    const c = await w.k.control(pc, jobId);
    expect(((await json(c))["data"] as { stop: boolean }).stop).toBe(true);
  });

  it("K488-API-019 待っている AI（queued）も止まる：PC が取りに来ても渡る仕事は無い。止まった実行は数えない（stopped_runs 0）", async () => {
    const p = await fresh("待っているのを消す人");
    const pc = await w.pcOf(p);
    const t = await w.make(p);
    const d = await w.k.f.req("POST", `/tickets/${t}/delegate`, { body: {}, headers: p.auth });
    expect(d.status, await d.clone().text()).toBe(201);
    const v = await done(p, t);
    expect(v.stopped_runs).toBe(1);
    const took = await w.k.take(pc);
    expect(((await json(took))["data"] as { job: unknown }).job).toBeNull();
    const t2 = await w.make(p);
    expect((await done(p, t2)).stopped_runs).toBe(0);
  });

  it("K488-API-020 cascade：子・孫の承認待ちも取り下げ、子の走っている AI も止まる（件数は全部の合計）", async () => {
    const p = await fresh("一緒に消す人");
    const pc = await w.pcOf(p);
    const parent = await w.make(p);
    const c = await w.make(p, { parent });
    const g = await w.make(p, { parent: c });
    await w.approval(parent, p);
    await w.approval(g, p);
    const { runId } = await w.runningRun(p, pc, c);
    const v = await done(p, parent, { children: "cascade" });
    expect(v).toMatchObject({ deleted_count: 3, withdrawn_approvals: 2, stopped_runs: 1 });
    expect((await q("select status_id from action_runs where id = $1", [runId]))[0]!["status_id"]).toBe("stopped");
    expect(
      await w.k.n("select count(*) as n from approvals where ticket_id = any($1) and withdrawn_at is not null", [
        [parent, g],
      ]),
    ).toBe(2);
  });

  it("K488-API-021 消した後の見え方：チケット・実行の 1 件・実行の一覧は 404（D-129.43）。一覧に出ない。子を move で移したなら子は見える", async () => {
    const p = await fresh("見え方を確かめる人");
    const pc = await w.pcOf(p);
    const t = await w.make(p);
    const { runId } = await w.runningRun(p, pc, t);
    const keep = await w.make(p, { parent: t });
    const dest = await w.make(p);
    await done(p, t, { children: "move", parent_id: dest });
    for (const path of [`/tickets/${t}`, `/action_runs/${runId}`, `/tickets/${t}/runs`])
      expect((await w.k.f.req("GET", path, { headers: p.auth })).status, path).toBe(404);
    expect((await w.k.f.req("GET", `/tickets/${keep}`, { headers: p.auth })).status).toBe(200);
    const list = await w.k.f.req("GET", "/tickets?view=all&limit=100", { headers: p.auth });
    const ids = ((await json(list))["data"] as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(keep);
    expect(ids).not.toContain(t);
  });

  it("K488-API-022 二度押し・別のタブ（同時に 2 回）：[200, 404] で 1 回だけ消える。証跡は 1 行・取り下げの件数は 1 回分", async () => {
    const t = await w.make(w.creator);
    await w.approval(t, w.creator);
    const rs = await Promise.all([w.del(w.creator, t), w.del(w.creator, t)]);
    expect(rs.map((x) => x.status).sort()).toEqual([200, 404]);
    expect(await w.audit("tickets.delete", t)).toHaveLength(1);
    expect(
      await w.k.n("select count(*) as n from approvals where ticket_id = $1 and withdrawn_at is not null", [t]),
    ).toBe(1);
  });

  it("K488-API-023 別のタブで先に子を消した後：子が 0 件になっていれば扱いを選ばなくても消せる（200）。子が残っていれば 409・E-DEL-010", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const keep = await w.make(w.creator, { parent: p });
    await done(w.creator, c); // 子の 1 つを先に消した
    const stillOne = await w.del(w.creator, p); // 子が 1 つ残っている
    expect(stillOne.status).toBe(409);
    expect(await code(stillOne)).toBe("E-DEL-010");
    await done(w.creator, keep);
    expect((await done(w.creator, p)).deleted_count).toBe(1); // 子が 0 件
    expect(await isDeleted(p)).toBe(true);
  });

  it("K488-API-024 ログインしていない：401。1 分に 61 回目は 429 と待つ秒数", async () => {
    const t = await w.make(w.creator);
    expect((await w.k.f.req("DELETE", `/tickets/${t}`)).status).toBe(401);
    expect(await isDeleted(t)).toBe(false);
    await withLimit(w.k, "deleteTicket", async () => {
      let last: Response | null = null;
      for (let i = 0; i < 61; i++) last = await w.del(w.viewer, t); // 403 でも回数には数える
      expect(last!.status).toBe(429);
      const sec = Number((await json(last!))["retry_after_sec"]);
      expect(Number.isInteger(sec) && sec >= 1 && sec <= 60).toBe(true);
    });
  });
});

describe("K-488 消す：失敗の手順と守り", () => {
  it("K488-API-025 手順 S1「DB に書く」が失敗（関数が使えない）：503・E-PAGE-003。消えず・承認は取り下がらず・AI は止まらない", async () => {
    const p = await fresh("書けない人");
    const pc = await w.pcOf(p);
    const t = await w.make(p);
    await w.approval(t, p);
    const { runId } = await w.runningRun(p, pc, t);
    await w.k.f.admin.query("revoke execute on function app.ticket_delete(uuid, text, uuid, text) from kaname_app");
    try {
      const r = await w.del(p, t);
      expect(r.status).toBe(503);
      expect(await code(r)).toBe("E-PAGE-003");
    } finally {
      await w.k.f.admin.query("grant execute on function app.ticket_delete(uuid, text, uuid, text) to kaname_app");
    }
    expect(await isDeleted(t)).toBe(false);
    expect(
      await w.k.n("select count(*) as n from approvals where ticket_id = $1 and withdrawn_at is not null", [t]),
    ).toBe(0);
    expect((await q("select status_id from action_runs where id = $1", [runId]))[0]!["status_id"]).toBe("running");
    expect(await w.audit("tickets.delete", t)).toHaveLength(0);
  });

  it("K488-API-026 手順 S2「証跡」が失敗（証跡の書き込みが例外）：503・E-PAGE-003。同じ取引なので、消えず・付け替えも取り下げも止めるのも全部戻る", async () => {
    const p = await fresh("証跡が落ちる人");
    const pc = await w.pcOf(p);
    const parent = await w.make(p);
    const c = await w.make(p, { parent });
    const dest = await w.make(p);
    await w.approval(parent, p);
    const { runId } = await w.runningRun(p, pc, parent);
    await w.k.f.admin.query(
      `create or replace function public.k488_fail_audit() returns trigger language plpgsql as $$
       begin if new.action = 'tickets.delete' then raise exception 'K-488 試験：証跡が書けない'; end if; return new; end $$`,
    );
    await w.k.f.admin.query(
      "create trigger k488_fail_audit before insert on audit_events for each row execute function public.k488_fail_audit()",
    );
    try {
      const r = await w.del(p, parent, { children: "move", parent_id: dest });
      expect(r.status).toBe(503);
      expect(await code(r)).toBe("E-PAGE-003");
    } finally {
      await w.k.f.admin.query("drop trigger if exists k488_fail_audit on audit_events");
      await w.k.f.admin.query("drop function if exists public.k488_fail_audit()");
    }
    expect(await isDeleted(parent)).toBe(false);
    expect((await w.row(c)).parent_ticket_id).toBe(parent);
    expect(
      await w.k.n("select count(*) as n from approvals where ticket_id = $1 and withdrawn_at is not null", [parent]),
    ).toBe(0);
    expect((await q("select status_id from action_runs where id = $1", [runId]))[0]!["status_id"]).toBe("running");
  });

  it("K488-API-027 手順「知らせ」は出さない：消しても受け箱の行は 1 つも増えない（取り下げた承認の承認する人にも。止めた AI の担当者の分は K-464 の引き金がつながる K-597 の K597-X1-03 が見る）", async () => {
    const t = await w.make(w.creator);
    await w.approval(t, w.creator);
    const before = await notices();
    await done(w.creator, t);
    expect(await notices()).toBe(before);
  });

  it("K488-API-028 DB の関数の守り（2 層目）：security definer・search_path に pg_temp・public から外し kaname_app だけに渡す。edit の無い人・別の会社の文脈で直に呼ぶと { ok: false }・何も消えない。前の関数 app.ticket_soft_delete は残っている", async () => {
    const fn = (
      await q<{ definer: boolean; cfg: string[] | null; pub: boolean; app: boolean }>(
        `select p.prosecdef as definer, p.proconfig as cfg, has_function_privilege('public', p.oid, 'execute') as pub,
                has_function_privilege('kaname_app', p.oid, 'execute') as app
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'ticket_delete'`,
      )
    )[0]!;
    expect(fn.definer).toBe(true);
    expect(fn.cfg?.join(",") ?? "").toMatch(/search_path=.*pg_temp/);
    expect(fn.pub).toBe(false);
    expect(fn.app).toBe(true);
    expect(
      (
        await q(
          "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'ticket_soft_delete'",
        )
      ).length,
    ).toBe(1);
    const t = await w.make(w.creator);
    const call = async (tenantId: string, userId: string) => {
      const c = await w.k.f.pool.connect();
      try {
        await c.query("begin");
        await c.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', 'member', true)",
          [tenantId, userId],
        );
        const r = (
          await c.query<{ v: Record<string, unknown> }>("select app.ticket_delete($1, null, null, null) as v", [t])
        ).rows[0]!.v;
        await c.query("rollback");
        return r;
      } finally {
        c.release();
      }
    };
    expect(await call(w.k.T.tenantId, w.viewer.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await call(w.k.O.tenantId, w.outsider.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await isDeleted(t)).toBe(false);
  });
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

describe("K-488 消す：契約の問い合わせ", () => {
  it("K488-API-030 契約の問い合わせ（作り直した openapi.yaml の deleteTicket）：children の enum は '' と move・cascade・detach の 4 つちょうど・parent_id は format uuid・reason は maxLength 400。3 つとも任意で、422 に契約に書けない決まりの印が無い", () => {
    const yaml = readFileSync(join(ROOT, "08_api", "openapi.yaml"), "utf8");
    const start = yaml.indexOf("\n  /api/v1/tickets/{id}:\n");
    expect(start, "openapi.yaml に /api/v1/tickets/{id} が無い").toBeGreaterThan(-1);
    const after = yaml.slice(start + 1);
    const end = after.slice(1).search(/\n {2}\/\S/);
    const path = end < 0 ? after : after.slice(0, end + 1);
    const del = path.slice(path.indexOf("\n    delete:\n") + 1);
    expect(del.startsWith("    delete:"), "deleteTicket（delete）が無い").toBe(true);
    const block = del.split(/\n {4}(?:get|post|put|patch):\n/)[0]!;
    expect(block).not.toMatch(/x-unexpressible-422/);
    const param = (name: string) => {
      const m = new RegExp(`\\n {6}- name: ${name}\\n([\\s\\S]*?)(?=\\n {6}- name: |\\n {6}[a-z-]+:|$)`).exec(block);
      expect(m, `問い合わせ ${name} が契約に無い`).not.toBeNull();
      return m![1]!;
    };
    const children = param("children");
    expect(children).toMatch(/in: query/);
    expect(children).toMatch(/allowEmptyValue: true/);
    expect(children).not.toMatch(/required: true/);
    const values = [...children.slice(children.indexOf("enum:")).matchAll(/\n {10}- ('?[a-z]*'?)/g)].map((x) =>
      x[1]!.replace(/'/g, ""),
    );
    expect(values).toEqual(["", "move", "cascade", "detach"]);
    const parent = param("parent_id");
    expect(parent).toMatch(/in: query/);
    expect(parent).toMatch(/format: uuid/);
    expect(parent).not.toMatch(/required: true/);
    const reason = param("reason");
    expect(reason).toMatch(/in: query/);
    expect(reason).toMatch(/maxLength: 400/);
    expect(reason).not.toMatch(/required: true/);
  });
});
