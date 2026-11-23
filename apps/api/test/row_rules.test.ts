// 行に結ぶ言葉の条件（K-15・scripts/ci/row_rules.mjs → 契約の perm.row）を実 Postgres で確かめる。
//   1) 契約に出た条件は全部、本物の表で SQL として動く（列の名前の間違い・関数の無いものが無い）
//   2) 無い行は missing（入口は 404）
//   3) 言葉の中の人は通り、外の人は止まる（承認する人・受ける人・担当者・マネージャー・本人の代表の行で）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ENDPOINTS } from "@kaname/contracts";
import type { TenantContext } from "@kaname/db/context";
import { makeHarness, type Harness } from "./harness.js";

const DB_URL = process.env["DATABASE_URL"]!;
let h: Harness;
let admin: pg.Pool;
let boss: TenantContext, staff: TenantContext;
const NONE = "0193c5a0-0000-7000-8000-000000000000";

beforeAll(async () => {
  h = await makeHarness();
  admin = new pg.Pool({ connectionString: DB_URL, max: 2 });
  boss = { tenantId: h.S.tenantA, userId: h.S.bossA, role: "member" };
  staff = { tenantId: h.S.tenantA, userId: h.S.staffA, role: "member" };
});
afterAll(async () => {
  await admin.end();
  await h.close();
});

const rules = [
  ...new Map(
    ENDPOINTS.filter((e) => e.perm.row).map((e) => [`${e.perm.row!.table}|${e.perm.row!.sql}`, e.perm.row!]),
  ).values(),
];
const sqlOf = (op: string) => ENDPOINTS.find((e) => e.operationId === op)!.perm.row!;

describe("行に結ぶ言葉の条件（K-15）", () => {
  it.each(rules.map((r) => [`${r.table}：${r.sql.slice(0, 60)}`, r] as const))(
    "%s が本物の表で動き、無い行は missing",
    async (_n, r) => {
      expect(await h.repo.rowAllowed(staff, r.table, NONE, r.sql)).toBe("missing");
      const seeded = h.S.rows[r.table]?.visible;
      if (seeded) expect(["ok", "denied", "missing"]).toContain(await h.repo.rowAllowed(staff, r.table, seeded, r.sql));
    },
  );

  // K-63（PM の決め）：承認する人は今のチケットの担当者から引く。承認の行の approver_member_id ではなく、担当を替えて確かめる
  // K-163：差し戻し（returnApproval）も承認と同じ条件（OP_RULES.returnApproval＝今の担当者）。行の決まりは K-163 の実装で足す
  it("承認・差し戻し：今の担当者だけが承認・差し戻しできる。担当が替わったら前の担当者は denied", async () => {
    const id = await h.freshRow("approvals");
    const t = await h.freshRow("tickets");
    await admin.query("update approvals set ticket_id = $1 where id = $2", [t, id]);
    await admin.query("update tickets set assignee_member_id = $1 where id = $2", [h.S.staffA, t]);
    for (const op of ["approveApproval", "returnApproval"]) {
      const r = sqlOf(op);
      expect(await h.repo.rowAllowed(staff, r.table, id, r.sql), op).toBe("ok");
    }
    await admin.query("update tickets set assignee_member_id = $1 where id = $2", [h.S.bossA, t]);
    for (const op of ["approveApproval", "returnApproval"]) {
      const r = sqlOf(op);
      expect(await h.repo.rowAllowed(staff, r.table, id, r.sql), op).not.toBe("ok");
    }
  });

  it("承認の 1 件：AI に任せた人（requested_by）も読める（ほかの条件では通らない形で確かめる）", async () => {
    const id = await h.freshRow("approvals");
    const t = await h.freshRow("tickets");
    // チケットの担当者と作った人・承認する人を staff 以外にし、マネージャーの条件にも当たらない形にする
    await admin.query("update tickets set assignee_member_id = $1, created_by = $1 where id = $2", [h.S.bossA, t]);
    await admin.query("update approvals set ticket_id = $1, approver_member_id = $2, requested_by = $2 where id = $3", [
      t,
      h.S.bossA,
      id,
    ]);
    const r = sqlOf("getApproval");
    expect(await h.repo.rowAllowed(staff, r.table, id, r.sql)).not.toBe("ok");
    await admin.query("update approvals set requested_by = $1 where id = $2", [h.S.staffA, id]);
    expect(await h.repo.rowAllowed(staff, r.table, id, r.sql)).toBe("ok");
  });
  it("引き継ぎ：渡された相手だけが答えられる", async () => {
    const id = await h.freshRow("ticket_handovers");
    const r = sqlOf("answerTicketHandover");
    await admin.query("update ticket_handovers set to_member_id = $1 where id = $2", [h.S.staffA, id]);
    expect(await h.repo.rowAllowed(staff, r.table, id, r.sql)).toBe("ok");
    await admin.query("update ticket_handovers set to_member_id = $1 where id = $2", [h.S.bossA, id]);
    expect(await h.repo.rowAllowed(staff, r.table, id, r.sql)).not.toBe("ok");
  });

  // K-487（段 8・P14）：消す・消す前の下見の入口は「そのチケットが見える」だけ（true）。作った人か edit か（403・E-DEL-001）は、口と DB の関数が持つ
  //   （入口が担当者・作成者・マネージャーで止めると、edit を持つ別の人が通れず、消せない訳の文 E-DEL-001 も入口の汎用の 403 に奪われる）。
  //   判定そのものは K487-API-010・K488-API-003・K488-API-028 が本物の DB で見る
  it("チケットを消す・消す前の下見：入口は「見える」だけ（true）で、作った人でない担当者も通る。無い行は missing（404）", async () => {
    const id = await h.freshRow("tickets");
    await admin.query(
      "update tickets set assignee_member_id = null, created_by = $1, scope_id = $3, draft_import_id = null where id = $2",
      [h.S.bossA, id, h.S.scopeRootA],
    );
    for (const op of ["deleteTicket", "previewTicketDelete"]) {
      const r = sqlOf(op);
      expect(r.table, op).toBe("tickets");
      expect(r.sql, op).toBe("true");
      expect(await h.repo.rowAllowed(boss, r.table, id, r.sql), op).toBe("ok");
      await admin.query("update tickets set assignee_member_id = $1 where id = $2", [h.S.staffA, id]);
      expect(await h.repo.rowAllowed(staff, r.table, id, r.sql), op).toBe("ok"); // 担当者のほかは edit も作った人も要らない（判定は口と DB の関数）
      expect(await h.repo.rowAllowed(staff, r.table, NONE, r.sql), op).toBe("missing");
    }
  });

  it("本人：自分の通知だけを直せる", async () => {
    const id = await h.freshRow("notifications");
    const r = sqlOf("readNotification");
    await admin.query("update notifications set member_id = $1 where id = $2", [h.S.staffA, id]);
    expect(await h.repo.rowAllowed(staff, r.table, id, r.sql)).toBe("ok");
    await admin.query("update notifications set member_id = $1 where id = $2", [h.S.bossA, id]);
    expect(await h.repo.rowAllowed(staff, r.table, id, r.sql)).not.toBe("ok");
  });

  it("マネージャー：グループのマネージャーはそのグループの中で通り、外では止まる", async () => {
    const at = async (ctx: TenantContext, s: string) =>
      (
        await admin.query<{ ok: boolean }>(
          "select set_config('app.tenant_id', $1, false), set_config('app.user_id', $2, false), app.manages_scope($3::uuid) as ok",
          [ctx.tenantId, ctx.userId, s],
        )
      ).rows[0]!.ok;
    expect(await at(staff, h.S.scopeDeptA)).toBe(false);
    await admin.query(
      "insert into scope_memberships (tenant_id, member_id, scope_id, role, is_primary) values ($1, $2, $3, 'manager', false) on conflict (member_id, scope_id) do update set role = 'manager', deleted_at = null",
      [h.S.tenantA, h.S.staffA, h.S.scopeDeptA],
    );
    expect(await at(staff, h.S.scopeDeptA)).toBe(true);
    expect(await at(staff, h.S.scopeRootA)).toBe(false);
  });

  it("admin の口の能力の表は全部、権限の表（target_kinds）にある（無いと管理者の束に入らず、誰も呼べない）", async () => {
    const tk = new Set((await admin.query<{ key: string }>("select key from target_kinds")).rows.map((r) => r.key));
    const bad = ENDPOINTS.filter(
      (e) => e.perm.word === "admin" && !e.perm.adminOnly && !tk.has(e.perm.target ?? ""),
    ).map((e) => `${e.operationId}→${e.perm.target}`);
    expect(bad).toEqual([]);
  });
});
