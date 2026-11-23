// K-678「フォルダを足す・名前を直す・動かす・消す（createKnowledgeFolder・updateKnowledgeFolder・deleteKnowledgeFolder）」の単体の試験（口・本物の Postgres・本物の口の入口・偽の画面のログイン）。
//   行 ID は K678-API-NNN・K678-DB-NNN（チケット 11_tickets/K-678.md の表の行と 1 対 1）。名前の決めは 07_functional/段10-F9/土台-knowledge.md。
//   土台は knowledge.harness.ts（K-675 が運ぶ）。口の振る舞いは試験の本体（it の中）の h.ready() で読む（answer=8f745003d023）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@kaname/db/context";
import { setupKnowledge, type Person } from "./knowledge.harness.js";

const h = setupKnowledge();

interface World {
  co: { tenantId: string; rootScope: string };
  g1: string;
  g2: string;
  boss: Person;
  mgr1: Person;
  mgr1b: Person;
  mem1: Person;
  view1: Person;
  mem2: Person;
  none: Person;
  /** 営業のマネージャーで、受託開発のメンバー（両方の棚が見える） */
  both: Person;
}

const world = async (label: string): Promise<World> => {
  const co = await h.company(label);
  const g1 = await h.group(co.tenantId, co.rootScope, "営業");
  const g2 = await h.group(co.tenantId, co.rootScope, "受託開発");
  const boss = await h.person(co.tenantId, co.rootScope, { name: "管理者", role: "admin" });
  const mgr1 = await h.person(co.tenantId, g1, { name: "営業マネージャー", role: "manager" });
  const mgr1b = await h.person(co.tenantId, g1, { name: "営業のもう 1 人のマネージャー", role: "manager" });
  const mem1 = await h.person(co.tenantId, g1, { name: "営業メンバー", role: "member" });
  const view1 = await h.person(co.tenantId, g1, { name: "営業閲覧", role: "viewer" });
  const mem2 = await h.person(co.tenantId, g2, { name: "開発メンバー", role: "member" });
  const none = await h.person(co.tenantId, co.rootScope, { name: "どこにも入っていない人", role: "member" });
  const both = await h.person(co.tenantId, g1, { name: "営業のマネージャーで開発のメンバー", role: "manager" });
  await h.admin.query(
    "insert into scope_memberships (tenant_id, member_id, scope_id, is_primary, role) values ($1, $2, $3, false, 'member')",
    [co.tenantId, both.id, g2],
  );
  return { co, g1, g2, boss, mgr1, mgr1b, mem1, view1, mem2, none, both };
};

type Json = Record<string, unknown>;
const make = async (p: Person | null, body: unknown): Promise<Response> => {
  await h.ready();
  return h.req("POST", "/knowledge/folders", { ...(p ? { headers: h.as(p) } : {}), body });
};
const edit = async (p: Person | null, id: string, body: unknown): Promise<Response> => {
  await h.ready();
  return h.req("PATCH", `/knowledge/folders/${id}`, { ...(p ? { headers: h.as(p) } : {}), body });
};
const remove = async (p: Person | null, id: string): Promise<Response> => {
  await h.ready();
  return h.req("DELETE", `/knowledge/folders/${id}`, p ? { headers: h.as(p) } : {});
};
const created = async (p: Person, body: Record<string, unknown>): Promise<string> => {
  const r = await make(p, body);
  expect(r.status).toBe(201);
  return ((await h.json(r)).data as { id: string }).id;
};
const frow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await h.admin.query("select * from knowledge_folders where id = $1", [id])).rows[0];
const num = async (sql: string, p: unknown[]): Promise<number> =>
  Number((await h.admin.query<{ n: string }>(sql, p)).rows[0]!.n);
const folderCount = (w: World): Promise<number> =>
  num("select count(*) as n from knowledge_folders where tenant_id = $1 and deleted_at is null", [w.co.tenantId]);
const audits = async (w: World, action: string) =>
  (
    await h.admin.query(
      "select actor_member_id, target_type, target_id, choke_point_id, payload from audit_events where tenant_id = $1 and action = $2 order by occurred_at",
      [w.co.tenantId, action],
    )
  ).rows as {
    actor_member_id: string;
    target_type: string;
    target_id: string;
    choke_point_id: string;
    payload: unknown;
  }[];

/** 試験用：表（table）への挿入・更新を、この会社の分だけ例外にする引き金を付け、返す関数で外す（ほかの試験に効かせない） */
const breakWrites = async (table: string, tenantId: string): Promise<() => Promise<void>> => {
  const fn = `test_break_${randomUUID().slice(0, 8)}`;
  await h.admin.query(
    `create function ${fn}() returns trigger language plpgsql as $$ begin raise exception '試験で壊した' using errcode = 'XX000'; end $$`,
  );
  await h.admin.query(
    `create trigger ${fn} before insert or update on ${table} for each row when (new.tenant_id = '${tenantId}') execute function ${fn}()`,
  );
  return async () => {
    await h.admin.query(`drop trigger if exists ${fn} on ${table}`);
    await h.admin.query(`drop function if exists ${fn}()`);
  };
};

describe("K-678 フォルダ", () => {
  it("K678-API-001 足す：管理者は会社・マネージャーはグループ・誰でも自分の棚に 201。答えは 6 鍵・並びは 10。DB にも同じ行（自分の棚は持ち主と主の所属つき）", async () => {
    const w = await world("K678 足す");
    const r = await make(w.boss, { shelf: "company", name: "経理" });
    expect(r.status).toBe(201);
    const c = (await h.json(r)).data as Json;
    expect(Object.keys(c).sort()).toEqual(["group_id", "id", "name", "parent_folder_id", "position", "shelf"]);
    expect(c).toMatchObject({ name: "経理", shelf: "company", group_id: null, parent_folder_id: null, position: 10 });
    expect(await frow(c["id"] as string)).toMatchObject({
      scope_id: w.co.rootScope,
      is_personal: false,
      name: "経理",
      deleted_at: null,
    });
    const g = (await h.json(await make(w.mgr1, { shelf: "group", group_id: w.g1, name: "見積もり" }))).data as Json;
    expect(g).toMatchObject({ shelf: "group", group_id: w.g1, position: 10 });
    expect(await frow(g["id"] as string)).toMatchObject({ scope_id: w.g1, is_personal: false });
    const m = (await h.json(await make(w.view1, { shelf: "me", name: "メモ" }))).data as Json;
    expect(m).toMatchObject({ shelf: "me", group_id: null });
    expect(await frow(m["id"] as string)).toMatchObject({
      scope_id: w.view1.scopeId,
      is_personal: true,
      owner_member_id: w.view1.id,
    });
  });

  it("K678-API-002 足す：親フォルダの下に入れ子で置ける。並びは同じ親の中で 10・20・30 と続き、別の親では 10 から", async () => {
    const w = await world("K678 入れ子");
    const parent = await created(w.boss, { shelf: "company", name: "親" });
    const other = await created(w.boss, { shelf: "company", name: "別の親" });
    const a = (await h.json(await make(w.boss, { shelf: "company", name: "子 1", parent_folder_id: parent })))
      .data as Json;
    const b = (await h.json(await make(w.boss, { shelf: "company", name: "子 2", parent_folder_id: parent })))
      .data as Json;
    const c = (await h.json(await make(w.boss, { shelf: "company", name: "子 3", parent_folder_id: parent })))
      .data as Json;
    const d = (await h.json(await make(w.boss, { shelf: "company", name: "子 1", parent_folder_id: other })))
      .data as Json;
    expect([a, b, c].map((x) => x["position"])).toEqual([10, 20, 30]);
    expect(a["parent_folder_id"]).toBe(parent);
    expect(d["position"]).toBe(10);
  });

  it("K678-API-003 足す：書けない人は 403 で何も作らない（会社のメンバー・グループのメンバー・閲覧のみ・会社のマネージャー）。見えないグループ（管理者・入っていない人）は 404", async () => {
    const w = await world("K678 足せない");
    const cases: [Person, Json, number][] = [
      [w.mem1, { shelf: "company", name: "x" }, 403],
      [w.mgr1, { shelf: "company", name: "x" }, 403],
      [w.none, { shelf: "company", name: "x" }, 403],
      [w.mem1, { shelf: "group", group_id: w.g1, name: "x" }, 403],
      [w.view1, { shelf: "group", group_id: w.g1, name: "x" }, 403],
      [w.boss, { shelf: "group", group_id: w.g1, name: "x" }, 404],
      [w.none, { shelf: "group", group_id: w.g1, name: "x" }, 404],
      [w.mem1, { shelf: "group", group_id: w.g2, name: "x" }, 404],
    ];
    for (const [p, body, status] of cases) {
      const r = await make(p, body);
      expect(r.status, `${p.id} ${JSON.stringify(body)}`).toBe(status);
    }
    expect(await folderCount(w)).toBe(0);
  });

  it("K678-API-004 足す：指した物が無い・見えない・その棚に無いは 404（体は { error, code } だけ）：グループ・親フォルダの id が無い・会社のいちばん上・別の会社・消した親・他人の自分のフォルダ・別の棚の親", async () => {
    const w = await world("K678 404");
    const other = await world("K678 404（別の会社）");
    const dead = await created(w.boss, { shelf: "company", name: "消す親" });
    await h.admin.query("update knowledge_folders set deleted_at = now() where id = $1", [dead]);
    const company = await created(w.boss, { shelf: "company", name: "会社の親" });
    const mine = await created(w.mem1, { shelf: "me", name: "自分の親" });
    const cases: [Person, Json][] = [
      [w.mgr1, { shelf: "group", group_id: randomUUID(), name: "x" }],
      [w.mgr1, { shelf: "group", group_id: w.co.rootScope, name: "x" }],
      [w.mgr1, { shelf: "group", group_id: other.g1, name: "x" }],
      [w.boss, { shelf: "company", name: "x", parent_folder_id: randomUUID() }],
      [w.boss, { shelf: "company", name: "x", parent_folder_id: dead }],
      [w.boss, { shelf: "company", name: "x", parent_folder_id: mine }],
      [w.mgr1, { shelf: "group", group_id: w.g1, name: "x", parent_folder_id: company }],
      [w.mem1, { shelf: "me", name: "x", parent_folder_id: company }],
    ];
    for (const [p, body] of cases) {
      const r = await make(p, body);
      expect(r.status, JSON.stringify(body)).toBe(404);
      expect(Object.keys((await r.json()) as Json).sort()).toEqual(["code", "error"]);
    }
  });

  it("K678-API-005 名前の整え：前後の空白（全角を含む）は落ち・全角英数は半角になって保存される。100 字は通る", async () => {
    const w = await world("K678 名前");
    const a = await created(w.boss, { shelf: "company", name: "  経理部　" });
    const b = await created(w.boss, { shelf: "company", name: "ＡＢＣ" });
    const c = await created(w.boss, { shelf: "company", name: "あ".repeat(100) });
    expect((await frow(a))!["name"]).toBe("経理部");
    expect((await frow(b))!["name"]).toBe("ABC");
    expect(((await frow(c))!["name"] as string).length).toBe(100);
  });

  it("K678-API-006 同じ名前：同じ棚・同じ親の中で大文字小文字を分けず 409 E-KNW-020（体は { error, code } だけ）。親が違う・棚が違う・自分の棚の持ち主が違う・消した名前は使える", async () => {
    const w = await world("K678 同じ名前");
    const p1 = await created(w.boss, { shelf: "company", name: "親 1" });
    await created(w.boss, { shelf: "company", name: "Invoice" });
    const dup = await make(w.boss, { shelf: "company", name: "invoice" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "conflict", code: "E-KNW-020" });
    expect((await make(w.boss, { shelf: "company", name: "Invoice", parent_folder_id: p1 })).status).toBe(201);
    expect((await make(w.mgr1, { shelf: "group", group_id: w.g1, name: "Invoice" })).status).toBe(201);
    expect((await make(w.mem1, { shelf: "me", name: "Invoice" })).status).toBe(201);
    expect((await make(w.view1, { shelf: "me", name: "Invoice" })).status).toBe(201);
    expect((await make(w.mem1, { shelf: "me", name: "invoice" })).status).toBe(409);
    const gone = await created(w.boss, { shelf: "company", name: "消す名前" });
    await h.admin.query("update knowledge_folders set deleted_at = now() where id = $1", [gone]);
    expect((await make(w.boss, { shelf: "company", name: "消す名前" })).status).toBe(201);
  });

  it("K678-API-007 深さ 6 まで：6 つ入れ子までは作れて、7 つ目は 409 E-KNW-021・作られない", async () => {
    const w = await world("K678 深さ");
    let parent: string | null = null;
    for (let i = 1; i <= 6; i++) {
      parent = await created(w.boss, {
        shelf: "company",
        name: `深さ ${i}`,
        ...(parent ? { parent_folder_id: parent } : {}),
      });
    }
    const before = await folderCount(w);
    const r = await make(w.boss, { shelf: "company", name: "深さ 7", parent_folder_id: parent });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "conflict", code: "E-KNW-021" });
    expect(await folderCount(w)).toBe(before);
  });

  it("K678-API-008 名前を直す：200 で 6 鍵・読み直し（DB）も新しい名前。親と並びは変わらない。自分の名前のまま送っても通る。別のフォルダと重なる名前は 409 E-KNW-020 で変わらない", async () => {
    const w = await world("K678 名前を直す");
    const parent = await created(w.boss, { shelf: "company", name: "親" });
    const a = await created(w.boss, { shelf: "company", name: "古い名前", parent_folder_id: parent });
    await created(w.boss, { shelf: "company", name: "Taken", parent_folder_id: parent });
    const r = await edit(w.boss, a, { name: "新しい名前" });
    expect(r.status).toBe(200);
    const d = (await h.json(r)).data as Json;
    expect(Object.keys(d).sort()).toEqual(["group_id", "id", "name", "parent_folder_id", "position", "shelf"]);
    expect(d).toMatchObject({ id: a, name: "新しい名前", parent_folder_id: parent, position: 10 });
    expect(await frow(a)).toMatchObject({ name: "新しい名前", parent_folder_id: parent, position: 10 });
    expect((await edit(w.boss, a, { name: "新しい名前" })).status).toBe(200);
    const dup = await edit(w.boss, a, { name: "taken" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "conflict", code: "E-KNW-020" });
    expect((await frow(a))!["name"]).toBe("新しい名前");
  });

  it("K678-API-009 動かす：同じ棚の別のフォルダの下・棚の直下（null）へ。並びを送らなければ新しい親の最後（10 刻みの次）・送ればそのまま。並びだけを直すこともできる", async () => {
    const w = await world("K678 動かす");
    const x = await created(w.boss, { shelf: "company", name: "X" });
    const y = await created(w.boss, { shelf: "company", name: "Y" });
    await created(w.boss, { shelf: "company", name: "Y の子", parent_folder_id: y });
    const moved = (await h.json(await edit(w.boss, x, { parent_folder_id: y }))).data as Json;
    expect(moved).toMatchObject({ parent_folder_id: y, position: 20 });
    expect(await frow(x)).toMatchObject({ parent_folder_id: y, position: 20 });
    const up = (await h.json(await edit(w.boss, x, { parent_folder_id: null }))).data as Json;
    expect(up["parent_folder_id"]).toBeNull();
    expect((await frow(x))!["parent_folder_id"]).toBeNull();
    const placed = (await h.json(await edit(w.boss, x, { parent_folder_id: y, position: 5 }))).data as Json;
    expect(placed).toMatchObject({ parent_folder_id: y, position: 5 });
    const only = (await h.json(await edit(w.boss, x, { position: 99 }))).data as Json;
    expect(only).toMatchObject({ parent_folder_id: y, position: 99, name: "X" });
  });

  it("K678-API-010 自分の中へは動かせない：自分を親にする・自分の下のフォルダを親にすると 409 E-KNW-022・何も変わらない", async () => {
    const w = await world("K678 循環");
    const a = await created(w.boss, { shelf: "company", name: "A" });
    const b = await created(w.boss, { shelf: "company", name: "B", parent_folder_id: a });
    const c = await created(w.boss, { shelf: "company", name: "C", parent_folder_id: b });
    for (const target of [a, b, c]) {
      const r = await edit(w.boss, a, { parent_folder_id: target });
      expect(r.status, target).toBe(409);
      expect(await r.json()).toEqual({ error: "conflict", code: "E-KNW-022" });
    }
    expect((await frow(a))!["parent_folder_id"]).toBeNull();
  });

  it("K678-API-011 別の棚へは動かせない：見えている別の棚のフォルダを親にすると 409 E-KNW-023（グループ → 別のグループ・自分 → グループ・グループ → 会社）。見えない棚のフォルダを親にすると 404", async () => {
    const w = await world("K678 別の棚");
    const mine = await created(w.both, { shelf: "group", group_id: w.g1, name: "営業のフォルダ" });
    const theirs = await created(w.mem2, { shelf: "me", name: "開発の人の自分のフォルダ" });
    const dev = await created(w.both, { shelf: "me", name: "自分のフォルダ" });
    const devGroup = await h.admin.query<{ id: string }>(
      "insert into knowledge_folders (tenant_id, scope_id, is_personal, owner_member_id, name) values ($1, $2, false, $3, '開発のフォルダ') returning id",
      [w.co.tenantId, w.g2, w.mem2.id],
    );
    const company = await created(w.boss, { shelf: "company", name: "会社のフォルダ" });
    for (const parent of [devGroup.rows[0]!.id, company]) {
      const r = await edit(w.both, mine, { parent_folder_id: parent });
      expect(r.status, parent).toBe(409);
      expect(await r.json()).toEqual({ error: "conflict", code: "E-KNW-023" });
    }
    const r2 = await edit(w.both, dev, { parent_folder_id: mine });
    expect(r2.status).toBe(409);
    expect(await r2.json()).toEqual({ error: "conflict", code: "E-KNW-023" });
    expect((await edit(w.both, mine, { parent_folder_id: theirs })).status).toBe(404);
    expect((await frow(mine))!["parent_folder_id"]).toBeNull();
  });

  it("K678-API-012 動かした先で、中のフォルダまで入れて深さ 6 を超えるなら 409 E-KNW-021（動かすフォルダの下の深さも数える）。ちょうど 6 は通る", async () => {
    const w = await world("K678 動かす深さ");
    let p: string | null = null;
    const chain: string[] = [];
    for (let i = 1; i <= 4; i++) {
      p = await created(w.boss, { shelf: "company", name: `親 ${i}`, ...(p ? { parent_folder_id: p } : {}) });
      chain.push(p);
    }
    const a = await created(w.boss, { shelf: "company", name: "A" });
    const b = await created(w.boss, { shelf: "company", name: "B", parent_folder_id: a });
    await created(w.boss, { shelf: "company", name: "C", parent_folder_id: b });
    const small = await created(w.boss, { shelf: "company", name: "小さい" });
    await created(w.boss, { shelf: "company", name: "小さい子", parent_folder_id: small });
    const tooDeep = await edit(w.boss, a, { parent_folder_id: chain[3] });
    expect(tooDeep.status).toBe(409);
    expect(await tooDeep.json()).toEqual({ error: "conflict", code: "E-KNW-021" });
    expect((await frow(a))!["parent_folder_id"]).toBeNull();
    expect((await edit(w.boss, small, { parent_folder_id: chain[3] })).status).toBe(200);
  });

  it("K678-API-013 直す・消す：書けない人は 403・見えない人（別のグループ・管理者・他人の自分のフォルダ・別の会社）と無い・消した id は 404（体は { error, code } だけ）。何も変わらない", async () => {
    const w = await world("K678 直せない");
    const other = await world("K678 直せない（別の会社）");
    const g1f = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "営業のフォルダ" });
    const mine = await created(w.mem1, { shelf: "me", name: "自分のフォルダ" });
    const dead = await created(w.boss, { shelf: "company", name: "消した" });
    await h.admin.query("update knowledge_folders set deleted_at = now() where id = $1", [dead]);
    const company = await created(w.boss, { shelf: "company", name: "会社のフォルダ" });
    const cases: [Person, string, number][] = [
      [w.mem1, g1f, 403],
      [w.view1, g1f, 403],
      [w.mem1, company, 403],
      [w.mgr1, company, 403],
      [w.mem2, g1f, 404],
      [w.boss, g1f, 404],
      [w.none, g1f, 404],
      [w.boss, mine, 404],
      [w.mgr1, mine, 404],
      [other.boss, company, 404],
      [w.boss, dead, 404],
      [w.boss, randomUUID(), 404],
    ];
    for (const [p, id, status] of cases) {
      const a = await edit(p, id, { name: "書き換え" });
      expect(a.status, `直す ${p.id} ${id}`).toBe(status);
      const d = await remove(p, id);
      expect(d.status, `消す ${p.id} ${id}`).toBe(status);
      if (status === 404) expect(Object.keys((await a.json()) as Json).sort()).toEqual(["code", "error"]);
    }
    expect(await frow(g1f)).toMatchObject({ name: "営業のフォルダ", deleted_at: null });
    expect(await frow(company)).toMatchObject({ name: "会社のフォルダ", deleted_at: null });
  });

  it("K678-API-014 直す：親に選んだフォルダが見えない・無い・消したなら 404（何も変わらない）", async () => {
    const w = await world("K678 親が無い");
    const a = await created(w.boss, { shelf: "company", name: "A" });
    const dead = await created(w.boss, { shelf: "company", name: "消した親" });
    await h.admin.query("update knowledge_folders set deleted_at = now() where id = $1", [dead]);
    const mine = await created(w.mem1, { shelf: "me", name: "他人の自分のフォルダ" });
    for (const parent of [randomUUID(), dead, mine]) {
      expect((await edit(w.boss, a, { parent_folder_id: parent })).status, parent).toBe(404);
    }
    expect((await frow(a))!["parent_folder_id"]).toBeNull();
  });

  it("K678-API-015 消す：空のフォルダは 200 { id }・DB は消した印（行は残る）・同じ名前を作り直せる", async () => {
    const w = await world("K678 消す");
    const a = await created(w.boss, { shelf: "company", name: "空のフォルダ" });
    const r = await remove(w.boss, a);
    expect(r.status).toBe(200);
    expect((await h.json(r)).data).toEqual({ id: a });
    expect((await frow(a))!["deleted_at"]).not.toBeNull();
    expect((await make(w.boss, { shelf: "company", name: "空のフォルダ" })).status).toBe(201);
    const g = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "営業の空" });
    expect((await remove(w.mgr1, g)).status).toBe(200);
    const m = await created(w.mem1, { shelf: "me", name: "自分の空" });
    expect((await remove(w.mem1, m)).status).toBe(200);
  });

  it("K678-API-016 中が空でないフォルダは消せない 409 E-KNW-024（中のフォルダ・公開済みのページ・消す人には見えない他人の下書きのページ）。中を片付けると消せる", async () => {
    const w = await world("K678 中がある");
    const f = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "営業のフォルダ" });
    const child = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "子", parent_folder_id: f });
    const page = await h.page({ scope: w.g1, owner: w.mgr1, title: "中のページ", folder: f });
    const hidden = await h.page({ scope: w.g1, owner: w.mgr1b, state: "draft", title: "他人の下書き", folder: f });
    const tryDelete = async () => {
      const r = await remove(w.mgr1, f);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "conflict", code: "E-KNW-024" });
      expect((await frow(f))!["deleted_at"]).toBeNull();
    };
    await tryDelete();
    await h.admin.query("update knowledge_folders set deleted_at = now() where id = $1", [child]);
    await tryDelete();
    await h.admin.query("update knowledge_pages set deleted_at = now() where id = $1", [page]);
    await tryDelete();
    await h.admin.query("update knowledge_pages set deleted_at = now() where id = $1", [hidden]);
    expect((await remove(w.mgr1, f)).status).toBe(200);
    expect((await frow(f))!["deleted_at"]).not.toBeNull();
  });

  it("K678-API-017 古い画面・二度押し：消したフォルダをもう一度消す・直す・その下に作るは 404", async () => {
    const w = await world("K678 二度押し");
    const a = await created(w.boss, { shelf: "company", name: "A" });
    expect((await remove(w.boss, a)).status).toBe(200);
    expect((await remove(w.boss, a)).status).toBe(404);
    expect((await edit(w.boss, a, { name: "B" })).status).toBe(404);
    expect((await make(w.boss, { shelf: "company", name: "子", parent_folder_id: a })).status).toBe(404);
  });

  it("K678-API-018 共有の置き場（K-689）が入る前は、共有を見ずに通る：共有していないグループのフォルダは、マネージャーが消せる・動かせる（共有の確かめで止まらない）", async () => {
    const w = await world("K678 共有の前");
    const a = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "共有していない" });
    const b = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "移し先" });
    expect((await edit(w.mgr1, a, { parent_folder_id: b })).status).toBe(200);
    expect((await remove(w.mgr1, a)).status).toBe(200);
  });

  it("K678-API-019 ログインしていない要求は 3 本とも 401", async () => {
    const id = randomUUID();
    expect((await make(null, { shelf: "company", name: "x" })).status).toBe(401);
    expect((await edit(null, id, { name: "x" })).status).toBe(401);
    expect((await remove(null, id)).status).toBe(401);
  });

  it("K678-API-020 上限を超えると 429（1 分 60 回の上限を 2 に差し替えた口の 3 回目）", async () => {
    const w = await world("K678 上限");
    h.limits["createKnowledgeFolder"] = 2;
    try {
      expect((await make(w.boss, { shelf: "company", name: "1" })).status).toBe(201);
      expect((await make(w.boss, { shelf: "company", name: "2" })).status).toBe(201);
      const r = await make(w.boss, { shelf: "company", name: "3" });
      expect(r.status).toBe(429);
      const sec = (await h.json(r))["retry_after_sec"] as number;
      expect(Number.isInteger(sec) && sec >= 1 && sec <= 60).toBe(true);
    } finally {
      delete h.limits["createKnowledgeFolder"];
    }
  });

  it("K678-API-021 権限を外した直後・付けた直後・グループを抜けた直後：入り直さなくても次の操作から効く（外された人は 403、抜けた人は 404、マネージャーにされた人は作れる）", async () => {
    const w = await world("K678 波及");
    const own = await created(w.mgr1, { shelf: "group", group_id: w.g1, name: "営業のフォルダ" });
    await h.admin.query("update scope_memberships set role = 'member' where member_id = $1 and scope_id = $2", [
      w.mgr1.id,
      w.g1,
    ]);
    expect((await make(w.mgr1, { shelf: "group", group_id: w.g1, name: "もう作れない" })).status).toBe(403);
    expect((await edit(w.mgr1, own, { name: "もう直せない" })).status).toBe(403);
    expect((await remove(w.mgr1, own)).status).toBe(403);
    await h.admin.query("delete from scope_memberships where member_id = $1 and scope_id = $2", [w.mgr1.id, w.g1]);
    await h.admin.query("update members set scope_id = $2 where id = $1", [w.mgr1.id, w.co.rootScope]);
    expect((await edit(w.mgr1, own, { name: "もう見えない" })).status).toBe(404);
    expect((await make(w.view1, { shelf: "group", group_id: w.g1, name: "まだ作れない" })).status).toBe(403);
    await h.admin.query("update scope_memberships set role = 'manager' where member_id = $1 and scope_id = $2", [
      w.view1.id,
      w.g1,
    ]);
    expect((await make(w.view1, { shelf: "group", group_id: w.g1, name: "作れる" })).status).toBe(201);
    expect((await frow(own))!["name"]).toBe("営業のフォルダ");
  });

  it("K678-API-022 手順 2 の証跡：作る・直す・消すのたびに audit_events が 1 行（操作した人・対象のフォルダ・関門 C2・名前を入れない）。断った操作には残らない", async () => {
    const w = await world("K678 証跡");
    const a = await created(w.boss, { shelf: "company", name: "秘密の名前の経理" });
    await edit(w.boss, a, { name: "秘密の名前の経理 2" });
    await remove(w.boss, a);
    await make(w.mem1, { shelf: "company", name: "断られる" });
    await edit(w.mem1, a, { name: "断られる" });
    for (const action of ["knowledge.folder.create", "knowledge.folder.update", "knowledge.folder.delete"]) {
      const rows = await audits(w, action);
      expect(rows.length, action).toBe(1);
      expect(rows[0]).toMatchObject({
        actor_member_id: w.boss.id,
        target_type: "knowledge_folders",
        target_id: a,
        choke_point_id: "C2",
      });
      expect(JSON.stringify(rows[0]!.payload), action).not.toContain("秘密の名前");
    }
  });

  it("K678-API-023 失敗（手順 1）：フォルダを書く所で DB が落ちると 503 E-PAGE-003・フォルダも証跡も増えず名前も変わらず、ログに名前を出さない", async () => {
    const w = await world("K678 失敗 1");
    const a = await created(w.boss, { shelf: "company", name: "壊す前" });
    await h.ready();
    const fix = await breakWrites("knowledge_folders", w.co.tenantId);
    let logs = "";
    try {
      logs = await h.captureLogs(async () => {
        const c = await make(w.boss, { shelf: "company", name: "秘密の新しい名前" });
        expect(c.status).toBe(503);
        expect(((await c.json()) as Json)["code"]).toBe("E-PAGE-003");
        const u = await edit(w.boss, a, { name: "秘密の直した名前" });
        expect(u.status).toBe(503);
        const d = await remove(w.boss, a);
        expect(d.status).toBe(503);
      });
    } finally {
      await fix();
    }
    expect(await num("select count(*) as n from knowledge_folders where tenant_id = $1", [w.co.tenantId])).toBe(1);
    expect(await frow(a)).toMatchObject({ name: "壊す前", deleted_at: null });
    expect(
      await num(
        "select count(*) as n from audit_events where tenant_id = $1 and action like 'knowledge.folder.%' and target_id <> $2",
        [w.co.tenantId, a],
      ),
    ).toBe(0);
    expect(logs).not.toContain("秘密の");
  });

  it("K678-API-024 失敗（手順 2）：証跡を書く所で DB が落ちると 503 E-PAGE-003・同じ取引なのでフォルダの行も前のまま（作られず・名前も戻り・消えない）", async () => {
    const w = await world("K678 失敗 2");
    const a = await created(w.boss, { shelf: "company", name: "壊す前" });
    const before = await num("select count(*) as n from audit_events where tenant_id = $1", [w.co.tenantId]);
    await h.ready();
    const fix = await breakWrites("audit_events", w.co.tenantId);
    try {
      expect((await make(w.boss, { shelf: "company", name: "作れない" })).status).toBe(503);
      expect((await edit(w.boss, a, { name: "直せない" })).status).toBe(503);
      expect((await remove(w.boss, a)).status).toBe(503);
    } finally {
      await fix();
    }
    expect(await num("select count(*) as n from knowledge_folders where tenant_id = $1", [w.co.tenantId])).toBe(1);
    expect(await frow(a)).toMatchObject({ name: "壊す前", deleted_at: null });
    expect(await num("select count(*) as n from audit_events where tenant_id = $1", [w.co.tenantId])).toBe(before);
  });

  it("K678-API-025 同時に同じ名前を 2 つ作ると、1 つだけ 201・もう 1 つは 409 E-KNW-020・DB のフォルダは 1 つ", async () => {
    const w = await world("K678 同時");
    await h.ready();
    const rs = await Promise.all([
      make(w.boss, { shelf: "company", name: "同時" }),
      make(w.boss, { shelf: "company", name: "同時" }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const lose = rs.find((r) => r.status === 409)!;
    expect(((await lose.json()) as Json)["code"]).toBe("E-KNW-020");
    expect(await folderCount(w)).toBe(1);
  });

  it("K678-DB-001 DB の関数 app.kn_folder_in_use：中にフォルダ・ページ（下書きも・呼ぶ人に見えない他人の下書きも）があれば true・空か消した物だけなら false・別の会社のフォルダは false", async () => {
    const w = await world("K678 DB の関数");
    const other = await world("K678 DB の関数（別の会社）");
    const f = await h.folder({ scope: w.g1, owner: w.mgr1, name: "営業のフォルダ" });
    const inUse = (p: Person, id: string) =>
      withTenant(h.pool, p.ctx, async (cl) =>
        Boolean((await cl.query<{ b: boolean }>("select app.kn_folder_in_use($1) as b", [id])).rows[0]!.b),
      );
    expect(await inUse(w.mgr1, f)).toBe(false);
    const child = await h.folder({ scope: w.g1, owner: w.mgr1, name: "子", parent: f });
    expect(await inUse(w.mgr1, f)).toBe(true);
    await h.admin.query("update knowledge_folders set deleted_at = now() where id = $1", [child]);
    expect(await inUse(w.mgr1, f)).toBe(false);
    const hidden = await h.page({ scope: w.g1, owner: w.mgr1b, state: "draft", title: "他人の下書き", folder: f });
    expect(await inUse(w.mgr1, f)).toBe(true);
    await h.admin.query("update knowledge_pages set deleted_at = now() where id = $1", [hidden]);
    expect(await inUse(w.mgr1, f)).toBe(false);
    await h.page({ scope: w.g1, owner: w.mgr1, title: "公開のページ", folder: f });
    expect(await inUse(w.mgr1, f)).toBe(true);
    expect(await inUse(other.boss, f)).toBe(false);
  });
});
