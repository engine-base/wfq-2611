// 段 8「消す・戻す」（K-487 下見・K-488 消す・K-489 戻す）の試験の共通の土台（口・本物の DB）。
//   行（it）は葉ごとのファイル ticket-delete-preview.test.ts（K-487）・ticket-delete.test.ts（K-488）・ticket-restore.test.ts（K-489）にある。
//   土台は段 1 の K-62 の試験の道具 F5/delegate-kit.ts（本物の Postgres・本物の PC の印・任せる／取る／終わる）の上に、
//   口の振る舞い（葉ごとの hooks のファイル apps/api/src/hooks/ticket-delete-preview.ts・ticket-delete.ts・ticket-restore.ts の register・K-326）を足す。
//   口の振る舞いの読み込みは F3/leaf-hooks.ts で最初の要求のときに 1 回だけ（準備で読まない。実装の前の切る段の smoke で、まだ無いファイルを
//   準備で読んで準備ごと落とさないため・準備の赤と本体の赤を分ける・answer=8f745003d023）。ファイルは葉ごとの試験が自分の分だけ渡す。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。時刻は眠らずに DB の行の時刻を動かす。
import { expect } from "vitest";
import type { Person } from "../fixture.js";
import { data, delegateOk, json, makeKit, type Device, type Kit } from "../F5/delegate-kit.js";
import { leafHooks } from "../F3/leaf-hooks.js";

export { data, delegateOk, json };
export type { Device, Kit, Person };

export interface DeleteWorld {
  k: Kit;
  /** 作った人（書ける）。チケットの担当者にもなる */
  creator: Person;
  /** 同じグループで書ける人（作った人でも担当者でもない） */
  editor: Person;
  /** 見るだけの人 */
  viewer: Person;
  /** チケットの担当者になるが、書く権限は無い人 */
  assignee: Person;
  /** そのグループのマネージャー（scope_memberships の manager・見る権限） */
  manager: Person;
  /** 会社の管理者（tenant_memberships の admin・見る権限） */
  admin: Person;
  /** 別の会社の人 */
  outsider: Person;
  /** 同じ会社の別のグループ（全体の外）の人。全体のチケットは見えない */
  stranger: Person;
  /** 別のグループの id（stranger の居る所） */
  otherScope: string;
  /** チケットを作る口で 1 枚作る（親・担当者・グループ・題名を選べる）。返すのは id */
  make: (by: Person, o?: { parent?: string; assignee?: Person; scope?: string; title?: string }) => Promise<string>;
  preview: (p: Person, id: string) => Promise<Response>;
  /** 消す口。children・parent_id・reason は問い合わせの値（D-151.14） */
  del: (p: Person, id: string, q?: { children?: string; parent_id?: string; reason?: string }) => Promise<Response>;
  restore: (p: Person, id: string, body?: unknown) => Promise<Response>;
  /** チケットの列（消した印と親）を管理の接続で読む */
  row: (id: string) => Promise<{
    deleted_at: Date | null;
    deleted_by: string | null;
    parent_ticket_id: string | null;
    number: string;
    title: string;
  }>;
  /** 決まっていない承認を 1 件置く（承認する人・作った人を選べる） */
  approval: (ticketId: string, approver: Person, o?: { decided?: boolean }) => Promise<string>;
  link: (a: string, b: string) => Promise<void>;
  /** 添付（owner_type ticket）を 1 件置く */
  attachment: (ticketId: string, by: Person) => Promise<string>;
  /** そのチケットの実行が作った成果物を 1 件置く（仕事の id を結ぶ） */
  artifact: (jobId: string, by: Person) => Promise<string>;
  /** 作った人の PC をつなぐ（AI に任せるのに要る） */
  pcOf: (p: Person) => Promise<Device>;
  /** 任せて PC が取る（running）まで。返すのは実行と仕事の id */
  runningRun: (p: Person, pc: Device, ticketId: string) => Promise<{ runId: string; jobId: string }>;
  audit: (action: string, ticketId: string) => Promise<{ payload: Record<string, unknown>; actor_member_id: string }[]>;
}

const OPS = [
  "previewTicketDelete",
  "deleteTicket",
  "restoreTicket",
  "createTicket",
  "getTicket",
  "listTickets",
  "delegateTicket",
  "takeBridgeJob",
  "getJobControl",
  "finishBridgeJob",
  "listApprovalQueue",
  "getActionRun",
  "listTicketRuns",
];

/** hookFiles は拡張子なしの hooks のファイル名（例 "ticket-delete"）。ほかの葉のファイルは読まない */
export async function setupDelete(hookFiles: readonly string[]): Promise<DeleteWorld> {
  const k = await makeKit();
  leafHooks(k.f, hookFiles);
  for (const op of OPS) k.f.limits[op] = 100_000;
  const { f, T } = k;
  const person = (name: string, ability: "edit" | "view" | null) =>
    f.person(T.tenantId, T.rootScope, { name, ticketAbility: ability });
  const creator = await person("作った人", "edit");
  const editor = await person("書ける別の人", "edit");
  const viewer = await person("見るだけの人", "view");
  const assignee = await person("担当だけの人", "view");
  const manager = await person("マネージャー", "view");
  const admin = await person("管理者", "view");
  await f.admin.query(
    "insert into scope_memberships (tenant_id, member_id, scope_id, role) values ($1, $2, $3, 'manager')",
    [T.tenantId, manager.id, T.rootScope],
  );
  await f.admin.query(
    "insert into tenant_memberships (tenant_id, member_id, role, status) values ($1, $2, 'admin', 'active')",
    [T.tenantId, admin.id],
  );
  const outsider = await f.person(k.O.tenantId, k.O.rootScope, { name: "別の会社の人", ticketAbility: "edit" });
  const otherScope = (
    await f.admin.query<{ id: string }>(
      "insert into scopes (tenant_id, name, ticket_prefix) values ($1, '別のグループ', 'ZD') returning id",
      [T.tenantId],
    )
  ).rows[0]!.id;
  const stranger = await f.person(T.tenantId, otherScope, { name: "別のグループの人", ticketAbility: "edit" });

  const make: DeleteWorld["make"] = async (by, o = {}) => {
    const r = await f.req("POST", "/tickets", {
      headers: by.auth,
      body: {
        scope_id: o.scope ?? T.rootScope,
        kind_id: k.taskKind,
        title: o.title ?? "請求書を送る",
        due_on: new Date(Date.now() + 9 * 3600_000 + 3 * 86400_000).toISOString().slice(0, 10),
        assignee_member_id: by.id,
        sections: { purpose: "先方に請求書を出す", done: "送って確認が取れている", todo: "- 金額を確かめる" },
        ...(o.parent ? { parent_ticket_id: o.parent } : {}),
      },
    });
    expect(r.status, await r.clone().text()).toBe(201);
    const id = String((await data(r))["id"]);
    // 担当者は書ける人でなくてもよい（作る口は書ける人しか担当にできないので、作った後に管理の接続で付け替える）
    if (o.assignee && o.assignee.id !== by.id)
      await f.admin.query("update tickets set assignee_member_id = $2 where id = $1", [id, o.assignee.id]);
    return id;
  };
  const row: DeleteWorld["row"] = async (id) =>
    (
      await k.q("select deleted_at, deleted_by, parent_ticket_id, number, title from tickets where id = $1", [id])
    )[0] as never;
  return {
    k,
    creator,
    editor,
    viewer,
    assignee,
    manager,
    admin,
    outsider,
    stranger,
    otherScope,
    make,
    preview: (p, id) => f.req("GET", `/tickets/${id}/delete-preview`, { headers: p.auth }),
    del: (p, id, q = {}) => {
      const qs = new URLSearchParams(Object.entries(q).map(([a, b]) => [a, String(b)])).toString();
      return f.req("DELETE", `/tickets/${id}${qs ? `?${qs}` : ""}`, { headers: p.auth });
    },
    restore: (p, id, body = {}) => f.req("POST", `/tickets/${id}/restore`, { headers: p.auth, body }),
    row,
    approval: async (ticketId, approver, o = {}) =>
      (
        await f.admin.query<{ id: string }>(
          `insert into approvals (tenant_id, scope_id, ticket_id, approver_member_id, requested_by, status_id, decision, decided_at)
           select t.tenant_id, t.scope_id, t.id, $2, $2, $3, $4, case when $4::text is null then null else now() end from tickets t where t.id = $1
           returning id`,
          [ticketId, approver.id, o.decided ? "approved" : "pending", o.decided ? "approve" : null],
        )
      ).rows[0]!.id,
    link: async (a, b) => {
      await f.admin.query(
        "insert into ticket_links (tenant_id, from_ticket_id, to_ticket_id, kind) values ($1, $2, $3, 'related')",
        [T.tenantId, a, b],
      );
    },
    attachment: async (ticketId, by) =>
      (
        await f.admin.query<{ id: string }>(
          `insert into attachments (tenant_id, scope_id, owner_type, owner_id, storage_ref, mime, size, name, uploaded_by, created_by)
           select t.tenant_id, t.scope_id, 'ticket', t.id, 'ref/' || gen_random_uuid(), 'application/pdf', 10, '見積.pdf', $2, $2 from tickets t where t.id = $1
           returning id`,
          [ticketId, by.id],
        )
      ).rows[0]!.id,
    artifact: async (jobId, by) =>
      (
        await f.admin.query<{ id: string }>(
          `insert into artifacts (tenant_id, scope_id, format_id, storage_ref, source_job_id, title, owner_member_id, current_version, created_by, updated_by)
           select j.tenant_id, j.scope_id, 'md', 'ref/' || gen_random_uuid(), j.id, '請求書の下書き', $2, 1, $2, $2 from bridge_jobs j where j.id = $1
           returning id`,
          [jobId, by.id],
        )
      ).rows[0]!.id,
    pcOf: (p) => k.device(p, `${p.id.slice(0, 4)} の PC`),
    runningRun: async (p, pc, ticketId) => {
      const d = await delegateOk(k, p, ticketId);
      const job = await k.takeJob(pc);
      expect(job.job_id).toBe(d.job_id);
      return { runId: d.run_id, jobId: d.job_id };
    },
    audit: (action, ticketId) =>
      k.q(
        "select payload, actor_member_id from audit_events where action = $1 and target_id = $2 order by created_at",
        [action, ticketId],
      ) as never,
  };
}

/** 秒の単位の押しすぎの確かめで使う：上限の差し替えを一時的に外して戻す */
export async function withLimit<T>(k: Kit, op: string, fn: () => Promise<T>): Promise<T> {
  const saved = k.f.limits[op];
  delete k.f.limits[op];
  try {
    return await fn();
  } finally {
    if (saved !== undefined) k.f.limits[op] = saved;
  }
}
