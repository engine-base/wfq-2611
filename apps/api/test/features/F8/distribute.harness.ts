// 段 9「上から配る」（K-409 人に配る・K-410 グループに配る／グループに来たものを引き取る）の口の試験の共通の土台（K-409 が carry で運ぶ・K-410 が使う）。
//   行（it）は葉ごとのファイル distribute-person.test.ts（K-409）・distribute-group.test.ts（K-410）にある。土台は各ファイルの頭で setupDistribute() を 1 回呼ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
//
// 組み立ては K-57・K-60 の土台（../fixture.ts）と同じ：本物の Postgres（migration を全部当てる）・本物の口の入口（createApp と契約の op）・
//   本物の口の振る舞い（葉ごとの hooks のファイルの register・K-326）。画面のログインだけは偽（Bearer に会社・人・役と、取り直しの時刻 :su= を書ける）。
//   メールの送出（関門 C6）だけは試験の偽（貯める・failMailTo の宛ては送れなかったことにする）。
//
// 口の振る舞いの読み込みは、試験の本体（it の中）の h.ready() で 1 回だけする。実装の前（切る段の smoke）に、
//   まだ無いファイルを土台の頭で読みに行って準備ごと落とさないため（準備の赤と本体の赤を分ける・answer=8f745003d023）。
//
// 試験が前提にする形（K-401 が作る置き場・07_functional/段9-F8/切り方.md の 1 章）:
//   口の登録  apps/api/src/hooks/handovers.ts（K-401）の register：createTicketHandover・answerTicketHandover ほか段 9 の口
//            apps/api/src/hooks/handover-claim.ts（K-410）の register：claimTicketHandover（グループに来たものを引き取る・人を決める）
//   入力の形  createTicketHandover  POST /tickets/:id/handovers ← { kind, to_member_id?, to_scope_id?, reason, ask? }（K-401 が作り直す TicketHandoversInput）
//            answerTicketHandover  PATCH /ticket_handovers/:id ← { decision: "accept" | "decline", decline_reason? }（K-401 が作り直す答える入力）
//            claimTicketHandover   POST /ticket_handovers/:id/claim ← { member_id? }（K-410・無ければ自分）
//   ★K-401 の入力の欄の名前が上と違えば、下の createBody・answerBody の 2 つだけを K-401 の形に合わせる（行の中身は変えない・切る段で直す）
//   共通の断り（理由が空・待っている渡しがある・AI が動いている）の番号は K-401 の物。試験は番号を決め打ちせず、答えの code を errors.json で引いて文を見る（msg）
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";
import { createRepository } from "@kaname/db/repository";
import type { TenantContext } from "@kaname/db/context";
import { createDeviceResolver } from "@kaname/auth/resolver";
import { createApp } from "../../../src/app.js";
import { withDevice } from "../../../src/middleware/tenant.js";
import type { Hook } from "../../../src/contract/deps.js";
import type { HookDeps, HookModule } from "../../../src/hooks/registry.js";
import { makeFixture, nextIp, type Fixture, type Person } from "../fixture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");
const HOOKS_DIR = join(HERE, "..", "..", "..", "src", "hooks");
/** 段 9 の口の hooks のファイル（在る物だけ読む。K-410 の物は K-410 が入るまで無い） */
const HOOK_FILES = ["handovers", "handover-claim"] as const;

// ---- 決めた文（決定ログ D-148・errors.json）----
/** 待っている渡しが在るときの断り（D-148.20）。〇〇は相手の名前 */
export const WAITING_TEXT = "返事を待っています";
/** AI が動いている・承認待ちのチケット（D-148.6） */
export const AI_RUNNING_TEXT = "AI の実行（承認）が終わってから渡してください";
/** 配る小窓の「配る」の知らせ（受け箱の行の種類） */
export const EV = {
  distributed: "handover.distributed", // 配られた人へ（受け箱＋メール）
  reassigned: "handover.reassigned", // 前の担当者へ（受け箱の行だけ・代表に聞くこと 1）
  declined: "handover.declined", // 配った人へ（受け箱＋メール）
  accepted: "handover.accepted", // 配った人へ（受け箱の行だけ）
  done: "handover.distributed_done", // 配ったチケットが完了 → 配った人へ（受け箱の行だけ・D-125.99）
  groupDistributed: "handover.group_distributed", // グループの権限を持つ人へ（受け箱＋メール）
  claimed: "handover.claimed", // 配った人へ（受け箱の行だけ）
} as const;

const ERRORS = (
  JSON.parse(readFileSync(join(ROOT, "07_qa/test-specs/errors.json"), "utf8")) as {
    errors: { id: string; message: string }[];
  }
).errors;
/** errors.json の文（code が無ければ目立つ字を返す） */
export const msg = (code: unknown): string =>
  ERRORS.find((e) => e.id === code)?.message ?? `（errors.json に ${String(code)} が無い）`;

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}
export type J = Record<string, unknown> & { data?: Record<string, unknown> };

export interface DistHarness {
  f: Fixture;
  /** 口の振る舞いを読み込む（各 it の頭で呼ぶ。2 回目からは何もしない） */
  ready: () => Promise<void>;
  limits: Record<string, number>;
  mails: SentMail[];
  /** この宛てへのメールは送れなかったことにする */
  failMailTo: Set<string>;
  T: { tenantId: string; rootScope: string };
  /** 受託開発のグループ（T のいちばん上のグループの子・番号の頭 JD） */
  JD: string;
  O: { tenantId: string; rootScope: string };
  people: Record<
    "boss" | "mgr" | "suzuki" | "viewer" | "requester" | "stopped" | "jdMgr" | "jdMember" | "admin" | "outsider",
    Person & { email: string }
  >;
  auth: (p: Person, o?: { su?: number }) => Record<string, string>;
  req: (method: string, path: string, o?: { body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
  json: (r: Response) => Promise<J>;
  ticket: (o?: {
    assignee?: Person;
    scope?: string;
    tenant?: string;
    title?: string;
    stage?: string;
    parent?: string;
  }) => Promise<{ id: string; number: string }>;
  createBody: (o: {
    kind: string;
    to_member_id?: string;
    to_scope_id?: string;
    reason?: unknown;
    ask?: string;
  }) => Record<string, unknown>;
  answerBody: (accept: boolean, reason?: unknown) => Record<string, unknown>;
  distribute: (p: Person, ticketId: string, body: Record<string, unknown>, o?: { key?: string }) => Promise<Response>;
  answer: (p: Person, handoverId: string, body: Record<string, unknown>) => Promise<Response>;
  claim: (p: Person, handoverId: string, body?: Record<string, unknown>, o?: { key?: string }) => Promise<Response>;
  /** 待っている渡しの行を DB に直に置く（合意ありで配った形・グループに配った形を作る） */
  waiting: (o: {
    ticketId: string;
    kind: string;
    from: Person;
    toMember?: Person;
    toScope?: string;
    reason?: string;
  }) => Promise<string>;
  handover: (id: string) => Promise<Record<string, unknown> | undefined>;
  handoversOf: (ticketId: string) => Promise<Record<string, unknown>[]>;
  assigneeOf: (ticketId: string) => Promise<string>;
  /** その人の受け箱の行（種類で絞る） */
  notes: (memberId: string, kind: string) => Promise<Record<string, unknown>[]>;
  audits: (ticketId: string, action: string) => Promise<number>;
  num: (sql: string, p?: unknown[]) => Promise<number>;
}

export function setupDistribute(prefix: string): DistHarness {
  const h = {} as DistHarness;
  const hooks: Record<string, Hook> = {};
  const limits: Record<string, number> = {};
  const mails: SentMail[] = [];
  const failMailTo = new Set<string>();
  let app: ReturnType<typeof createApp>;
  let loading: Promise<void> | null = null;

  beforeAll(async () => {
    const f = await makeFixture();
    h.f = f;
    // 偽の画面のログインに本人確認の時刻（:su=）を足せる形（approve-complete.harness.ts と同じ）
    const web = async (hd: Headers) => {
      const m = /^Bearer fake:(member|ops|client):([0-9a-f-]{36}):([0-9a-f-]{36})(?::su=(\d+))?$/.exec(
        hd.get("authorization") ?? "",
      );
      if (!m) return null;
      const ctx: TenantContext = {
        tenantId: m[2]!,
        userId: m[3]!,
        role: m[1] as TenantContext["role"],
        stepUpAt: m[4] ? new Date(Number(m[4])) : null,
      };
      return { ctx, termsPending: false, sessionId: "", authUserId: "" };
    };
    Object.assign(hooks, f.hooks);
    app = createApp({
      version: "test",
      repo: await createRepository(f.pool),
      resolve: withDevice(web, createDeviceResolver(f.pool)) as never,
      contract: { hooks, limits },
    });
    for (const op of ["createTicketHandover", "answerTicketHandover", "claimTicketHandover"]) limits[op] = 10_000;

    const one = async (sql: string, p: unknown[]) => (await f.admin.query<{ id: string }>(sql, p)).rows[0]!.id;
    h.T = await f.company(`${prefix} の会社`, "EG");
    h.O = await f.company(`${prefix} の別の会社`, "OT");
    h.JD = await one(
      "insert into scopes (tenant_id, parent_id, name, ticket_prefix) values ($1, $2, '受託開発', 'JD') returning id",
      [h.T.tenantId, h.T.rootScope],
    );
    const make = async (
      key: string,
      name: string,
      o: {
        scope?: string;
        tenant?: string;
        role?: string;
        ability?: "edit" | "view";
        scopeRole?: string;
        stopped?: boolean;
      },
    ) => {
      const tenant = o.tenant ?? h.T.tenantId;
      const scope = o.scope ?? h.T.rootScope;
      // メールの宛ては認証の側の利用者（kaname_auth."user"）から引く（members に email の列は無い）。setup-tasks.test.ts と同じ入れ方
      const authUserId = randomUUID(); // 流し直しても重ならない（同じ DB に前の回の利用者が残る）
      const email = `${key}-${authUserId.slice(0, 8)}@example.com`;
      await f.admin.query(
        'insert into kaname_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled") values ($1, $2, $3, true, now(), now(), false)',
        [authUserId, name, email],
      );
      const p = await f.person(tenant, scope, { name, ticketAbility: o.ability ?? "edit", authUserId });
      await f.admin.query(
        "insert into tenant_memberships (tenant_id, member_id, auth_user_id, role, status) values ($1, $2, $3, $4, $5)",
        [tenant, p.id, authUserId, o.role ?? "member", o.stopped ? "suspended" : "active"],
      );
      if (o.scopeRole)
        await f.admin.query(
          "insert into scope_memberships (tenant_id, scope_id, member_id, role) values ($1, $2, $3, $4)",
          [tenant, scope, p.id, o.scopeRole],
        );
      if (o.stopped)
        await f.admin.query("update members set suspended_at = now(), suspended_by = id where id = $1", [p.id]);
      return { ...p, email };
    };
    h.people = {
      boss: await make("boss", "高本", {}),
      mgr: await make("mgr", "佐藤", { scopeRole: "manager" }),
      suzuki: await make("suzuki", "鈴木", {}),
      viewer: await make("viewer", "山口", { role: "viewer", ability: "view" }),
      requester: await make("requester", "ゲスト", { role: "requester", ability: "view" }),
      stopped: await make("stopped", "止めた人", { stopped: true }),
      jdMgr: await make("jdmgr", "田中", { scope: h.JD, scopeRole: "manager" }),
      jdMember: await make("jdmember", "中村", { scope: h.JD }),
      admin: await make("admin", "管理者", { role: "admin" }),
      outsider: await make("outsider", "別の会社の人", { tenant: h.O.tenantId, scope: h.O.rootScope }),
    };
  }, 120_000);
  afterAll(async () => {
    await h.f?.close();
  });

  h.limits = limits;
  h.mails = mails;
  h.failMailTo = failMailTo;
  h.ready = async () => {
    loading ??= (async () => {
      const repo = await createRepository(h.f.pool);
      const d = {
        appPool: h.f.pool,
        repo,
        mailer: async (m: SentMail) => {
          if (failMailTo.has(m.to)) throw new Error("送れなかった（試験）");
          mails.push({ to: m.to, subject: m.subject, text: m.text });
        },
        config: { env: "test", webBaseUrl: "http://localhost:3000", opsEmail: "ops@example.com" },
      } as unknown as HookDeps;
      for (const name of HOOK_FILES) {
        const file = join(HOOKS_DIR, `${name}.ts`);
        if (!existsSync(file)) continue;
        const mod = (await import(file)) as { register: HookModule };
        Object.assign(hooks, mod.register.make(d));
      }
    })();
    await loading;
  };
  h.auth = (p, o = {}) => ({
    authorization: `Bearer fake:member:${p.tenantId}:${p.id}${o.su === undefined ? "" : `:su=${o.su}`}`,
  });
  h.req = (method, path, o = {}) =>
    Promise.resolve(
      app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(o.headers ?? {}) },
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      }),
    );
  h.json = async (r) => (await r.clone().json()) as J;
  h.num = async (sql, p = []) => Number((await h.f.admin.query<{ n: string }>(sql, p)).rows[0]!.n);
  h.ticket = async (o = {}) => {
    const tenant = o.tenant ?? h.T.tenantId;
    const scope = o.scope ?? h.T.rootScope;
    const q = async (sql: string, p: unknown[]) => (await h.f.admin.query<{ id: string }>(sql, p)).rows[0]!.id;
    const kind = await q(
      "select id from ticket_kinds where tenant_id = $1 and name = 'タスク' and deleted_at is null",
      [tenant],
    );
    const stage = await q("select id from ticket_stages where tenant_id = $1 and key = $2", [
      tenant,
      o.stage ?? "doing",
    ]);
    const r = await h.f.admin.query<{ id: string; number: string }>(
      `insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, assignee_member_id, created_by, parent_ticket_id)
       values ($1, $2, '', $3, $4, $5, $6, $6, $7) returning id, number`,
      [
        tenant,
        scope,
        kind,
        stage,
        o.title ?? "問い合わせ（山田様）に一次返信する",
        (o.assignee ?? h.people.boss).id,
        o.parent ?? null,
      ],
    );
    return r.rows[0]!;
  };
  h.createBody = (o) => {
    const b: Record<string, unknown> = {
      kind: o.kind,
      reason: o.reason === undefined ? "来週の展示会の準備を優先してもらうため" : o.reason,
    };
    if (o.to_member_id) b["to_member_id"] = o.to_member_id;
    if (o.to_scope_id) b["to_scope_id"] = o.to_scope_id;
    if (o.ask) b["ask"] = o.ask;
    return b;
  };
  h.answerBody = (accept, reason) =>
    accept
      ? { decision: "accept" }
      : { decision: "decline", ...(reason === undefined ? {} : { decline_reason: reason }) };
  h.distribute = (p, ticketId, body, o = {}) =>
    h.req("POST", `/tickets/${ticketId}/handovers`, {
      body,
      headers: { ...h.auth(p), ...(o.key ? { "idempotency-key": o.key } : {}) },
    });
  h.answer = (p, id, body) => h.req("PATCH", `/ticket_handovers/${id}`, { body, headers: h.auth(p) });
  h.claim = (p, id, body = {}, o = {}) =>
    h.req("POST", `/ticket_handovers/${id}/claim`, {
      body,
      headers: { ...h.auth(p), ...(o.key ? { "idempotency-key": o.key } : {}) },
    });
  h.waiting = async (o) => {
    const t = await h.f.admin.query<{ tenant_id: string }>("select tenant_id from tickets where id = $1", [o.ticketId]);
    const r = await h.f.admin.query<{ id: string }>(
      `insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_member_id, to_scope_id, reason, state, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'waiting', $4) returning id`,
      [
        t.rows[0]!.tenant_id,
        o.ticketId,
        o.kind,
        o.from.id,
        o.toMember?.id ?? null,
        o.toScope ?? null,
        o.reason ?? "試験の理由",
      ],
    );
    return r.rows[0]!.id;
  };
  h.handover = async (id) => (await h.f.admin.query("select * from ticket_handovers where id = $1", [id])).rows[0];
  h.handoversOf = async (ticketId) =>
    (await h.f.admin.query("select * from ticket_handovers where ticket_id = $1 order by created_at", [ticketId])).rows;
  h.assigneeOf = async (ticketId) =>
    (await h.f.admin.query<{ a: string }>("select assignee_member_id as a from tickets where id = $1", [ticketId]))
      .rows[0]!.a;
  h.notes = async (memberId, kind) =>
    (
      await h.f.admin.query(
        "select * from notifications where member_id = $1 and event_kind_id = $2 and deleted_at is null order by created_at",
        [memberId, kind],
      )
    ).rows;
  h.audits = (ticketId, action) =>
    h.num("select count(*) as n from audit_events where target_id = $1 and action = $2", [ticketId, action]);
  return h;
}
