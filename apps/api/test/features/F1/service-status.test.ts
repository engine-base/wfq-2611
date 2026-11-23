// K-307「いまの様子（誰でも読める稼働状況の口）」の単体の試験（契約の口 getServiceStatus・本物の DB）。
// テストの名前の頭の行 ID（K307-API-…・K307-DB-…）は 11_tickets/K-307.md の表のマスに 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。間違っていると思ったら、作る人に戻す。実装の前に流して赤を確かめない（D-128.143）。
//
// 組み立ては本番と同じ bootApi。障害とお知らせは運営の画面（F12）がまだ無いので、運営のテナントの表に直に入れる。
// 共用の試験の DB なので、ほかの試験の行が混ざってもよいように、この回の題（RUN）が付いた行だけを見る。終わったらこの回の行を消す（G-10）。
//
// 試験が決める口の形（K-307 が作る）:
//   GET /api/v1/auth/service-status・誰でも（ログインしていなくてよい）・10 回／分／IP
//   200 { data: { incidents: [{ state, title, started_at }], maintenance: { title, from, to } | null } }（型 PublicServiceStatus）
//     incidents   … 直っていない障害（state が resolved でない・resolved_at が空・消していない・started_at がある）のうち、
//                   公開したお知らせ（notices.state = published・全部向け・消していない・題がある）に結んだものだけ。
//                   title はそのお知らせの題。started_at の古い順。お知らせの placements（list・banner…）は見ない
//     maintenance … 公開した全部向けのお知らせのうち、maintenance_from と maintenance_to の両方があり、いま中のもの
//                   （maintenance_from <= now() < maintenance_to・DB の now()）。予定（これから）は出さない（answer=88f98638a534）。
//                   中のものが 2 つ以上なら maintenance_to の早いもの
//   どのワークスペースのことも出さない（ワークスペース向け・プラン向けのお知らせは出さない。本文・メモ・id は返さない）
//   一覧の引数（limit・cursor・sort）は契約の入口が形を確かめる（sort は status_incidents の列）。scope_id は絞れない口なので 422
//   DB の関数 app.public_service_status() returns jsonb（security definer）。障害とお知らせの表の行の守り（運営だけ）は変えない
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "@kaname/db/migrate";
import { migrateAuth } from "@kaname/auth/migrate";
import { ENDPOINTS } from "@kaname/contracts";
import type { Config } from "@kaname/config";
import type { MailLike } from "@kaname/notify";
import { bootApi, type BootOptions } from "../../../src/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");
const DB_PKG = join(ROOT, "packages", "db");
const ADMIN = process.env["DATABASE_URL"]!;
const APP_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const AUTH_URL = ADMIN.replace(/\/\/[^@]*@/, "//kaname_auth:kaname_auth@");
const OPS_EMAIL = "ops-k307@example.com";
const RUN = `k307-${Date.now().toString(36)}`;
const STATUS = "/api/v1/auth/service-status";

type Seams = BootOptions & { mail: MailLike; outboundFetch: typeof fetch };
const fakeMail: MailLike = { send: async () => ({ error: null }) };
const fakeFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`K-307 は外に出ない: ${url}`);
};
const config = {
  env: "test",
  databaseUrl: APP_URL,
  authDatabaseUrl: AUTH_URL,
  authSecret: "test-secret-0123456789-abcdefghijklmnop",
  baseUrl: "http://127.0.0.1:3001",
  webBaseUrl: "http://127.0.0.1:3123",
  webOrigins: [],
  storage: {
    endpoint: "http://127.0.0.1:9000",
    region: "ap-northeast-1",
    bucket: "kaname-dev",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    forcePathStyle: true,
  },
  secretsMasterKey: Buffer.alloc(32, 7).toString("base64"),
  resendApiKey: null,
  mailFrom: "Kaname <noreply@example.com>",
  opsEmail: OPS_EMAIL,
  mailReplyTo: OPS_EMAIL,
  operator: { service: "Kaname", company: "試験", representative: "試験", email: OPS_EMAIL, phone: "", address: null },
  mailSuppressPrefix: "",
  bridgeReleaseBase: "",
  bridgeReleaseDir: "",
  infisical: null,
  listenDatabaseUrl: null,
  port: 0,
} as Config;

let app: Awaited<ReturnType<typeof bootApi>>;
let admin: pg.Pool;
let appRole: pg.Pool;
let myTenant = "";
let ipSeq = 0;
const nextIp = () => `198.18.7.${(ipSeq = (ipSeq % 250) + 1)}`;
const get = (query = "", o: { ip?: string; headers?: Record<string, string> } = {}) =>
  app.app.request(`http://localhost${STATUS}${query}`, {
    headers: { "x-forwarded-for": o.ip ?? nextIp(), ...(o.headers ?? {}) },
  });
interface Incident {
  state: string;
  title: string;
  started_at: string;
}
interface Maintenance {
  title: string;
  from: string;
  to: string;
}
interface Status {
  incidents: Incident[];
  maintenance: Maintenance | null;
}
const status = async (): Promise<{ raw: string; d: Status }> => {
  const r = await get();
  const raw = await r.text();
  expect(r.status, raw).toBe(200);
  return { raw, d: (JSON.parse(raw) as { data: Status }).data };
};
const title = (tag: string) => `${RUN} ${tag}`;
const mine = (d: Status) => d.incidents.filter((i) => i.title?.startsWith(RUN));
const mineTitles = async () => mine((await status()).d).map((i) => i.title);

interface NoticeOpt {
  state?: "draft" | "scheduled" | "published";
  kind?: string;
  from?: string; // SQL の式
  to?: string;
  targetTenant?: string | null;
  targetPlans?: boolean;
  placements?: string; // SQL の配列の文字
  noTitle?: boolean;
}
const notice = async (tag: string, o: NoticeOpt = {}, db: pg.Pool | pg.PoolClient = admin) =>
  (
    await db.query<{ id: string }>(
      `insert into notices (kind_id, title, body, state, maintenance_from, maintenance_to, target_tenant_id, target_plan_ids, placements)
       values ($1, $2, $3, $4, ${o.from ?? "null"}, ${o.to ?? "null"}, $5, ${o.targetPlans ? "array[gen_random_uuid()]" : "null"}, $6)
       returning id`,
      [
        o.kind ?? "incident",
        o.noTitle ? null : title(tag),
        `${RUN} 運営だけの本文 ${tag}`,
        o.state ?? "published",
        o.targetTenant ?? null,
        o.placements ?? "{list,banner}",
      ],
    )
  ).rows[0]!.id;
const incident = async (
  noticeId: string | null,
  o: { state?: string; resolved?: boolean; deleted?: boolean; started?: string } = {},
) =>
  (
    await admin.query<{ id: string }>(
      `insert into status_incidents (notice_id, state, started_at, resolved_at, note, body, deleted_at)
       values ($1, $2, ${o.started ?? "now() - interval '10 minutes'"}, ${o.resolved ? "now()" : "null"}, $3, $4, ${o.deleted ? "now()" : "null"}) returning id`,
      [noticeId, o.state ?? "investigating", `${RUN} 運営のメモ`, `${RUN} 運営の本文`],
    )
  ).rows[0]!.id;
const removeNotice = (id: string) => admin.query("update notices set deleted_at = now() where id = $1", [id]);

beforeAll(async () => {
  await migrate(ADMIN, DB_PKG);
  // 入口はログインしていない要求でもセッションを解く（Better Auth）。CI の組ごとの新しい DB には認証の表が無いので、ここで作る
  await migrateAuth(ADMIN);
  admin = new pg.Pool({ connectionString: ADMIN, max: 3 });
  appRole = new pg.Pool({ connectionString: APP_URL, max: 1 });
  myTenant = (
    await admin.query<{ id: string }>(
      "insert into tenants (id, tenant_id, name) select u, u, $1 from gen_random_uuid() u returning id",
      [`${RUN} の会社`],
    )
  ).rows[0]!.id;
  const seams: Seams = { bucketExists: async () => true, mail: fakeMail, outboundFetch: fakeFetch };
  app = await bootApi(config, seams);
}, 60_000);

afterAll(async () => {
  await admin?.query("delete from status_incidents where note like $1", [`${RUN}%`]);
  await admin?.query("delete from notices where body like $1", [`${RUN}%`]);
  // テナントは消した印だけ付ける（作ると引き金 app.ticket_basics_on_tenant がチケットの基本の行を入れ、仕組みの段は消せないので行ごとは消せない）
  if (myTenant) await admin?.query("update tenants set deleted_at = now() where id = $1", [myTenant]);
  await app?.close();
  await appRole?.end();
  await admin?.end();
});

describe("K-307 いまの様子：障害", () => {
  it("K307-API-001 ログインしていない人が読む：200。data は incidents（配列）と maintenance（null か 1 つ）の 2 つだけ", async () => {
    const { d } = await status();
    expect(Object.keys(d).sort()).toEqual(["incidents", "maintenance"]);
    expect(Array.isArray(d.incidents)).toBe(true);
    expect(d.maintenance === null || typeof d.maintenance === "object").toBe(true);
  });

  it("K307-API-002 直っていない障害を公開のお知らせに結んだ：incidents に state・title（お知らせの題）・started_at の 3 つだけで出る", async () => {
    await incident(await notice("障害A"), { state: "identified" });
    const got = mine((await status()).d).filter((i) => i.title === title("障害A"));
    expect(got).toHaveLength(1);
    expect(Object.keys(got[0]!).sort()).toEqual(["started_at", "state", "title"]);
    expect(got[0]!.state).toBe("identified");
    expect(Number.isNaN(Date.parse(got[0]!.started_at))).toBe(false);
  });

  it("K307-API-003 直った障害（state resolved・resolved_at あり）は出ない", async () => {
    await incident(await notice("直った1"), { state: "resolved" });
    await incident(await notice("直った2"), { resolved: true });
    const t = await mineTitles();
    expect(t).not.toContain(title("直った1"));
    expect(t).not.toContain(title("直った2"));
  });

  it("K307-API-004 公開していない（下書き・予約）お知らせに結んだ障害・お知らせに結んでいない障害は出ない（運営が文を書くまで出さない・answer=8467d5780a91）", async () => {
    await incident(await notice("下書き", { state: "draft" }));
    await incident(await notice("予約", { state: "scheduled" }));
    const before = (await status()).d.incidents.length;
    await incident(null);
    const t = await mineTitles();
    expect(t).not.toContain(title("下書き"));
    expect(t).not.toContain(title("予約"));
    expect((await status()).d.incidents.length, "結んでいない障害は数にも出ない").toBe(before);
  });

  it("K307-API-005 消した障害・消したお知らせに結んだ障害は出ない", async () => {
    await incident(await notice("消した障害"), { deleted: true });
    const n = await notice("消したお知らせ");
    await incident(n);
    await removeNotice(n);
    const t = await mineTitles();
    expect(t).not.toContain(title("消した障害"));
    expect(t).not.toContain(title("消したお知らせ"));
  });

  it("K307-API-006 ワークスペース向け・プラン向けのお知らせに結んだ障害と、ワークスペース向けのメンテナンスは出ない（どのワークスペースのことも出さない）", async () => {
    await incident(await notice("会社向け", { targetTenant: myTenant }));
    await incident(await notice("プラン向け", { targetPlans: true }));
    const m = await notice("会社向けメンテ", {
      kind: "maintenance",
      targetTenant: myTenant,
      from: "now() - interval '1 minute'",
      to: "now() + interval '30 seconds'",
    });
    const { raw } = await status();
    for (const s of [title("会社向け"), title("プラン向け"), title("会社向けメンテ"), myTenant])
      expect(raw).not.toContain(s);
    await removeNotice(m);
  });

  it("K307-API-007 答えに運営の本文・メモ・お知らせや障害の id・テナントの id を出さない", async () => {
    const n = await notice("漏れ");
    const i = await incident(n);
    const ops = (await admin.query<{ id: string }>("select app.ops_tenant_id() as id")).rows[0]!.id;
    const { raw } = await status();
    for (const s of [`${RUN} 運営だけの本文`, `${RUN} 運営のメモ`, `${RUN} 運営の本文`, n, i, ops])
      expect(raw).not.toContain(s);
  });

  it("K307-API-017 並び：直っていない障害は started_at の古い順", async () => {
    await incident(await notice("並び-新"), { started: "now() - interval '5 minutes'" });
    await incident(await notice("並び-古"), { started: "now() - interval '50 minutes'" });
    const t = (await mineTitles()).filter((x) => x.includes("並び-"));
    expect(t).toEqual([title("並び-古"), title("並び-新")]);
  });

  it("K307-API-019 空の列：題の無いお知らせに結んだ障害・started_at の無い障害・maintenance_from の無いメンテナンスは出ない（答えの型を null で壊さない）", async () => {
    await incident(await notice("題なし", { noTitle: true }));
    await incident(await notice("始まりなし"), { started: "null" });
    const m = await notice("始まりなしメンテ", { kind: "maintenance", to: "now() + interval '20 seconds'" });
    const { d, raw } = await status();
    expect(d.incidents.every((i) => typeof i.title === "string" && typeof i.started_at === "string")).toBe(true);
    expect(raw).not.toContain(title("始まりなし"));
    expect(raw).not.toContain(title("始まりなしメンテ"));
    await removeNotice(m);
  });

  it("K307-API-020 お知らせの置き場（placements）が一覧だけ（{list}）でも、公開した全部向けのお知らせに結んだ障害は出る（置き場所は見ない・PM に確かめたいこと 1）", async () => {
    await incident(await notice("一覧だけ", { placements: "{list}" }));
    expect(await mineTitles()).toContain(title("一覧だけ"));
  });
});

describe("K-307 いまの様子：メンテナンス（中のときだけ・answer=88f98638a534）", () => {
  it("K307-API-008 いまメンテナンス中（from が過去・to が未来）：maintenance に title・from・to の 3 つだけ", async () => {
    const id = await notice("メンテ中", {
      kind: "maintenance",
      from: "now() - interval '5 minutes'",
      to: "now() + interval '40 seconds'",
    });
    const m = (await status()).d.maintenance;
    expect(m?.title).toBe(title("メンテ中"));
    expect(Object.keys(m!).sort()).toEqual(["from", "title", "to"]);
    await removeNotice(id);
  });

  it("K307-API-009 これからのメンテナンス（from が未来）・終わったメンテナンス（to が過去）は出ない（予定は出さない）", async () => {
    const a = await notice("メンテ予定", {
      kind: "maintenance",
      from: "now() + interval '1 minute'",
      to: "now() + interval '2 hours'",
    });
    const b = await notice("メンテ済", {
      kind: "maintenance",
      from: "now() - interval '2 hours'",
      to: "now() - interval '1 second'",
    });
    const { raw } = await status();
    expect(raw).not.toContain(title("メンテ予定"));
    expect(raw).not.toContain(title("メンテ済"));
    await removeNotice(a);
    await removeNotice(b);
  });

  it("K307-API-011 公開していないメンテナンス（下書き・予約）は出ない", async () => {
    const a = await notice("メンテ下書き", {
      kind: "maintenance",
      state: "draft",
      from: "now() - interval '1 minute'",
      to: "now() + interval '20 seconds'",
    });
    const b = await notice("メンテ予約", {
      kind: "maintenance",
      state: "scheduled",
      from: "now() - interval '1 minute'",
      to: "now() + interval '20 seconds'",
    });
    const { raw } = await status();
    expect(raw).not.toContain(title("メンテ下書き"));
    expect(raw).not.toContain(title("メンテ予約"));
    await removeNotice(a);
    await removeNotice(b);
  });

  it("K307-API-018 いま中のメンテナンスが 2 つ：maintenance_to の早いほうを返す", async () => {
    const late = await notice("メンテ遅く終わる", {
      kind: "maintenance",
      from: "now() - interval '10 minutes'",
      to: "now() + interval '50 seconds'",
    });
    const early = await notice("メンテ早く終わる", {
      kind: "maintenance",
      from: "now() - interval '1 minute'",
      to: "now() + interval '15 seconds'",
    });
    expect((await status()).d.maintenance?.title).toBe(title("メンテ早く終わる"));
    await removeNotice(late);
    await removeNotice(early);
  });
});

describe("K-307 いまの様子：入口・守り・失敗", () => {
  it("K307-API-012 ログイン中の頭（Bearer）やでたらめの頭を付けても、同じ答え（200・誰の分も足さない）", async () => {
    const a = (await status()).d;
    const r = await get("", { headers: { authorization: "Bearer garbage-token" } });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(((await r.json()) as { data: Status }).data).toEqual(a);
  });

  it("K307-API-013 一覧の引数：limit・cursor・sort（status_incidents の列）が正しければ同じ答え。形が違えば 422。scope_id は絞れない口なので uuid でも 422", async () => {
    const a = (await status()).d;
    const good = await get("?limit=1&cursor=0&sort=started_at");
    expect(good.status, await good.clone().text()).toBe(200);
    expect(((await good.json()) as { data: Status }).data).toEqual(a);
    for (const q of [
      "limit=0",
      "limit=abc",
      "cursor=-1",
      "sort=drop%20table",
      "sort=title",
      "scope_id=x",
      "scope_id=0193c5a0-0000-7000-8000-000000000000",
    ]) {
      expect((await get(`?${q}`)).status, q).toBe(422);
    }
  });

  it("K307-API-014 1 分に 11 回（同じ IP）：11 回目は 429・待つ秒数（retry_after_sec）", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) expect((await get("", { ip })).status, `${i + 1} 回目`).toBe(200);
    const r = await get("", { ip });
    expect(r.status).toBe(429);
    expect(Number(((await r.json()) as Record<string, unknown>)["retry_after_sec"])).toBeGreaterThan(0);
  });

  it("K307-API-015 DB が落ちた（障害の表が読めない）：503・E-PAGE-003。中身（題・時刻）を返さない", async () => {
    await incident(await notice("落ちた"));
    await admin.query("alter table status_incidents rename to status_incidents_k307_down");
    const read = async () => {
      const r = await get();
      return { code: r.status, text: await r.text() };
    };
    const { code, text } = await read().finally(() =>
      admin.query("alter table status_incidents_k307_down rename to status_incidents"),
    );
    expect(code).toBe(503);
    expect((JSON.parse(text) as Record<string, unknown>)["code"]).toBe("E-PAGE-003");
    expect((JSON.parse(text) as Record<string, unknown>)["error"]).toBe("unavailable");
    expect(text).not.toContain(RUN);
    expect(text).not.toContain("status_incidents");
    expect((await get()).status, "戻すと読める").toBe(200);
  });

  it("K307-API-016 契約：getServiceStatus の答えの型は PublicServiceStatus（packages/contracts の ENDPOINTS）。ログイン後の getServiceStatusForMember は ServiceStatus のまま", () => {
    const out = (id: string) => ENDPOINTS.find((e) => e.operationId === id)?.output;
    expect(out("getServiceStatus")).toBe("PublicServiceStatus");
    expect(out("getServiceStatusForMember")).toBe("ServiceStatus");
  });
});

describe("K-307 いまの様子：DB の関数", () => {
  it("K307-DB-001 app.public_service_status()：jsonb を返す。kaname_app は呼べ、誰でも（PUBLIC）は呼べない", async () => {
    const f = (
      await admin.query<{ result: string; acl: string | null; ok: boolean }>(
        `select pg_get_function_result(p.oid) as result, p.proacl::text as acl,
                has_function_privilege('kaname_app', p.oid, 'execute') as ok
           from pg_proc p where p.oid = 'app.public_service_status()'::regprocedure`,
      )
    ).rows[0]!;
    expect(f.result).toBe("jsonb");
    expect(f.ok).toBe(true);
    expect(f.acl ?? "").not.toMatch(/(^|[{,])=X/);
  });

  it("K307-DB-002 行の守りは変えない：アプリの役（運営でない）で障害の表を直に読むと、この回の行は 0 件。関数からは公開の分が読める", async () => {
    await incident(await notice("守り"));
    const c = await appRole.connect();
    try {
      await c.query("begin");
      const direct = await c.query("select 1 from status_incidents where note like $1", [`${RUN}%`]);
      expect(direct.rowCount).toBe(0);
      const fn = await c.query<{ s: Status }>("select app.public_service_status() as s");
      expect(fn.rows[0]!.s.incidents.map((i) => i.title)).toContain(title("守り"));
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("K307-DB-003 境目（同じトランザクションの中で now() が同じ）：maintenance_from = now() は中（出る）、maintenance_to = now() は終わった（出ない）", async () => {
    const c = await admin.connect();
    try {
      await c.query("begin");
      await notice("境目-始まり", { kind: "maintenance", from: "now()", to: "now() + interval '10 seconds'" }, c);
      const s1 = (await c.query<{ s: Status }>("select app.public_service_status() as s")).rows[0]!.s;
      expect(s1.maintenance?.title).toBe(title("境目-始まり"));
      await c.query("update notices set deleted_at = now() where title = $1", [title("境目-始まり")]);
      await notice("境目-終わり", { kind: "maintenance", from: "now() - interval '1 hour'", to: "now()" }, c);
      const s2 = (await c.query<{ s: Status }>("select app.public_service_status() as s")).rows[0]!.s;
      expect(s2.maintenance?.title ?? "").not.toBe(title("境目-終わり"));
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
