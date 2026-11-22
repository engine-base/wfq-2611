// 権限の試験（ゼロトラストの決まり ZT1・ZT2・ZT4・ZT10・D-128.112）。
// 契約（@kaname/contracts の ENDPOINTS）と「誰が呼べるか」（08_api/endpoints.json の permission）を毎回読んで回すので、API が増えても古くならない。
//   1) 役の段（いま実装済み）：ログインしていない・役が合わない人は、どの API も 401／403 で止まり、hooks（副作用）まで届かない
//   2) 権限の言葉の段：admin・ops:<できること>・いつも要る本人確認は入口で（K-14）。行に結ぶ言葉は :id の行を読む段で（K-15）
//   3) 一覧・作る口の行の絞り込み（RLS）と条件つきの本人確認は apps/api/test/authz_rows.test.ts（本物の DB・K-17）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ENDPOINTS, isUuid, type EndpointDef } from "@kaname/contracts";
import type { TenantContext } from "@kaname/db/context";
import type { Repository } from "@kaname/db/repository";
import type { Vars } from "../middleware/tenant.js";
import type { ContractDeps } from "./deps.js";
import { op } from "./op.js";
import { registerAll } from "../routes/index.js";
import { ROW_EXEMPT_FIELDS } from "../../../../scripts/ci/row_rules.mjs";

type Role = TenantContext["role"];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
type Perm = { who: string; scope: string; step_up: boolean | string };
const PERMS = new Map<string, Perm>(
  (
    JSON.parse(readFileSync(join(ROOT, "08_api", "endpoints.json"), "utf8")) as {
      endpoints: { operation_id?: string; permission?: Perm }[];
    }
  ).endpoints
    .filter((e) => e.operation_id && e.permission)
    .map((e) => [e.operation_id!, e.permission!]),
);

const A = "0193c5a0-0000-7000-8000-00000000000a";
const U = "0193c5a0-0000-7000-8000-000000000001";
const FRESH = () => new Date(); // 本人確認は今した
const ctxOf = (role: Role, stepUpAt: Date | null = FRESH()): TenantContext =>
  role === "anonymous" ? { tenantId: null, userId: null, role } : { tenantId: A, userId: U, role, stepUpAt };
/** 入口の確かめの答えを選ぶ（既定は全部通す＝役の段の試験に影響しない） */
type Opts = {
  opsAllowed?: boolean;
  withHook?: boolean;
  perms?: boolean;
  caps?: string[] | "all" | null;
  stepUpAt?: Date | null;
  row?: "ok" | "missing" | "denied";
};

/** 入口だけを試す小さなアプリ。副作用に届いたら印を付ける（届いてはいけない） */
function appFor(e: EndpointDef, role: Role, opsAllowed = false, withHook = true, o: Opts = {}) {
  let reached = false;
  const perms = o.perms ?? true;
  const caps = o.caps === undefined ? "all" : o.caps;
  const repo = {
    opsAllowed: async () => opsAllowed,
    hasColumn: () => false,
    can: async () => perms,
    canAny: async () => perms,
    isAdmin: async () => perms,
    opsCaps: async () => (caps === "all" ? [e.perm.cap ?? ""] : caps),
    rowAllowed: async () => o.row ?? "ok",
  } as unknown as Repository;
  const deps: ContractDeps = {
    hooks: withHook
      ? {
          [e.operationId]: {
            before: async () => {
              reached = true;
              return { status: 418, body: {} };
            },
          },
        }
      : {},
    limiter: () => ({ take: () => true }),
    idempotency: { get: () => undefined, set: () => undefined },
  };
  const app = new Hono<Vars>();
  app.use("*", async (c, next) => {
    c.set("ctx", ctxOf(role, o.stepUpAt === undefined ? FRESH() : o.stepUpAt));
    c.set("repo", repo);
    await next();
  });
  const m = e.method.toLowerCase() as "get" | "post" | "patch" | "delete" | "put";
  app[m](e.path, op(deps, e.operationId));
  return { app, reached: () => reached };
}
/** 道の値を埋める。契約で format: uuid の道の値（registry の uuidParams・:id・:qid・:pid・:mid）は正式な uuid で埋める。
 *  入口が 3.0 で uuid を確かめる（D-129.42・K-144）ので、uuid でない値で埋めると 422 で止まり、権限の言葉・501・行の守りの段に届かない。
 *  uuid でない道の値（:v・:token・:name・:ref・:key）は今のまま x-<名前> */
const urlOf = (e: EndpointDef) =>
  e.path.replace(/:(\w+)/g, (_, n: string) => (e.uuidParams.includes(n) ? A : `x-${n}`));
async function hit(e: EndpointDef, role: Role, opsAllowed = false, withHook = true, o: Opts = {}) {
  const { app, reached } = appFor(e, role, opsAllowed, withHook, o);
  const init: RequestInit = { method: e.method, headers: { "content-type": "application/json" } };
  if (e.method === "POST" || e.method === "PATCH" || e.method === "PUT") init.body = "{}";
  const r = await app.request(urlOf(e), init);
  return { status: r.status, reached: reached() };
}

/** 役ごとに「止まるべき人」 */
const MUST_STOP: Record<EndpointDef["auth"], Role[]> = {
  public: [],
  member: ["anonymous", "client", "device"],
  ops: ["anonymous", "member", "client", "device"],
  client: ["anonymous", "member", "ops", "device"],
  device: ["anonymous", "member", "ops", "client"],
};

describe("権限の試験：道の値の埋め方（K-144）", () => {
  // 入口の uuid の確かめ（op.ts 3.0）に先に止められると、下の 403・404・501 の守りの行が確かめられなくなる（回 5 の 6 本）
  const paramsOf = (e: EndpointDef) => [...e.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  it("名前が id で終わる道の値は、全部 registry の uuidParams にある（契約の format: uuid と同じ）", () => {
    const bad = ENDPOINTS.flatMap((e) =>
      paramsOf(e)
        .filter((n) => /id$/.test(n) && !e.uuidParams.includes(n))
        .map((n) => `${e.method} ${e.path} の :${n}`),
    );
    expect(bad).toEqual([]);
  });
  it("urlOf は uuidParams の道の値を正式な uuid で埋め、ほかの道の値は uuid にしない", () => {
    const bad: string[] = [];
    let uuidSlots = 0;
    for (const e of ENDPOINTS) {
      const names = paramsOf(e);
      if (!names.length) continue;
      const re = new RegExp(`^${e.path.replace(/:(\w+)/g, "([^/]+)")}$`);
      const got = re.exec(urlOf(e));
      if (!got) {
        bad.push(`${e.method} ${e.path}：urlOf が道の形に合わない`);
        continue;
      }
      names.forEach((n, i) => {
        const v = got[i + 1]!;
        if (e.uuidParams.includes(n)) {
          uuidSlots++;
          if (!isUuid(v)) bad.push(`${e.method} ${e.path} の :${n} が uuid でない（${v}）`);
        } else if (isUuid(v)) bad.push(`${e.method} ${e.path} の :${n} が uuid で埋まった`);
      });
    }
    expect(bad).toEqual([]);
    // :qid・:pid・:mid も数に入る（:id だけではない）
    expect(uuidSlots).toBeGreaterThan(ENDPOINTS.filter((e) => e.path.includes(":id")).length);
  });
});

describe("権限の試験：役の段（契約の全 API）", () => {
  it("契約の API は全部「誰が呼べるか」を持ち、役と権限の言葉が合っている", () => {
    const bad: string[] = [];
    for (const e of ENDPOINTS) {
      const p = PERMS.get(e.operationId);
      if (!p) {
        bad.push(`${e.method} ${e.path} に権限が無い`);
        continue;
      }
      const want =
        p.who === "public"
          ? "public"
          : p.who.startsWith("ops:")
            ? "ops"
            : p.who === "client"
              ? "client"
              : p.who === "device"
                ? "device"
                : "member";
      if (want !== e.auth) bad.push(`${e.method} ${e.path}：権限 ${p.who} なのに契約の役は ${e.auth}`);
    }
    expect(bad).toEqual([]);
  });

  // 本人か PC の印で呼べる口（self_or_device・K-57）は、PC の印を止めない
  const cases = ENDPOINTS.flatMap((e) =>
    MUST_STOP[e.auth]
      .filter((role) => !(role === "device" && e.perm.word === "self_or_device"))
      .map((role) => [e, role] as const),
  );
  it.each(cases.map(([e, role]) => [`${e.method} ${e.path}`, e.auth, role, e] as const))(
    "%s（%s）は %s を止め、副作用に届かせない",
    async (_name, _auth, role, e) => {
      const r = await hit(e, role);
      expect(r.status).toBe(role === "anonymous" ? 401 : 403);
      expect(r.reached).toBe(false);
    },
  );

  it.each(ENDPOINTS.filter((e) => e.auth === "member").map((e) => [`${e.method} ${e.path}`, e] as const))(
    "%s：運営は「中を見る」の許可が無ければ止まる",
    async (_name, e) => {
      const r = await hit(e, "ops", false);
      expect(r.status).toBe(403);
      expect(r.reached).toBe(false);
    },
  );
});

describe("まだ作っていない口は止まる（fail-closed・D-128.113）", () => {
  const RIGHT: Record<EndpointDef["auth"], Role> = {
    public: "anonymous",
    member: "member",
    ops: "ops",
    client: "client",
    device: "device",
  };
  it.each(ENDPOINTS.filter((e) => !e.generic).map((e) => [`${e.method} ${e.path}`, e] as const))(
    "%s：振る舞い（hooks）が無ければ、正しい役の人が呼んでも 501 で、表の素の読み書きに落ちない",
    async (_name, e) => {
      const r = await hit(e, RIGHT[e.auth], true, false);
      expect(r.status).toBe(501);
    },
  );
});

// 会社の段の言葉（K-14）：入口で確かめる。行に結ぶ言葉は K-15（:id の行を読む段）
const RIGHT_ROLE: Record<EndpointDef["auth"], Role> = {
  public: "anonymous",
  member: "member",
  ops: "ops",
  client: "client",
  device: "device",
};
const OLD = () => new Date(Date.now() - 16 * 60 * 1000); // 16 分前

describe("権限の試験：会社の段の言葉（admin・運営のできること）と、いつも要る本人確認（K-14）", () => {
  const admins = ENDPOINTS.filter((e) => e.perm.word === "admin");
  it.each(admins.map((e) => [`${e.method} ${e.path}`, e] as const))(
    "%s：能力（%s）の無い人は 403 で、副作用に届かない。ある人は通る",
    async (_n, e) => {
      const no = await hit(e, "member", false, true, { perms: false });
      expect([no.status, no.reached]).toEqual([403, false]);
      const yes = await hit(e, "member", false, true, { perms: true });
      expect(yes.reached).toBe(true);
    },
  );
  it("admin の口は全部、能力（表と能力）か「管理者だけ」を持つ", () => {
    expect(admins.filter((e) => !e.perm.adminOnly && !(e.perm.target && e.perm.ability)).map((e) => e.path)).toEqual(
      [],
    );
  });
  const opsEps = ENDPOINTS.filter((e) => e.perm.word.startsWith("ops:"));
  it.each(opsEps.map((e) => [`${e.method} ${e.path}`, e] as const))(
    "%s：そのできることの無い運営の人は 403。ある人は通る",
    async (_n, e) => {
      // ops:any は運営の人なら誰でも：止まるのは運営の人の行が無い人。ほかは、そのできることの無い人
      const no = await hit(e, "ops", false, true, { caps: e.perm.cap === "any" ? null : ["something_else"] });
      expect([no.status, no.reached]).toEqual([403, false]);
      const yes = await hit(e, "ops", false, true, { caps: [e.perm.cap!] });
      expect(yes.reached).toBe(true);
    },
  );
  const always = ENDPOINTS.filter((e) => e.perm.stepUp === "always");
  it.each(always.map((e) => [`${e.method} ${e.path}`, e] as const))(
    "%s：直前 15 分以内の本人確認が無ければ 403（STEP_UP_REQUIRED）。あれば通る",
    async (_n, e) => {
      for (const at of [null, OLD()]) {
        const no = await hit(e, RIGHT_ROLE[e.auth], true, true, { stepUpAt: at });
        expect([no.status, no.reached]).toEqual([403, false]);
      }
      const yes = await hit(e, RIGHT_ROLE[e.auth], true, true, { stepUpAt: FRESH() });
      expect(yes.reached).toBe(true);
    },
  );
});

const ROW_WORDS = new Set(["self", "read", "write", "assignee", "approver", "recipient", "manager"]);
describe("権限の試験：行に結ぶ言葉（K-15・ZT4）", () => {
  const withId = ENDPOINTS.filter((e) => ROW_WORDS.has(e.perm.word) && e.path.includes(":id"));
  // 除外（scripts/ci/row_rules.mjs の ROW_EXEMPT）：パスキー（認証の側の表）と、つないだ PC（アカウントのもの・D-128.156。
  //   持ち主は口と DB の関数の 2 重で確かめる・D-128.166・K-364）
  const EXEMPT = ["/api/v1/me/passkeys", "/api/v1/bridge/devices/"];
  //   欄で名指しして外した口の :id（ROW_EXEMPT_FIELDS・K-441）：口の名前と欄の名前と理由が要る。口ごとは外さない
  const FIELD_EXEMPT = ROW_EXEMPT_FIELDS as Record<string, Record<string, string> | undefined>;
  const fieldExempt = (e: { operationId: string }) => (FIELD_EXEMPT[e.operationId]?.["id"] ?? "").trim() !== "";
  it("行に結ぶ口で :id があるものは全部、どの表のどの条件で確かめるかを持つ（除外はパスキーとつないだ PC と、欄で名指しして理由を書いた :id だけ）", () => {
    expect(
      withId
        .filter((e) => !e.perm.row && !EXEMPT.some((x) => e.path.startsWith(x)) && !fieldExempt(e))
        .map((e) => e.path),
    ).toEqual([]);
  });
  it("欄で名指しして外した :id は、本当にある口の :id で、理由が 15 文字以上あり、外した口は行の確かめを持たない（口の名前の書き間違いで黙って外れない）", () => {
    for (const [op, fields] of Object.entries(FIELD_EXEMPT)) {
      const e = ENDPOINTS.find((x) => x.operationId === op);
      expect(e, `${op} が契約に無い`).toBeDefined();
      for (const [field, why] of Object.entries(fields ?? {})) {
        expect(field, `${op} の欄`).toBe("id");
        expect(e!.path, `${op} の道に :id が無い`).toContain(":id");
        expect((why ?? "").trim().length, `${op}.${field} の理由が短い`).toBeGreaterThanOrEqual(15);
        expect(e!.perm.row, `${op} は行の確かめを外したはず`).toBeNull();
      }
    }
  });
  const rows = withId.filter((e) => e.perm.row);
  it.each(rows.map((e) => [`${e.method} ${e.path}`, e] as const))(
    "%s：見えない行は 404・言葉の外の人は 403 で、副作用に届かない。言葉の中の人は通る",
    async (_n, e) => {
      const missing = await hit(e, "member", false, true, { row: "missing" });
      expect([missing.status, missing.reached]).toEqual([404, false]);
      if (e.perm.word !== "read") {
        const denied = await hit(e, "member", false, true, { row: "denied" });
        expect([denied.status, denied.reached]).toEqual([403, false]);
      }
      const ok = await hit(e, "member", false, true, { row: "ok" });
      expect(ok.reached).toBe(true);
    },
  );
});

// 一覧・作る口の行の絞り込みと条件つきの本人確認は、本物の DB の試験 apps/api/test/authz_rows.test.ts（K-17）。まだの口は作るチケットの番号つきの it.todo

describe("道すじが別の口に吸われない（本物の登録の順・D-128.113）", () => {
  it("契約の全 API が、本物の登録の順で、自分の振る舞いに届く（/approvals/history が /approvals/:id に吸われない など）", async () => {
    const RIGHT: Record<EndpointDef["auth"], Role> = {
      public: "anonymous",
      member: "member",
      ops: "ops",
      client: "client",
      device: "device",
    };
    const wrong: string[] = [];
    for (const target of ENDPOINTS) {
      let got = "";
      const hooks = Object.fromEntries(
        ENDPOINTS.map((x) => [
          x.operationId,
          {
            before: async () => {
              got = x.operationId;
              return { status: 418, body: {} };
            },
          },
        ]),
      );
      const deps: ContractDeps = {
        hooks,
        limiter: () => ({ take: () => true }),
        idempotency: { get: () => undefined, set: () => undefined },
      };
      const repo = {
        opsAllowed: async () => true,
        hasColumn: () => true,
        can: async () => true,
        canAny: async () => true,
        isAdmin: async () => true,
        opsCaps: async () => [target.perm.cap ?? ""],
        rowAllowed: async () => "ok",
      } as unknown as Repository;
      const app = new Hono<Vars>();
      app.use("*", async (c, next) => {
        c.set("ctx", ctxOf(RIGHT[target.auth]));
        c.set("repo", repo);
        await next();
      });
      registerAll(app, deps);
      const init: RequestInit = { method: target.method, headers: { "content-type": "application/json" } };
      if (target.method === "POST" || target.method === "PATCH" || target.method === "PUT") init.body = "{}";
      await app.request(urlOf(target), init);
      if (got !== target.operationId) wrong.push(`${target.method} ${target.path} → ${got || "どこにも届かない"}`);
    }
    expect(wrong).toEqual([]);
  });
});
