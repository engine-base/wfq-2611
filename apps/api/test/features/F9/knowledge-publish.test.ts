// K-680「書き終える（公開・版が進む・必ず守るは 2,000 字まで）（publishKnowledgePage）」の単体の試験（口・本物の Postgres・本物の口の入口・偽の画面のログイン）。
//   行 ID は K680-API-NNN（チケット 11_tickets/K-680.md の表の行と 1 対 1）。名前の決めは 07_functional/段10-F9/土台-knowledge.md。
//   土台は knowledge.harness.ts（K-675 が運ぶ）。口の振る舞いは試験の本体（it の中）の h.ready() で読む（answer=8f745003d023）。
//   準備は下書きの版を DB に直に入れる（K-679 の口に頼らない）。書いた結果は別の読み（DB の行・見える人の接続）で確かめる。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@kaname/db/context";
import { bodyOf, setupKnowledge, type Person } from "./knowledge.harness.js";

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
  return { co, g1, g2, boss, mgr1, mgr1b, mem1, view1, mem2, none };
};

type Json = Record<string, unknown>;

const publish = async (p: Person | null, id: string, body: unknown = {}): Promise<Response> => {
  await h.ready();
  return h.req("POST", `/knowledge_pages/${id}/publish`, { ...(p ? { headers: h.as(p) } : {}), body });
};
const prow = async (id: string): Promise<Record<string, unknown> | undefined> => h.row(id);
const versions = async (id: string, kind?: string): Promise<Record<string, unknown>[]> =>
  (
    await h.admin.query(
      "select * from knowledge_page_versions where page_id = $1 and ($2::text is null or kind = $2) order by version, created_at",
      [id, kind ?? null],
    )
  ).rows;
const liveDrafts = async (id: string) => (await versions(id, "draft")).filter((v) => v["deleted_at"] === null);
const num = async (sql: string, p: unknown[]): Promise<number> =>
  Number((await h.admin.query<{ n: string }>(sql, p)).rows[0]!.n);
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
const allAudits = (w: World) => num("select count(*) as n from audit_events where tenant_id = $1", [w.co.tenantId]);

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

/** 下書きの版を足す（行の守りの外）。本文は {doc, text}（既定は段落 1 つ） */
const addDraft = (w: World, page: string, version: number, text: string, by: Person, body: unknown = bodyOf(text)) =>
  h.admin.query(
    "insert into knowledge_page_versions (tenant_id, page_id, version, kind, body, author_member_id) values ($1, $2, $3, 'draft', $4::jsonb, $5)",
    [w.co.tenantId, page, version, JSON.stringify(body), by.id],
  );

/** まだ 1 度も書き終えていないページ（下書きの版 1 つ）を作る */
const newDraftPage = async (w: World, owner: Person, text: string, o: { scope?: string; title?: string } = {}) => {
  const id = await h.page({ scope: o.scope ?? w.g1, owner, state: "draft", title: o.title ?? "書きかけ" });
  await addDraft(w, id, 1, text, owner);
  return id;
};

describe("K-680 書き終える", () => {
  it("K680-API-001 まだ書き終えていないページを書き終える：200 { id, version 1, published_at }・DB はページが公開済み（版 1）・下書きの版が公開の版に変わり・本文はそのまま", async () => {
    const w = await world("K680 初めて");
    const id = await newDraftPage(w, w.mgr1, "最初の本文", { title: "営業の手順" });
    const r = await publish(w.mgr1, id);
    expect(r.status).toBe(200);
    const d = (await h.json(r)).data as Json;
    expect(Object.keys(d).sort()).toEqual(["id", "published_at", "version"]);
    expect(d).toMatchObject({ id, version: 1 });
    expect(new Date(d["published_at"] as string).toISOString()).toBe(d["published_at"]);
    expect(await prow(id)).toMatchObject({ state: "published", current_version: 1, title: "営業の手順" });
    const vs = await versions(id);
    expect(vs.length).toBe(1);
    expect(vs[0]).toMatchObject({ kind: "published", version: 1, published_by: w.mgr1.id, deleted_at: null });
    expect(vs[0]!["published_at"]).not.toBeNull();
    expect(vs[0]!["body"]).toEqual(bodyOf("最初の本文"));
    expect(await liveDrafts(id)).toEqual([]);
  });

  it("K680-API-002 公開済みのページを書き直して書き終える：版が次の番号に進み、前の公開の版は本文ごと残る。下書きの版の番号が飛んでいても付け直される", async () => {
    const w = await world("K680 書き直し");
    const id = await h.page({ scope: w.g1, owner: w.mgr1, title: "公開中", text: "古い本文" });
    await addDraft(w, id, 2, "新しい本文", w.mgr1);
    const r = await publish(w.mgr1, id);
    expect(r.status).toBe(200);
    expect(((await h.json(r)).data as Json)["version"]).toBe(2);
    expect((await prow(id))!["current_version"]).toBe(2);
    const pub = await versions(id, "published");
    expect(pub.map((v) => v["version"])).toEqual([1, 2]);
    expect(pub[0]!["body"]).toEqual(bodyOf("古い本文"));
    expect(pub[1]!["body"]).toEqual(bodyOf("新しい本文"));
    expect(await liveDrafts(id)).toEqual([]);
    await addDraft(w, id, 3, "三つ目の本文", w.mgr1);
    expect(((await h.json(await publish(w.mgr1, id))).data as Json)["version"]).toBe(3);
    const odd = await h.page({ scope: w.g1, owner: w.mgr1, title: "番号が飛んだ下書き" });
    await addDraft(w, odd, 9, "飛んだ番号", w.mgr1);
    expect(((await h.json(await publish(w.mgr1, odd))).data as Json)["version"]).toBe(2);
    expect((await versions(odd, "published")).map((v) => v["version"])).toEqual([1, 2]);
  });

  it("K680-API-003 公開で見える範囲：公開した直後に同じグループの人にページと新しい公開の版が見え、書き終える前の下書きの版は書いた人の接続にしか見えない", async () => {
    const w = await world("K680 見える範囲");
    const seen = (p: Person, id: string, kind: string) =>
      withTenant(h.pool, p.ctx, async (cl) =>
        Number(
          (
            await cl.query<{ n: number }>(
              kind === "page"
                ? "select count(*)::int as n from knowledge_pages where id = $1"
                : "select count(*)::int as n from knowledge_page_versions where page_id = $1 and kind = $2",
              kind === "page" ? [id] : [id, kind],
            )
          ).rows[0]!.n,
        ),
      );
    const fresh = await newDraftPage(w, w.mgr1, "初めての本文");
    expect(await seen(w.mem1, fresh, "page")).toBe(0);
    expect((await publish(w.mgr1, fresh)).status).toBe(200);
    for (const p of [w.mem1, w.mgr1b, w.mgr1]) {
      expect(await seen(p, fresh, "page"), p.id).toBe(1);
      expect(await seen(p, fresh, "published"), p.id).toBe(1);
    }
    expect(await seen(w.mem2, fresh, "page")).toBe(0);
    const open = await h.page({ scope: w.g1, owner: w.mgr1, title: "公開中" });
    await addDraft(w, open, 2, "書いている途中", w.mgr1);
    expect(await seen(w.mgr1, open, "draft")).toBe(1);
    expect(await seen(w.mgr1b, open, "draft")).toBe(0);
    expect(await seen(w.mem1, open, "published")).toBe(1);
    await publish(w.mgr1, open);
    expect(await seen(w.mem1, open, "published")).toBe(2);
  });

  it("K680-API-004 題名・1 行の説明・フォルダ・並び・必ず守るの印・写しの元・持ち主は、書き終えても書く前のまま", async () => {
    const w = await world("K680 動かない物");
    const folder = await h.folder({ scope: w.g1, owner: w.mgr1, name: "経理" });
    const origin = await h.page({ scope: w.g1, owner: w.mgr1, title: "元" });
    const id = await h.page({
      scope: w.g1,
      owner: w.mgr1,
      title: "守るページ",
      summary: "1 行の説明",
      must: true,
      folder,
      position: 30,
      copiedFrom: origin,
      text: "短い",
    });
    await addDraft(w, id, 2, "直した本文", w.mgr1);
    const before = await prow(id);
    expect((await publish(w.mgr1, id)).status).toBe(200);
    const after = await prow(id);
    for (const k of [
      "title",
      "summary",
      "folder_id",
      "position",
      "is_must",
      "copied_from_page_id",
      "owner_member_id",
      "scope_id",
      "is_personal",
    ])
      expect(after![k], k).toEqual(before![k]);
    expect(after).toMatchObject({ title: "守るページ", summary: "1 行の説明", is_must: true, position: 30 });
  });

  it("K680-API-005 書き終える下書きが無いと 409 E-KNW-040（体は { error, code } だけ）：下書きの無い公開済みのページ・別の人の下書きだけがあるページ・公開した直後の同じページ。別の人の下書きは残り、版の数は変わらない", async () => {
    const w = await world("K680 下書き無し");
    const plain = await h.page({ scope: w.g1, owner: w.mgr1, title: "下書き無し" });
    const theirs = await h.page({ scope: w.g1, owner: w.mgr1, title: "別の人が書いている" });
    await addDraft(w, theirs, 2, "先の人の本文", w.mgr1);
    const done = await h.page({ scope: w.g1, owner: w.mgr1, title: "公開した直後" });
    await addDraft(w, done, 2, "本文", w.mgr1);
    expect((await publish(w.mgr1, done)).status).toBe(200);
    for (const [p, id] of [
      [w.mgr1, plain],
      [w.mgr1b, theirs],
      [w.mgr1, done],
    ] as [Person, string][]) {
      const r = await publish(p, id);
      expect(r.status, id).toBe(409);
      expect(await r.json()).toEqual({ error: "conflict", code: "E-KNW-040" });
    }
    expect((await liveDrafts(theirs)).length).toBe(1);
    expect(await prow(theirs)).toMatchObject({ current_version: 1 });
    expect(await prow(plain)).toMatchObject({ current_version: 1 });
    expect(await prow(done)).toMatchObject({ current_version: 2 });
  });

  it("K680-API-006 必ず守るは本文 2,000 字まで：2,001 字は 409 E-KNW-041（体は { error, code } だけ）で下書きのまま残り・版も証跡も増えない。2,000 字ちょうど・必ず守るでないページの長い本文は 200。縮めて保存し直すと書き終えられる", async () => {
    const w = await world("K680 必ず守る");
    const must = await h.page({ scope: w.g1, owner: w.mgr1, title: "守るページ", must: true, text: "短い" });
    await addDraft(w, must, 2, "あ".repeat(2001), w.mgr1);
    const before = await allAudits(w);
    const r = await publish(w.mgr1, must);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "conflict", code: "E-KNW-041" });
    expect((await liveDrafts(must)).length).toBe(1);
    expect((await prow(must))!["current_version"]).toBe(1);
    expect((await versions(must, "published")).length).toBe(1);
    expect(await allAudits(w)).toBe(before);
    await h.admin.query(
      "update knowledge_page_versions set body = $2::jsonb where page_id = $1 and kind = 'draft' and deleted_at is null",
      [must, JSON.stringify(bodyOf("あ".repeat(2000)))],
    );
    expect((await publish(w.mgr1, must)).status).toBe(200);
    const plain = await h.page({ scope: w.g1, owner: w.mgr1, title: "守らないページ", text: "短い" });
    await addDraft(w, plain, 2, "あ".repeat(2500), w.mgr1);
    expect((await publish(w.mgr1, plain)).status).toBe(200);
    expect(((await versions(plain, "published")).at(-1)!["body"] as { text: string }).text.length).toBe(2500);
  });

  it("K680-API-007 字の数え方：必ず守るのページで「あ」2,000 字と絵文字 2,000 字（UTF-16 では 4,000）は 200・絵文字 2,001 字は 409 E-KNW-041。段落をまたぐ本文は区切りの改行も 1 字に数える", async () => {
    const w = await world("K680 字数");
    const run = async (text: string, body?: unknown) => {
      const id = await h.page({ scope: w.g1, owner: w.mgr1, title: "守る", must: true, text: "短い" });
      await addDraft(w, id, 2, text, w.mgr1, body);
      return (await publish(w.mgr1, id)).status;
    };
    expect(await run("あ".repeat(2000))).toBe(200);
    expect(await run("😀".repeat(2000))).toBe(200);
    expect(await run("😀".repeat(2001))).toBe(409);
    const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const two = (a: number, b: number) => ({
      doc: { type: "doc", content: [para("あ".repeat(a)), para("い".repeat(b))] },
      text: `${"あ".repeat(a)}\n${"い".repeat(b)}`,
    });
    expect(await run("", two(1000, 1000))).toBe(409);
    expect(await run("", two(1000, 999))).toBe(200);
  });

  it("K680-API-008 書き終える：書けない人は 403・見えない人と無い・消した id は 404（体は { error, code } だけ）。下書きは下書きのまま・ページは変わらない", async () => {
    const w = await world("K680 書き終えられない");
    const other = await world("K680 書き終えられない（別の会社）");
    const g1p = await h.page({ scope: w.g1, owner: w.mgr1, title: "営業のページ" });
    await addDraft(w, g1p, 2, "書いている", w.mgr1);
    const mine = await h.page({ scope: w.mem1.scopeId, owner: w.mem1, personal: true, title: "自分のページ" });
    await addDraft(w, mine, 2, "自分の下書き", w.mem1);
    const draft = await newDraftPage(w, w.mgr1, "他人の書きかけ");
    const gone = await h.page({ scope: w.g1, owner: w.mgr1, title: "消した" });
    await h.admin.query("update knowledge_pages set deleted_at = now() where id = $1", [gone]);
    const cases: [Person, string, number][] = [
      [w.mem1, g1p, 403],
      [w.view1, g1p, 403],
      [w.mem2, g1p, 404],
      [w.boss, g1p, 404],
      [w.boss, mine, 404],
      [w.mgr1, mine, 404],
      [w.mgr1b, draft, 404],
      [w.mgr1, gone, 404],
      [w.mgr1, randomUUID(), 404],
      [other.boss, g1p, 404],
    ];
    for (const [p, id, status] of cases) {
      const r = await publish(p, id);
      expect(r.status, `${p.id} ${id}`).toBe(status);
      if (status === 404) expect(Object.keys((await r.json()) as Json).sort()).toEqual(["code", "error"]);
    }
    for (const id of [g1p, mine, draft]) expect((await liveDrafts(id)).length, id).toBe(1);
    expect((await prow(g1p))!["current_version"]).toBe(1);
    expect((await prow(draft))!["state"]).toBe("draft");
  });

  it("K680-API-009 ログインしていない要求は 401", async () => {
    expect((await publish(null, randomUUID())).status).toBe(401);
  });

  it("K680-API-010 体の形：空の {} は通る。知らない欄・text・doc を付けた体は 422 で何も変わらない", async () => {
    const w = await world("K680 体の形");
    const id = await newDraftPage(w, w.mgr1, "本文");
    for (const bad of [{ x: 1 }, { text: "直に text" }, { doc: bodyOf("直に doc").doc }]) {
      const r = await publish(w.mgr1, id, bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await prow(id))!["state"]).toBe("draft");
    expect((await liveDrafts(id)).length).toBe(1);
    expect((await publish(w.mgr1, id, {})).status).toBe(200);
  });

  it("K680-API-011 上限を超えると 429（1 分 60 回の上限を 2 に差し替えた口の 3 回目）", async () => {
    const w = await world("K680 上限");
    const id = await h.page({ scope: w.g1, owner: w.mgr1, title: "公開中" });
    h.limits["publishKnowledgePage"] = 2;
    try {
      expect((await publish(w.mgr1, id)).status).toBe(409);
      expect((await publish(w.mgr1, id)).status).toBe(409);
      const r = await publish(w.mgr1, id);
      expect(r.status).toBe(429);
      const sec = (await h.json(r))["retry_after_sec"] as number;
      expect(Number.isInteger(sec) && sec >= 1 && sec <= 60).toBe(true);
    } finally {
      delete h.limits["publishKnowledgePage"];
    }
  });

  it("K680-API-012 二度押し・同時：続けて 2 回押すと 2 回目は 409 E-KNW-040。同じ下書きを同時に書き終えると 1 つだけ 200 で、版も公開の版も 1 つだけ進む", async () => {
    const w = await world("K680 二度押し");
    const a = await h.page({ scope: w.g1, owner: w.mgr1, title: "二度押し" });
    await addDraft(w, a, 2, "本文", w.mgr1);
    expect((await publish(w.mgr1, a)).status).toBe(200);
    const again = await publish(w.mgr1, a);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "conflict", code: "E-KNW-040" });
    expect((await prow(a))!["current_version"]).toBe(2);
    const b = await h.page({ scope: w.g1, owner: w.mgr1, title: "同時" });
    await addDraft(w, b, 2, "本文", w.mgr1);
    await h.ready();
    const rs = await Promise.all([publish(w.mgr1, b), publish(w.mgr1, b)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await prow(b))!["current_version"]).toBe(2);
    expect((await versions(b, "published")).length).toBe(2);
    expect((await audits(w, "knowledge.page.publish")).filter((x) => x.target_id === b).length).toBe(1);
  });

  it("K680-API-013 権限を外した直後・抜けた直後・付けた直後：入り直さなくても次の操作から効く。外された間の下書きは公開にならず残る", async () => {
    const w = await world("K680 波及");
    const pid = await h.page({ scope: w.g1, owner: w.mgr1, title: "営業のページ" });
    await addDraft(w, pid, 2, "書いている", w.mgr1);
    await h.admin.query("update scope_memberships set role = 'member' where member_id = $1 and scope_id = $2", [
      w.mgr1.id,
      w.g1,
    ]);
    expect((await publish(w.mgr1, pid)).status).toBe(403);
    expect((await liveDrafts(pid)).length).toBe(1);
    await h.admin.query("delete from scope_memberships where member_id = $1 and scope_id = $2", [w.mgr1.id, w.g1]);
    await h.admin.query("update members set scope_id = $2 where id = $1", [w.mgr1.id, w.co.rootScope]);
    expect((await publish(w.mgr1, pid)).status).toBe(404);
    const mine = await h.page({ scope: w.g1, owner: w.view1, title: "閲覧のみが書いた物" });
    await addDraft(w, mine, 2, "書いている", w.view1);
    expect((await publish(w.view1, mine)).status).toBe(403);
    await h.admin.query("update scope_memberships set role = 'manager' where member_id = $1 and scope_id = $2", [
      w.view1.id,
      w.g1,
    ]);
    expect((await publish(w.view1, mine)).status).toBe(200);
    expect((await prow(pid))!["current_version"]).toBe(1);
  });

  it("K680-API-014 証跡：書き終えると knowledge.page.publish が 1 行（操作した人・対象のページ・種類 knowledge_pages・関門 C2・payload は版の数だけで題名を入れない）。断った操作には残らない", async () => {
    const w = await world("K680 証跡");
    const id = await newDraftPage(w, w.mgr1, "本文", { title: "秘密の題名" });
    await publish(w.mem1, id);
    await publish(w.mgr1b, id);
    await publish(w.mgr1, randomUUID());
    expect((await audits(w, "knowledge.page.publish")).length).toBe(0);
    expect((await publish(w.mgr1, id)).status).toBe(200);
    await publish(w.mgr1, id);
    const rows = await audits(w, "knowledge.page.publish");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      actor_member_id: w.mgr1.id,
      target_type: "knowledge_pages",
      target_id: id,
      choke_point_id: "C2",
    });
    expect(rows[0]!.payload).toEqual({ version: 1 });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("秘密の");
  });

  it("K680-API-015 失敗（手順 1）：版・ページを書く所で DB が落ちると 503 E-PAGE-003・下書きの版は下書きのまま・ページの版の数は前のまま・ログに題名と本文を出さない", async () => {
    const w = await world("K680 失敗 1");
    const pid = await h.page({ scope: w.g1, owner: w.mgr1, title: "秘密の題名", text: "公開の本文" });
    await addDraft(w, pid, 2, "秘密の下書き", w.mgr1);
    await h.ready();
    let logs = "";
    for (const table of ["knowledge_page_versions", "knowledge_pages"]) {
      const fix = await breakWrites(table, w.co.tenantId);
      try {
        logs += await h.captureLogs(async () => {
          const r = await publish(w.mgr1, pid);
          expect(r.status, table).toBe(503);
          expect(((await r.json()) as Json)["code"]).toBe("E-PAGE-003");
        });
      } finally {
        await fix();
      }
      expect(await prow(pid), table).toMatchObject({ current_version: 1, state: "published" });
      const dr = await liveDrafts(pid);
      expect(dr.length, table).toBe(1);
      expect(dr[0]!["body"], table).toEqual(bodyOf("秘密の下書き"));
      expect((await versions(pid, "published")).length, table).toBe(1);
    }
    expect(logs).not.toContain("秘密の");
  });

  it("K680-API-016 失敗（手順 2）：証跡を書く所で DB が落ちると 503 E-PAGE-003・同じ取引なので公開にならず、下書きも版の数も前のまま・証跡の数も変わらない", async () => {
    const w = await world("K680 失敗 2");
    const pid = await newDraftPage(w, w.mgr1, "書き終えられない");
    const before = await allAudits(w);
    await h.ready();
    const fix = await breakWrites("audit_events", w.co.tenantId);
    try {
      expect((await publish(w.mgr1, pid)).status).toBe(503);
    } finally {
      await fix();
    }
    expect(await prow(pid)).toMatchObject({ state: "draft", current_version: 0 });
    expect((await liveDrafts(pid)).length).toBe(1);
    expect((await versions(pid, "published")).length).toBe(0);
    expect(await allAudits(w)).toBe(before);
  });

  it("K680-API-017 公開のお知らせは出さない：書き終えても受け箱（notifications）の行が 1 つも増えない", async () => {
    const w = await world("K680 お知らせ");
    const count = () => num("select count(*) as n from notifications where tenant_id = $1", [w.co.tenantId]);
    const before = await count();
    const id = await newDraftPage(w, w.mgr1, "本文");
    expect((await publish(w.mgr1, id)).status).toBe(200);
    const open = await h.page({ scope: w.g1, owner: w.mgr1, title: "公開中" });
    await addDraft(w, open, 2, "本文", w.mgr1);
    expect((await publish(w.mgr1, open)).status).toBe(200);
    expect(await count()).toBe(before);
  });
});
