import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "../src/migrate.js";
import { createPool } from "../src/pool.js";
import { createRepository, type Repository } from "../src/repository.js";
import { seedAccessMatrix } from "../src/seeds.js";
import { UUID_RE, uuidv7 } from "../src/id.js";

const URL = process.env["DATABASE_URL"]!;
const APP_URL = URL.replace(/\/\/[^@]*@/, "//kaname_app:kaname_app@");
const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const admin = new pg.Pool({ connectionString: URL, max: 2 });
let app: pg.Pool;
let repo: Repository;
let S: Awaited<ReturnType<typeof seedAccessMatrix>>;

beforeAll(async () => {
  await migrate(URL, pkg);
  const c = await admin.connect();
  try {
    S = await seedAccessMatrix(c);
  } finally {
    c.release();
  }
  app = createPool({ databaseUrl: APP_URL, max: 3 });
  repo = await createRepository(app);
});
afterAll(async () => {
  await app.end();
  await admin.end();
});

describe("uuid v7", () => {
  it("形と時刻順", () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(UUID_RE);
    expect(a.charAt(14)).toBe("7");
    expect(a < b).toBe(true);
  });
});

describe("repository（関門 C2）", () => {
  const boss = () => ({ tenantId: S.tenantA, userId: S.bossA, role: "member" as const });
  const staff = () => ({ tenantId: S.tenantA, userId: S.staffA, role: "member" as const });
  it("create は id を v7 で振り、tenant_id・created_by・updated_by を文脈から入れる", async () => {
    const row = await repo.table("layers").create(boss(), { key: "dept", label: "部門", order_no: 2 });
    expect(String(row["id"])).toMatch(UUID_RE);
    expect(row["tenant_id"]).toBe(S.tenantA);
    expect(row["created_by"]).toBe(S.bossA);
    expect(row["updated_by"]).toBe(S.bossA);
  });
  it("権限の無い担当者の create は RLS で弾かれる", async () => {
    await expect(repo.table("layers").create(staff(), { key: "x", label: "x", order_no: 3 })).rejects.toThrow(
      /row-level security/,
    );
  });
  it("list は where と limit を取り、論理削除した行を出さない。softDelete 後は get が null", async () => {
    const t = repo.table("layers");
    const before = await t.list(boss(), { where: { key: "dept" } });
    expect(before).toHaveLength(1);
    const id = String(before[0]!["id"]);
    expect(await t.softDelete(boss(), id)).toBe(true);
    expect(await t.softDelete(boss(), id)).toBe(false);
    expect(await t.get(boss(), id)).toBeNull();
    expect(await t.list(boss(), { where: { key: "dept" } })).toHaveLength(0);
  });
  it("update は updated_by を入れ、tenant_id／created_by の書き換えを無視する", async () => {
    const t = repo.table("layers");
    const row = await t.create(boss(), { key: "u", label: "前", order_no: 4 });
    const up = await t.update(boss(), String(row["id"]), { label: "後", tenant_id: S.tenantB, created_by: "x" });
    expect(up?.["label"]).toBe("後");
    expect(up?.["tenant_id"]).toBe(S.tenantA);
    expect(up?.["updated_by"]).toBe(S.bossA);
  });
  it("許可されていない識別子（列・表）は文字列連結せずに拒否する（G10）", async () => {
    await expect(repo.table("layers").list(boss(), { where: { "key; drop table layers--": 1 } })).rejects.toThrow(
      /許可されていない識別子/,
    );
    await expect(repo.table("layers").list(boss(), { orderBy: "nope" })).rejects.toThrow(/許可されていない識別子/);
    expect(() => repo.table("users" as never)).toThrow();
  });
  it("マスタは key が主キーで論理削除しない", async () => {
    expect(await repo.table("abilities").get(staff(), "view")).not.toBeNull();
    await expect(repo.table("abilities").softDelete(staff(), "view")).rejects.toThrow(/マスタ/);
  });
  it("init は表が無いと落ちる（G-11 の存在確認）", async () => {
    const empty = new pg.Pool({ connectionString: URL.replace(/\/[^/?]+$/, "/postgres"), max: 1 });
    await expect(createRepository(empty)).rejects.toThrow(/表が無い/);
    await empty.end();
  });
});
