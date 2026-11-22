// K-388「完了したチケットを開き直す（完了 → 作業中）」の単体の試験（口・本物の DB）。
//   名前の頭の行 ID（K388-API-…）は 11_tickets/K-388.md の表と 1 対 1。土台・道具・決めた文は ./progress.harness.ts（K-387 が運んだ）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//   開き直すは updateTicket の段の欄で 完了 → 作業中 を通す形（新しい口は作らない・K-388.md の「口の決め」）。
import { describe, expect, it } from "vitest";
import type pg from "pg";
import type { Hook } from "../../../src/contract/deps.js";
import {
  setupProgress,
  CONF_DONE,
  STAGE_KIND,
  f,
  T,
  boss,
  writer,
  viewer,
  json,
  asMember,
  stageOf,
  customStage,
  doneTicket,
  patch,
  detail,
  row,
  lines,
  notices,
  snapshot,
} from "./progress.harness.js";

// 開き直した後に完了の口（K-165）がまた通ることを見るので、承認と完了の口も足す（前から在る hooks のファイル）
setupProgress(["ticket-update", "approve-complete"], {
  "approve-complete": async () => {
    const m = (await import("../../../src/hooks/approve-complete.js")) as {
      approveHooks: (p: pg.Pool) => Record<string, Hook>;
    };
    return m.approveHooks(f.pool);
  },
});

// 画面（K-395）と同じ送り方：段の鍵 doing（stage_key）。id で送っても同じ（K387-API-028）
const reopen = async (p: typeof boss, ticketId: string, extra: Record<string, unknown> = {}) =>
  patch(p, ticketId, { stage_key: "doing", ...extra });

describe("K-388 開き直す（完了 → 作業中）", () => {
  it("K388-API-001 完了 × 担当者でない書ける人が作業中を選ぶ：200・段が作業中・完了の時刻と押した人が消える・1 行「佐藤 が開き直した」・担当者に知らせ 1 つ", async () => {
    const t = await doneTicket();
    const r = await reopen(writer, t.id);
    expect(r.status, await r.clone().text()).toBe(200);
    const d = (await json(r)).data!;
    expect(d["changed"]).toBe(true);
    expect(d["stage"]).toMatchObject({ key: "doing", name: "作業中" });
    expect(d["ticket"]).toMatchObject({ completed_at: null, completed_by: null });
    expect(await row(t.id)).toMatchObject({
      stage_key: "doing",
      completed_at: null,
      completed_by: null,
      updated_by: writer.id,
    });
    const ls = await lines(t.id);
    expect(ls.map((l) => l.body)).toEqual(["佐藤 が開き直した"]);
    expect(ls[0]!.changes).toEqual([{ field: "stage", from: "完了", to: "作業中", note: "開き直した" }]);
    const ns = await notices(t.id, STAGE_KIND);
    expect(ns.map((n) => n.member_id)).toEqual([boss.id]);
    expect(ns[0]!.dedupe_key).toBe(`${STAGE_KIND}:${ls[0]!.id}`);
  });

  it("K388-API-002 担当者が自分で開き直す・実績と一緒に：200・知らせ 0・1 行「高本 が開き直した・実績を 30 分 に変えた」", async () => {
    const t = await doneTicket();
    const r = await reopen(boss, t.id, { actual_minutes: 30 });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await row(t.id)).toMatchObject({ stage_key: "doing", actual_minutes: 30, completed_at: null });
    expect((await lines(t.id)).map((l) => l.body)).toEqual(["高本 が開き直した・実績を 30 分 に変えた"]);
    expect(await notices(t.id, STAGE_KIND)).toHaveLength(0);
  });

  it("K388-API-003 開き直したチケットの詳細：段は作業中・completed は null・can.complete と can.progress は true。そのまま完了の口がまた 201 で、新しい完了の時刻が入る", async () => {
    const t = await doneTicket();
    const old = (await row(t.id)).completed_at;
    expect((await reopen(boss, t.id)).status).toBe(200);
    const d = (await json(await detail(boss, t.id))).data!;
    expect(d["stage"]).toMatchObject({ key: "doing" });
    expect(d["completed"]).toBeNull();
    expect(d["can"]).toMatchObject({ complete: true, progress: true });
    expect(d["hold"]).toBeNull();
    const c = await f.req("POST", `/tickets/${t.id}/complete`, {
      body: { todo_checked: [], todo_version: 0, conditions_confirmed: true },
      headers: boss.auth,
    });
    expect(c.status, await c.clone().text()).toBe(201);
    const now = await row(t.id);
    expect(now.stage_key).toBe("done");
    expect(now.completed_by).toBe(boss.id);
    expect(Date.parse(String(now.completed_at))).toBeGreaterThan(Date.parse(String(old)));
  });

  it("K388-API-004 完了から作業中以外（会社が足した段）を選ぶ：409 E-CONF-032・何も書かない（開き直すのは作業中だけ・⑤）", async () => {
    const t = await doneTicket();
    const review = await customStage(T.tenantId, "社内確認 2");
    const before = await snapshot(t.id);
    const r = await patch(boss, t.id, { stage_id: review });
    expect(r.status).toBe(409);
    expect((await json(r))["code"]).toBe(CONF_DONE);
    expect(await snapshot(t.id)).toEqual(before);
  });

  it("K388-API-005 同時に 2 人が開き直す：どちらも 200・changed は true が 1 つと false が 1 つ・「開き直した」の 1 行は 1 つ", async () => {
    const t = await doneTicket();
    const [a, b] = await Promise.all([reopen(boss, t.id), reopen(writer, t.id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const changed = [(await json(a)).data!["changed"], (await json(b)).data!["changed"]].sort();
    expect(changed).toEqual([false, true]);
    expect((await lines(t.id)).filter((l) => /開き直した/.test(String(l.body)))).toHaveLength(1);
    expect((await row(t.id)).stage_key).toBe("doing");
  });

  it("K388-API-006 見るだけの人：口は 403・関数を直に呼んでも not_writable・完了のまま（完了の時刻と押した人も残る）", async () => {
    const t = await doneTicket();
    const before = await snapshot(t.id);
    expect((await reopen(viewer, t.id)).status).toBe(403);
    const v = await asMember<{ v: Record<string, unknown> }>(
      viewer,
      "select app.ticket_progress_set($1, $2::jsonb) as v",
      [t.id, JSON.stringify({ stage_id: await stageOf(T.tenantId, "doing") })],
    );
    expect(v.v["error"]).toBe("not_writable");
    expect(await snapshot(t.id)).toEqual(before);
    expect(await row(t.id)).toMatchObject({ stage_key: "done", completed_by: boss.id });
  });
});
