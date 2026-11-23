// K-487「消す前の下見（previewTicketDelete）」の単体の試験（口・本物の DB）。名前の頭の行 ID（K487-API-…）は 11_tickets/K-487.md の行の表と 1 対 1。
// 口：GET /api/v1/tickets/:id/delete-preview → 200 { data: TicketDeletePreview }
//   { children, descendants, attachments, artifacts, pending_approvals, links, running_runs, descendant_pending_approvals, descendant_running_runs, restorable_until }
//   （件数は整数・restorable_until は 30 日後の ISO）
//   消す人（作った人か、そのグループで tickets の edit を持つ人・D-125.62・PM の決め P14）だけが読める。承認待ち・添付・成果物・つながり・走っている実行は、そのチケット自身の物を数える。
//   子・孫の分は別の 2 つ（descendant_pending_approvals・descendant_running_runs＝「一緒に消す」を選んだときに取り下げ・止まる分）。子と孫の数え方は消す口（K-488）と同じ
//   （DB の関数で、呼んだ人に見えない子も全部数える。つながりだけは呼んだ人に見える相手との分）。
// 土台は ticket-delete.harness.ts（K-62 の試験の道具の上・口の振る舞いは apps/api/src/hooks/ticket-delete-preview.ts を最初の要求のときに読む）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { data, json, setupDelete, withLimit, type DeleteWorld } from "./ticket-delete.harness.js";

let w: DeleteWorld;
beforeAll(async () => {
  w = await setupDelete(["ticket-delete-preview"]);
}, 90_000);
afterAll(async () => {
  await w?.k.close();
});

type Preview = {
  children: number;
  descendants: number;
  attachments: number;
  artifacts: number;
  pending_approvals: number;
  links: number;
  running_runs: number;
  descendant_pending_approvals: number;
  descendant_running_runs: number;
  restorable_until: string;
};
const KEYS = [
  "artifacts",
  "attachments",
  "children",
  "descendant_pending_approvals",
  "descendant_running_runs",
  "descendants",
  "links",
  "pending_approvals",
  "restorable_until",
  "running_runs",
];
const ok = async (p: Parameters<DeleteWorld["preview"]>[0], id: string): Promise<Preview> => {
  const r = await w.preview(p, id);
  expect(r.status, await r.clone().text()).toBe(200);
  return data<Preview>(r);
};
const setDeleted = (id: string, when = "now()") =>
  w.k.f.admin.query(`update tickets set deleted_at = ${when}, deleted_by = $2 where id = $1`, [id, w.creator.id]);

describe("K-487 消す前の下見：件数", () => {
  it("K487-API-001 何も付いていないチケットを作った人が下見：200・件数はどれも 0・restorable_until は今から 30 日後。答えの鍵は 10 個ちょうど・Cache-Control は private と no-store", async () => {
    const t = await w.make(w.creator);
    const r = await w.preview(w.creator, t);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(r.headers.get("cache-control") ?? "").toMatch(/private/);
    expect(r.headers.get("cache-control") ?? "").toMatch(/no-store/);
    const v = (await json(r))["data"] as Preview;
    expect(Object.keys(v).sort()).toEqual(KEYS);
    expect(v).toMatchObject({
      children: 0,
      descendants: 0,
      attachments: 0,
      artifacts: 0,
      pending_approvals: 0,
      links: 0,
      running_runs: 0,
      descendant_pending_approvals: 0,
      descendant_running_runs: 0,
    });
    const days = (Date.parse(v.restorable_until) - Date.now()) / 86400_000;
    expect(Number.isNaN(days)).toBe(false);
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThan(30.01);
  });

  it("K487-API-002 子と孫：親の下見は children が直接の子の数・descendants が子と孫の合計。消した子は数えない", async () => {
    const p = await w.make(w.creator);
    const c1 = await w.make(w.creator, { parent: p });
    const c2 = await w.make(w.creator, { parent: p });
    await w.make(w.creator, { parent: c1 }); // 孫
    const gone = await w.make(w.creator, { parent: p });
    await setDeleted(gone);
    expect(await ok(w.creator, p)).toMatchObject({ children: 2, descendants: 3 });
    expect(await ok(w.creator, c1)).toMatchObject({ children: 1, descendants: 1 });
    expect(await ok(w.creator, c2)).toMatchObject({ children: 0, descendants: 0 });
  });

  it("K487-API-003 添付：そのチケットの添付（owner_type ticket）だけを数える。消した添付・ほかのチケットの添付は数えない", async () => {
    const t = await w.make(w.creator);
    const other = await w.make(w.creator);
    await w.attachment(t, w.creator);
    const b = await w.attachment(t, w.creator);
    const gone = await w.attachment(t, w.creator);
    await w.attachment(other, w.creator);
    await w.k.f.admin.query("update attachments set deleted_at = now() where id = $1", [gone]);
    expect(b).toBeTruthy();
    expect((await ok(w.creator, t)).attachments).toBe(2);
    expect((await ok(w.creator, other)).attachments).toBe(1);
  });

  it("K487-API-004 成果物：そのチケットの実行が作った成果物だけを数える（仕事に結ぶ）。ほかのチケットの成果物・消した成果物は数えない", async () => {
    const pc = await w.pcOf(w.creator);
    const t = await w.make(w.creator);
    const { jobId } = await w.runningRun(w.creator, pc, t);
    await w.artifact(jobId, w.creator);
    const gone = await w.artifact(jobId, w.creator);
    await w.k.f.admin.query("update artifacts set deleted_at = now() where id = $1", [gone]);
    const other = await w.make(w.creator);
    expect((await ok(w.creator, t)).artifacts).toBe(1);
    expect((await ok(w.creator, other)).artifacts).toBe(0);
  });

  it("K487-API-005 承認待ち：決まっていない承認だけを数える。決まった承認・取り下げた承認・消した承認は数えない", async () => {
    const t = await w.make(w.creator);
    await w.approval(t, w.creator);
    await w.approval(t, w.creator, { decided: true });
    const withdrawn = await w.approval(t, w.creator);
    await w.k.f.admin.query("update approvals set withdrawn_at = now() where id = $1", [withdrawn]);
    const removed = await w.approval(t, w.creator);
    await w.k.f.admin.query("update approvals set deleted_at = now() where id = $1", [removed]);
    expect((await ok(w.creator, t)).pending_approvals).toBe(1);
  });

  it("K487-API-006 つながり：どちら向きでも数える。つながり先が消えている物・消したつながりは数えない", async () => {
    const t = await w.make(w.creator);
    const a = await w.make(w.creator);
    const b = await w.make(w.creator);
    const gone = await w.make(w.creator);
    const cut = await w.make(w.creator);
    await w.link(t, a);
    await w.link(b, t);
    await w.link(t, gone);
    await w.link(t, cut);
    await setDeleted(gone);
    await w.k.f.admin.query(
      "update ticket_links set deleted_at = now() where from_ticket_id = $1 and to_ticket_id = $2",
      [t, cut],
    );
    expect((await ok(w.creator, t)).links).toBe(2);
  });

  it("K487-API-007 走っている AI の実行：待っている・動いている・コードを待っている実行だけを数える。止まった実行は数えない", async () => {
    const pc = await w.pcOf(w.creator);
    const t = await w.make(w.creator);
    const first = await w.runningRun(w.creator, pc, t);
    expect((await ok(w.creator, t)).running_runs).toBe(1);
    const f = await w.k.finish(pc, first.jobId, { state: "stopped", reason: "止まりました" });
    expect(f.status).toBe(201);
    expect((await ok(w.creator, t)).running_runs).toBe(0);
  });

  it("K487-API-008 数えるのはそのチケット自身の物だけ：子の添付・子の承認待ちは親の件数に入らない", async () => {
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    await w.attachment(c, w.creator);
    await w.approval(c, w.creator);
    await w.link(c, p);
    expect(await ok(w.creator, p)).toMatchObject({ attachments: 0, pending_approvals: 0, links: 1, children: 1 });
    expect(await ok(w.creator, c)).toMatchObject({ attachments: 1, pending_approvals: 1, links: 1 });
  });
});

describe("K-487 消す前の下見：子・孫の分と見えない子", () => {
  it("K487-API-018 子・孫の分：descendant_pending_approvals は子と孫の決まっていない承認、descendant_running_runs は子と孫の走っている実行。そのチケット自身の分は pending_approvals・running_runs のまま。子は自分の子孫の分だけ", async () => {
    const pc = await w.pcOf(w.creator);
    const p = await w.make(w.creator);
    const c = await w.make(w.creator, { parent: p });
    const g = await w.make(w.creator, { parent: c });
    await w.approval(p, w.creator); // 自分の分
    await w.approval(c, w.creator);
    await w.approval(c, w.creator, { decided: true }); // 決まった承認は数えない
    await w.approval(g, w.creator);
    const run = await w.runningRun(w.creator, pc, c);
    expect(await ok(w.creator, p)).toMatchObject({
      pending_approvals: 1,
      running_runs: 0,
      descendant_pending_approvals: 2,
      descendant_running_runs: 1,
    });
    expect(await ok(w.creator, c)).toMatchObject({
      pending_approvals: 1, // 決まっていない 1 つだけ（決まった 1 つは数えない）
      running_runs: 1,
      descendant_pending_approvals: 1,
      descendant_running_runs: 0,
    });
    expect(await ok(w.creator, g)).toMatchObject({ descendant_pending_approvals: 0, descendant_running_runs: 0 });
    const f = await w.k.finish(pc, run.jobId, { state: "stopped", reason: "止まりました" });
    expect(f.status).toBe(201);
    expect(await ok(w.creator, p)).toMatchObject({ descendant_running_runs: 0, descendant_pending_approvals: 2 });
  });

  it("K487-API-019 見えない子：呼んだ人に見えないグループの子・孫も children・descendants と子・孫の分の件数に入る（消す口 K-488 と同じ数え方）。つながりだけは呼んだ人に見える相手との分で、見えない子とのつながりは入らない", async () => {
    const p = await w.make(w.creator);
    await w.make(w.creator, { parent: p }); // 見える子
    const hidden = await w.make(w.creator, { parent: p });
    // 担当者も付け替える（作る口は作った人を担当にするので、そのままだと作った人が担当者として見えてしまう）
    await w.k.f.admin.query(
      "update tickets set scope_id = $2, created_by = $3, assignee_member_id = $3 where id = $1",
      [hidden, w.otherScope, w.stranger.id],
    );
    const hiddenGrand = await w.make(w.stranger, { parent: hidden, scope: w.otherScope });
    await w.approval(hidden, w.stranger);
    await w.approval(hiddenGrand, w.stranger);
    await w.link(p, hidden);
    const mine = await ok(w.creator, p);
    expect(mine).toMatchObject({ children: 2, descendants: 3, descendant_pending_approvals: 2, links: 0 });
    // 見えない子の側からは、親が見えないので 404（子を覗けない）
    expect((await w.preview(w.creator, hidden)).status).toBe(404);
  });

  it("K487-API-020 DB の関数の守り（2 層目）：子・孫を数える app.ticket_descendant_counts は security definer・search_path に pg_temp・public から外し kaname_app だけに渡す。別の会社の文脈で直に呼ぶと { ok: false }・何も書かない", async () => {
    const fn = (
      await w.k.q<{ definer: boolean; cfg: string[] | null; pub: boolean; app: boolean }>(
        `select p.prosecdef as definer, p.proconfig as cfg, has_function_privilege('public', p.oid, 'execute') as pub,
                has_function_privilege('kaname_app', p.oid, 'execute') as app
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'ticket_descendant_counts'`,
      )
    )[0]!;
    expect(fn.definer).toBe(true);
    expect(fn.cfg?.join(",") ?? "").toMatch(/search_path=.*pg_temp/);
    expect(fn.pub).toBe(false);
    expect(fn.app).toBe(true);
    const t = await w.make(w.creator);
    await w.make(w.creator, { parent: t });
    const call = async (tenantId: string, userId: string) => {
      const c = await w.k.f.pool.connect();
      try {
        await c.query("begin");
        await c.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', 'member', true)",
          [tenantId, userId],
        );
        const r = (await c.query<{ v: Record<string, unknown> }>("select app.ticket_descendant_counts($1) as v", [t]))
          .rows[0]!.v;
        await c.query("rollback");
        return r;
      } finally {
        c.release();
      }
    };
    expect(await call(w.k.O.tenantId, w.outsider.id)).toMatchObject({ ok: false });
    expect(await call(w.k.T.tenantId, w.creator.id)).toMatchObject({ ok: true, children: 1, descendants: 1 });
    expect(await w.k.n("select count(*) as n from tickets where id = $1 and deleted_at is not null", [t])).toBe(0);
  });
});

describe("K-487 消す前の下見：権限と見える範囲（P14）", () => {
  it("K487-API-009 消せる人：作った人（edit の無い人でも）・グループで edit を持つ人は 200", async () => {
    const t = await w.make(w.creator);
    expect((await w.preview(w.editor, t)).status).toBe(200); // 作った人でない・edit あり
    const mine = await w.make(w.creator);
    await w.k.f.admin.query("update tickets set created_by = $2 where id = $1", [mine, w.assignee.id]);
    expect((await w.preview(w.assignee, mine)).status).toBe(200); // edit は無いが作った人
    expect((await w.preview(w.creator, mine)).status).toBe(200); // edit があるので作った人でなくても
  });

  it("K487-API-010 消せない人：見るだけの人・担当者だけの人（作った人でも edit でもない）は 403・E-DEL-001。何も書かない", async () => {
    const t = await w.make(w.creator, { assignee: w.assignee });
    // 管理者は会員にした時に役割の束で tickets の edit（会社全体）を持つ。「edit の無い管理者」を作るため、その束の行だけを一時的に失効させる（終わりに必ず戻す）
    const bundle = "grantee_member_id = $1 and target_kind_id = 'tickets' and bundle_role is not null";
    await w.k.f.admin.query(`update permissions set revoked_at = now() where ${bundle}`, [w.admin.id]);
    try {
      for (const p of [w.viewer, w.assignee, w.manager, w.admin]) {
        const r = await w.preview(p, t);
        expect(r.status, p.id).toBe(403);
        expect((await json(r)).code, p.id).toBe("E-DEL-001");
      }
    } finally {
      await w.k.f.admin.query(`update permissions set revoked_at = null where ${bundle}`, [w.admin.id]);
    }
    expect((await w.row(t)).deleted_at).toBeNull();
    expect((await w.preview(w.admin, t)).status).toBe(200); // 束の edit を持つ管理者は消せる側（edit を持つ人）
  });

  it("K487-API-011 見えない人・無い id・消した後：404（別の会社・見えないグループ・無い id・もう消えたチケット）", async () => {
    const t = await w.make(w.creator);
    expect((await w.preview(w.outsider, t)).status).toBe(404);
    expect((await w.preview(w.stranger, t)).status).toBe(404);
    expect((await w.preview(w.creator, randomUUID())).status).toBe(404);
    const gone = await w.make(w.creator);
    await setDeleted(gone);
    expect((await w.preview(w.creator, gone)).status).toBe(404);
  });

  it("K487-API-012 ログインしていない：401。1 分に 61 回目は 429 と待つ秒数", async () => {
    const t = await w.make(w.creator);
    const anon = await w.k.f.req("GET", `/tickets/${t}/delete-preview`);
    expect(anon.status).toBe(401);
    await withLimit(w.k, "previewTicketDelete", async () => {
      let last: Response | null = null;
      for (let i = 0; i < 61; i++) last = await w.preview(w.creator, t);
      expect(last!.status).toBe(429);
      const sec = Number((await json(last!))["retry_after_sec"]);
      expect(Number.isInteger(sec) && sec >= 1 && sec <= 60).toBe(true);
    });
  });
});

describe("K-487 消す前の下見：読むだけ・失敗・操作の揺れ", () => {
  it("K487-API-013 読むだけ：下見をしても何も書かない（チケットの更新時刻・証跡・承認・実行が変わらない）", async () => {
    const t = await w.make(w.creator);
    await w.approval(t, w.creator);
    const before = (await w.k.q("select updated_at from tickets where id = $1", [t]))[0]!["updated_at"];
    const audits = await w.k.n("select count(*) as n from audit_events where target_id = $1", [t]);
    for (let i = 0; i < 3; i++) await ok(w.creator, t);
    expect((await w.k.q("select updated_at from tickets where id = $1", [t]))[0]!["updated_at"]).toEqual(before);
    expect(await w.k.n("select count(*) as n from audit_events where target_id = $1", [t])).toBe(audits);
    expect(
      await w.k.n("select count(*) as n from approvals where ticket_id = $1 and withdrawn_at is not null", [t]),
    ).toBe(0);
  });

  it("K487-API-014 手順 1「DB を読む」が失敗（つながりの表を読めない）：503・E-PAGE-003。件数を一部だけ返さない", async () => {
    const t = await w.make(w.creator);
    await w.k.f.admin.query("revoke select on ticket_links from kaname_app");
    try {
      const r = await w.preview(w.creator, t);
      expect(r.status).toBe(503);
      const b = await json(r);
      expect(b.code).toBe("E-PAGE-003");
      expect(b["data"]).toBeUndefined();
    } finally {
      await w.k.f.admin.query("grant select on ticket_links to kaname_app");
    }
    expect((await w.preview(w.creator, t)).status).toBe(200);
  });

  it("K487-API-015 下見の後に状況が変わる（子が足された・承認が足された）：次の下見は新しい件数。古い答えを貯めない", async () => {
    const t = await w.make(w.creator);
    expect(await ok(w.creator, t)).toMatchObject({ children: 0, pending_approvals: 0 });
    await w.make(w.creator, { parent: t });
    await w.approval(t, w.creator);
    expect(await ok(w.creator, t)).toMatchObject({ children: 1, descendants: 1, pending_approvals: 1 });
  });

  it("K487-API-016 件数は見える人によらない：作った人と、グループで edit を持つ別の人で、承認待ち・つながり・添付の件数が同じ（グループが見える人の行の守りで読める範囲）", async () => {
    const t = await w.make(w.creator);
    await w.approval(t, w.creator);
    await w.attachment(t, w.creator);
    const c = await w.make(w.creator);
    await w.link(t, c);
    const mine = await ok(w.creator, t);
    const theirs = await ok(w.editor, t);
    expect(theirs).toMatchObject({ pending_approvals: 1, attachments: 1, links: 1 });
    expect({ ...theirs, restorable_until: "" }).toEqual({ ...mine, restorable_until: "" });
  });

  it("K487-API-017 日付は日本の暮らしに合わせない（ISO のまま）：restorable_until は日付と時刻（UTC・Z か +00:00）の字で、画面が日本時間に直す", async () => {
    const t = await w.make(w.creator);
    const v = await ok(w.creator, t);
    expect(v.restorable_until).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/);
  });
});
