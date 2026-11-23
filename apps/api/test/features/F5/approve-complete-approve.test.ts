// K-162「承認する（承認して実行の仕事を積む）」の単体の試験（口・本物の DB・本物の PC の印）。親 K-63 の試験を孫ごとに分けたもの（行 ID と中身は分ける前のまま・11_tickets/K-162.md の表のマスと分岐に 1 対 1）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。土台・道具・決めた文は ./approve-complete.harness.ts。
import { describe, expect, it } from "vitest";
import { withTenant, type TenantContext } from "@kaname/db/context";
import { pairMemberForTest } from "../../bridge_pair.js";
import {
  setupApproveComplete,
  CONF_DONE,
  MIN,
  f,
  T,
  boss,
  writer,
  json,
  one,
  num,
  auth,
  req,
  queue,
  detail,
  approve,
  take,
  lastSeen,
  stageKeyOf,
  team,
  ticket,
  delegated,
  approvalRow,
  runsOf,
  jobOf,
  messagesOf,
  approved,
  snapshot,
} from "./approve-complete.harness.js";

setupApproveComplete();

describe("K-63 承認して完了する：承認・差し戻し（口・本物の DB）", () => {
  it("K63-API-002 承認待ち（取り消せる操作）× 行の「承認する」× 承認する人：承認を記録し、実行の仕事を積む。チケットは実行中・やり取りに 1 行・証跡", async () => {
    const t = await ticket();
    const d = await delegated(t, { irreversible: false });
    const r = await approve(boss, d.approvalId);
    expect(r.status, await r.clone().text()).toBe(201);
    const a = await approvalRow(d.approvalId);
    expect(a).toMatchObject({ decision: "approve", status_id: "approved" });
    expect(a["decided_at"]).not.toBeNull();
    expect(a["resolved_at"]).not.toBeNull();
    const runs = await runsOf(t.id, "execute");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status_id: "queued", approval_id: d.approvalId });
    const job = await jobOf(runs[0]!.bridge_job_id!);
    expect(job).toMatchObject({ kind: "ticket", state_id: "queued" });
    expect(await stageKeyOf(t.id)).toBe("running");
    const msgs = await messagesOf(t.id);
    expect(msgs.filter((m) => m.kind === "system").at(-1)!.body).toContain("高本が承認しました");
    expect(
      await num("select count(*) as n from audit_events where action = 'approval.approve' and target_id = $1", [
        d.approvalId,
      ]),
    ).toBe(1);
  });

  it("K63-API-003 承認待ち × 承認して送る × 承認する人・本人確認の取り直しをしていない（一度もしていない・16 分前）：取り直しを求めずに承認し、実行の仕事を積む（D-128.177）", async () => {
    for (const su of [undefined, Date.now() - 16 * MIN]) {
      const t = await ticket();
      const d = await delegated(t, { irreversible: true });
      const r = await req("POST", `/approvals/${d.approvalId}/approve`, { body: {}, headers: auth(boss, { su }) });
      expect(r.status, await r.clone().text()).toBe(201);
      expect((await json(r))["code"]).not.toBe("STEP_UP_REQUIRED");
      expect((await approvalRow(d.approvalId))["decision"]).toBe("approve");
      expect(await runsOf(t.id, "execute")).toHaveLength(1);
    }
  });

  it("K63-API-004 承認待ち（取り消せる操作として置かれた行）× 承認する：承認の行は irreversible true で残る（取り消せないの印・D-128.177）", async () => {
    const t = await ticket();
    const d = await delegated(t, { irreversible: false });
    expect((await approve(boss, d.approvalId)).status).toBe(201);
    const row = await one<{ irreversible: boolean; decision: string }>(
      "select irreversible, decision from approvals where id = $1",
      [d.approvalId],
    );
    expect(row).toEqual({ irreversible: true, decision: "approve" });
    const t2 = await ticket();
    const d2 = await delegated(t2, { irreversible: true });
    const g = await detail(boss, d2.approvalId);
    expect(JSON.stringify(((await json(g)).data as Record<string, unknown>)["cautions"])).toContain("取り消せません");
    expect((await approve(boss, d2.approvalId)).status).toBe(201);
    expect(
      (await one<{ irreversible: boolean }>("select irreversible from approvals where id = $1", [d2.approvalId]))
        .irreversible,
    ).toBe(true);
  });

  it("K63-API-005 承認待ち（任せた人と承認する人が別の人）× 承認する → PC が取りに来る：実行の仕事は任せた人の PC だけが受け取る。承認した人の PC・ほかの人の PC には渡らない（D-128.176・D-128.156）", async () => {
    const approver = await team("高本（承認する人）");
    const other = await team("佐藤（ほかの人）");
    const t = await ticket({ assignee: approver.by });
    const d = await delegated(t);
    await lastSeen(d.pc.sid, 120);
    expect((await approve(approver.by, d.approvalId)).status).toBe(201);
    const run = (await runsOf(t.id, "execute"))[0]!;
    expect((await jobOf(run.bridge_job_id!))["member_id"]).toBe(d.by.id);
    // 承認した人の PC はつながっていても受け取らない。ほかの人の PC も
    expect(await take(approver.pc)).toBeNull();
    expect(await take(other.pc)).toBeNull();
    expect((await jobOf(run.bridge_job_id!))["state_id"]).toBe("queued");
    // 任せた人の PC が取りに来たら渡る（同じ続きの id）
    await lastSeen(d.pc.sid, 1);
    const job = await take(d.pc);
    expect(job?.id).toBe(run.bridge_job_id);
    expect(job?.["agent_session_id"]).toBe(d.agentSession);
    const taken = await one<{ taken_session_id: string }>("select taken_session_id from bridge_jobs where id = $1", [
      run.bridge_job_id,
    ]);
    expect(taken.taken_session_id).toBe(d.pc.sid);
  });

  it("K63-API-009 承認済み × PC が閉じている：答えの pc が asleep で実行待ち。開いて取りに来たら、任せた人の PC に実行の仕事（同じ続きの id・許可のモード auto）が渡る", async () => {
    const t = await ticket();
    const d = await delegated(t);
    await lastSeen(d.pc.sid, 120);
    const r = await approve(boss, d.approvalId);
    expect(r.status).toBe(201);
    const data = (await json(r)).data as Record<string, unknown>;
    expect(data).toMatchObject({
      id: d.approvalId,
      decision: "approve",
      status_id: "approved",
      ticket_id: t.id,
      pc: "asleep",
    });
    const run = (await runsOf(t.id, "execute"))[0]!;
    expect(data["run_id"]).toBe(run.id);
    // 任せた人の PC が開いて取りに来たら渡る
    await lastSeen(d.pc.sid, 1);
    const job = await take(d.pc);
    expect(job?.id).toBe(run.bridge_job_id);
    expect(job?.["agent_session_id"]).toBe(d.agentSession);
    expect(job?.["permission_mode"]).toBe("auto");
    const row = await jobOf(run.bridge_job_id!);
    expect(row).toMatchObject({ member_id: d.by.id, state_id: "running", permission_mode: "auto" });
    expect(row["resume_session_id"]).toBe(d.pc.sid); // 作る段と同じ PC に作業セッションの記録がある（D-131.3）
  });

  it("K63-API-011 承認済み・実行待ち（24 時間を過ぎた）× 後始末を通らずに仕事を取る関数を直に呼ぶ：渡さない（守りの 2 層目）", async () => {
    const t = await ticket();
    const a = await approved(t);
    await f.admin.query("update approvals set decided_at = now() - interval '24 hours 1 minute' where id = $1", [
      a.approvalId,
    ]);
    // 直に呼んだ分は後に残さない（1 つのトランザクションで呼んで戻す）
    const cl = await f.pool.connect();
    try {
      await cl.query("begin");
      const r = await cl.query<{ job_id: string | null }>("select job_id from app.bridge_take_job($1)", [a.pc.sid]);
      expect(r.rows.map((x) => x.job_id)).not.toContain(a.execJobId);
    } finally {
      await cl.query("rollback");
      cl.release();
    }
    expect((await jobOf(a.execJobId))["state_id"]).toBe("queued");
  });

  it("K63-API-016 承認済み（決まった）× 承認するをもう一度：409・E-CONF-003。仕事は 1 つ", async () => {
    const t = await ticket();
    const d = await delegated(t);
    expect((await approve(boss, d.approvalId)).status).toBe(201);
    const r = await approve(boss, d.approvalId);
    expect(r.status).toBe(409);
    expect((await json(r))["code"]).toBe(CONF_DONE);
    expect(await runsOf(t.id, "execute")).toHaveLength(1);
  });
  it("K63-API-023 承認待ち × 押す直前にメンバーから外された・止められた：関数が今のメンバーかを見て 403・何も書かない", async () => {
    for (const col of ["deleted_at", "suspended_at"]) {
      const who = await f.person(T.tenantId, T.rootScope, { name: `外される人 ${col}`, ticketAbility: "edit" });
      const t = await ticket({ assignee: who });
      const d = await delegated(t);
      // 止めるときは止めた人も入れる（members_suspended_ck：suspended_at と suspended_by は揃って入る）
      await f.admin.query(
        col === "suspended_at"
          ? "update members set suspended_at = now(), suspended_by = $2 where id = $1"
          : "update members set deleted_at = now() where id = $1",
        col === "suspended_at" ? [who.id, boss.id] : [who.id],
      );
      const r = await approve(who, d.approvalId);
      expect(r.status, col).toBe(403);
      expect((await approvalRow(d.approvalId))["decision"]).toBeNull();
      expect(await runsOf(t.id, "execute")).toHaveLength(0);
    }
  });

  it("K63-API-036 承認待ち × 担当が替わって承認する人になった直後（入り直さない）：承認待ちに出て、そのまま押せる。承認の行の approver は今の担当者になる", async () => {
    const t = await ticket();
    const d = await delegated(t);
    // 担当を替える口（updateTicket・F4）はまだ無いので、チケットの担当の列だけを替える（承認の行は替えない）
    await f.admin.query("update tickets set assignee_member_id = $2 where id = $1", [t.id, writer.id]);
    const ids = ((await json(await queue(writer))).data as unknown as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(d.approvalId);
    expect(((await json(await queue(boss))).data as unknown as { id: string }[]).map((x) => x.id)).not.toContain(
      d.approvalId,
    );
    expect((await approve(writer, d.approvalId)).status).toBe(201);
    expect(
      (await one<{ a: string }>("select approver_member_id as a from approvals where id = $1", [d.approvalId])).a,
    ).toBe(writer.id);
  });
});

describe("K-63 承認して完了する：入力・失敗・守り（口・本物の DB）", () => {
  it("K63-API-042 失敗 × 承認の途中で DB が落ちた（実行の記録を書く所）：503。承認・仕事・段・証跡は 1 つも残らない。戻ればもう一度押せる", async () => {
    const t = await ticket({ title: "K63 壊れる 承認" });
    const d = await delegated(t, { irreversible: false });
    const before = await snapshot(t);
    await f.admin.query(`create or replace function app.k63_boom() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from tickets x where x.id = new.ticket_id and x.title like 'K63 壊れる%') then
          raise exception 'K63 の試験で壊した';
        end if;
        return new;
      end $$`);
    await f.admin.query(
      "create trigger k63_boom before insert on action_runs for each row execute function app.k63_boom()",
    );
    try {
      const r = await approve(boss, d.approvalId);
      expect(r.status).toBe(503);
      expect(await snapshot(t)).toEqual(before);
      expect((await approvalRow(d.approvalId))["decision"]).toBeNull();
    } finally {
      await f.admin.query("drop trigger if exists k63_boom on action_runs");
      await f.admin.query("drop function if exists app.k63_boom()");
    }
    expect((await approve(boss, d.approvalId)).status).toBe(201);
  });

  it("K63-API-051 守り × 承認の関数を直に呼ぶ × 承認する人でない人の member：書かない（守りの 2 層目）", async () => {
    const t = await ticket();
    const d = await delegated(t, { irreversible: false });
    const ctx: TenantContext = { tenantId: T.tenantId, userId: writer.id, role: "member", stepUpAt: new Date() };
    for (const [dec, reason] of [
      ["approve", null],
      ["return", "直して"],
    ] as const) {
      // 関数は p_member を受けず、呼んだ人（app.user_id()）で判定する
      const out = await withTenant(f.pool, ctx, (cl) =>
        cl.query<{ v: { error?: string } }>("select app.approval_decide($1, $2, $3) as v", [d.approvalId, dec, reason]),
      );
      expect(out.rows[0]!.v.error).toBe("not_approver");
    }
    expect((await approvalRow(d.approvalId))["decision"]).toBeNull();
    expect(await runsOf(t.id, "execute")).toHaveLength(0);
  });
});

describe("K-63 承認して完了する：積む仕事の中身（口・本物の DB）", () => {
  it("K63-API-059 失敗 × 守りの判定（書けるか）の所で例外になった：承認の関数は guard_failed を返し、口は通さず 503・E-PAGE-003。何も書かない（fail-closed）", async () => {
    const t = await ticket({ title: "K63 守りが壊れる" });
    const d = await delegated(t);
    const before = await snapshot(t);
    // 壊すのはこの試験の中だけ：ticket_writable を「この題名のチケットなら例外」に作り替え、finally で元の定義に戻す
    const orig = (
      await one<{ def: string }>("select pg_get_functiondef('app.ticket_writable(uuid)'::regprocedure) as def")
    ).def;
    await f.admin
      .query(`create or replace function app.ticket_writable(tid uuid) returns boolean language plpgsql stable security definer set search_path = public, app as $$
      begin
        if exists (select 1 from tickets x where x.id = tid and x.title = 'K63 守りが壊れる') then
          raise exception 'K63 の試験で守りを壊した';
        end if;
        return exists (
          select 1 from tickets x
          where x.id = tid and x.tenant_id = app.tenant_id()
            and app.ticket_draft_ok(x.draft_import_id, app.user_id())
            and (has_permission(app.user_id(), 'tickets', x.scope_id, 'edit') or x.assignee_member_id = app.user_id())
        );
      end $$`);
    try {
      // (b) 関数を直に呼ぶと guard_failed を返す（例外を外に投げない・何も書かない）
      const ctx: TenantContext = { tenantId: T.tenantId, userId: boss.id, role: "member", stepUpAt: null };
      const out = await withTenant(f.pool, ctx, (cl) =>
        cl.query<{ v: { error?: string } }>("select app.approval_decide($1, 'approve', null) as v", [d.approvalId]),
      );
      expect(out.rows[0]!.v.error).toBe("guard_failed");
      // (a) 口は decide.ts が guard_failed を 503・E-PAGE-003 に替える
      const r = await approve(boss, d.approvalId);
      expect(r.status).toBe(503);
      expect((await json(r))["code"]).toBe("E-PAGE-003");
    } finally {
      await f.admin.query(orig);
    }
    expect(await snapshot(t)).toEqual(before);
    expect((await approvalRow(d.approvalId))["decision"]).toBeNull();
  });

  it("K63-API-067 承認待ち（本人のものでない取り込みの下書きのチケット）× 一覧：書けない人の一覧にも数にも出ない（D-131.10）", async () => {
    const who = await f.person(T.tenantId, T.rootScope, { name: "下書きの担当者", ticketAbility: "edit" });
    const mine = await ticket({ assignee: who });
    const a = await delegated(mine);
    const draft = await ticket({ assignee: who });
    const d = await delegated(draft);
    // writer が取り込んだ下書き：担当者（who）でも本人のものでないので書けない（app.ticket_writable が偽）
    const imp = await one<{ id: string }>(
      "insert into ticket_imports (tenant_id, uploaded_by, scope_id, source) values ($1, $2, $3, 'generic') returning id",
      [T.tenantId, writer.id, T.rootScope],
    );
    await f.admin.query("update tickets set draft_import_id = $2 where id = $1", [draft.id, imp.id]);
    const j = await json(await queue(who));
    expect((j.data as unknown as { id: string }[]).map((x) => x.id)).toEqual([a.approvalId]);
    expect((j.meta!["counts"] as { total: number }).total).toBe(1);
    expect((await approve(who, d.approvalId)).status).toBe(403); // 出さないものは押しても 403（守りは関数の側に残る）
  });

  it("K63-API-072 承認済み・実行待ち × 任せた人の別の PC が取りに来る：仕事は渡るが agent_session_id は空（記録はその PC に無い）。同じ PC なら続きの id（D-131.3）", async () => {
    const tm = await team("2 台持つ人");
    const pc2 = await pairMemberForTest(f.admin, tm.by.id, "2 台持つ人の 2 台目");
    // 別の PC が取る
    const t1 = await ticket();
    const d1 = await delegated(t1, { by: tm }); // 作る段は 1 台目（tm.pc）が動かした
    expect((await approve(boss, d1.approvalId)).status).toBe(201);
    const run1 = (await runsOf(t1.id, "execute"))[0]!;
    expect((await jobOf(run1.bridge_job_id!))["resume_session_id"]).toBe(tm.pc.sid);
    await lastSeen(tm.pc.sid, 120); // 1 台目は閉じている
    await lastSeen(pc2.sid, 1);
    const job1 = await take(pc2);
    expect(job1?.id).toBe(run1.bridge_job_id);
    expect(job1?.["agent_session_id"]).toBeNull(); // 別の PC には作業セッションの記録が無い → 新しい作業セッションで始める
    expect(String(job1?.["prompt"])).toContain("月末の請求を出す"); // prompt（チケットの中身と記録の要約）は渡る
    expect(String(job1?.["prompt"])).toContain("承認された成果物を実行してください");
    expect((await jobOf(run1.bridge_job_id!))["taken_session_id"]).toBe(pc2.sid);
    // 同じ PC が取る
    const t2 = await ticket();
    const d2 = await delegated(t2, { by: tm });
    expect((await approve(boss, d2.approvalId)).status).toBe(201);
    const run2 = (await runsOf(t2.id, "execute"))[0]!;
    await lastSeen(pc2.sid, 120);
    await lastSeen(tm.pc.sid, 1);
    const job2 = await take(tm.pc);
    expect(job2?.id).toBe(run2.bridge_job_id);
    expect(job2?.["agent_session_id"]).toBe(d2.agentSession); // 同じ PC だけ続き
    // 行の agent_session_id は消さない（渡すか渡さないかは take が決める）
    expect((await jobOf(run1.bridge_job_id!))["agent_session_id"]).toBe(d1.agentSession);
  });

  it("K63-API-074 承認する × PC の最後の知らせから 74 秒・76 秒：答えの pc は 74 秒なら live、76 秒なら asleep（0058 の 75 秒の式・G-12）", async () => {
    for (const [sec, pc] of [
      [74, "live"],
      [76, "asleep"],
    ] as const) {
      const t = await ticket();
      const d = await delegated(t);
      await lastSeen(d.pc.sid, sec);
      const r = await approve(boss, d.approvalId);
      expect(r.status).toBe(201);
      expect(((await json(r)).data as Record<string, unknown>)["pc"], `${sec} 秒`).toBe(pc);
    }
  });
  it("K63-API-078 承認待ち × 自分で直す・止める・取り下げを直に API で × 承認する人（本人確認も直前に済み）：それまでは画面にボタンが無く、口は 501・NOT_IMPLEMENTED。承認の行・実行の仕事・段・証跡は変わらない（決める人の答え answer=75b89fd38579）", async () => {
    const t = await ticket();
    const d = await delegated(t);
    const before = await snapshot(t);
    for (const op of ["edit", "stop", "withdraw"]) {
      const r = await req("POST", `/approvals/${d.approvalId}/${op}`, {
        body: {},
        headers: auth(boss, { su: Date.now() }),
      });
      expect(r.status, `${op} ${await r.clone().text()}`).toBe(501);
      expect((await json(r))["code"], op).toBe("NOT_IMPLEMENTED");
    }
    expect(await snapshot(t)).toEqual(before);
    expect((await approvalRow(d.approvalId))["decision"]).toBeNull();
  });
});
