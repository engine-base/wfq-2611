// K-57「PC をつなぐ」の単体の試験（口・本物の DB・本物の PC の印の解決）。名前の頭の行 ID（K57-API-…）は 11_tickets/K-57.md の表のマスに 1 対 1 で結ぶ。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
//   接続コード：英数字 6 けた（0・O・1・I・L を除く）・10 分・1 回だけ・DB はハッシュだけ（D-128.93・D-128.137）
//   PC の印：引き取りで 1 回だけ返る "kpc_…"。画面の一覧の番号（device_id）とは別。DB はハッシュだけ。頭 x-bridge-session で送る
//   時刻は眠らずに、DB の行の時刻（expires_at・last_seen_at）を動かして進める
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { s3Client, s3Presigner } from "@kaname/storage";
import { makeFixture, nextIp, type Fixture, type Person } from "../fixture.js";
import { FAKE_S3, startFakeS3 } from "../../fake-s3.js";

const FIXED_IP = "198.51.100.57";
const ALPHABET = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let f: Fixture;
let T1: { tenantId: string; rootScope: string };
let T2: { tenantId: string; rootScope: string };

const json = async (r: Response) => (await r.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
const pair = async (p: Person, headers: Record<string, string> = {}) => {
  const r = await f.req("POST", "/bridge/pairing-codes", { body: {}, headers: { ...p.auth, ...headers } });
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json(r)).data as { code: string; expires_at: string };
};
const claim = (code: string, device_label = "高本の MacBook", ip = nextIp(), headers: Record<string, string> = {}) =>
  f.req("POST", "/bridge/claim", { body: { code, device_label }, ip, headers });
const claimOk = async (code: string, label?: string) => {
  const r = await claim(code, label);
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json(r)).data as { device_token: string; device_id: string; member_id: string };
};
/** PC の印（machine_id・D-128.174）を付けて引き取る。Bridge が入れたときに PC の中で作る ID（UUID）で、同じ PC かどうかを見分ける */
const claimAs = (code: string, o: { label?: string; machine?: unknown } = {}) =>
  f.req("POST", "/bridge/claim", {
    body: {
      code,
      device_label: o.label ?? "高本の MacBook",
      ...(o.machine === undefined ? {} : { machine_id: o.machine }),
    },
    ip: nextIp(),
  });
const claimAsOk = async (code: string, o: { label?: string; machine?: unknown } = {}) => {
  const r = await claimAs(code, o);
  expect(r.status, await r.clone().text()).toBe(201);
  return (await json(r)).data as { device_token: string; device_id: string; member_id: string };
};
const dev = (token: string, extra: Record<string, string> = {}) => ({ "x-bridge-session": token, ...extra });
const beat = (
  token: string,
  body: unknown = { health: [], protocol: 4, version: "1.4.0" },
  headers: Record<string, string> = {},
) => f.req("POST", "/bridge/heartbeat", { body, headers: dev(token, headers) });
const devices = async (p: Person) => {
  const r = await f.req("GET", "/bridge/devices", { headers: p.auth });
  expect(r.status, await r.clone().text()).toBe(200);
  return (await json(r)).data as unknown as Record<string, unknown>[];
};
const sessionRow = async (id: string) =>
  (await f.admin.query<Record<string, unknown>>("select * from sessions where id = $1", [id])).rows[0]!;
const codeRows = async (member: string) =>
  (
    await f.admin.query<Record<string, unknown>>(
      "select * from bridge_pairing_codes where member_id = $1 order by created_at",
      [member],
    )
  ).rows;
const fields = (j: Record<string, unknown>) =>
  ((j["details"] as { field: string }[] | undefined) ?? []).map((d) => d.field);
const newPerson = (o: Parameters<Fixture["person"]>[2] = {}) => f.person(T1.tenantId, T1.rootScope, o);
const sameAsWrongCode = async (r: Response) => {
  // 形どおりのコードが DB で使えない（違う・期限切れ・使い終わった・出し直す前）は 404・E-CONN-013（K-639：422 にしない・欄は付けない）
  expect(r.status).toBe(404);
  const j = await json(r);
  expect(j["code"]).toBe("E-CONN-013");
  return j;
};

beforeAll(async () => {
  f = await makeFixture();
  T1 = await f.company("K57 の会社 1");
  T2 = await f.company("K57 の会社 2");
}, 60_000);
afterAll(async () => {
  await f?.close();
});

describe("K-57 PC をつなぐ：状態 × 入口 × 利用者の状態（口・本物の DB）", () => {
  it("K57-API-001 PC 無し × 画面 × ログイン中：英数字 6 けたの接続コードを出す（10 分）。DB にはハッシュだけ", async () => {
    const p = await newPerson();
    const c = await pair(p);
    expect(c.code).toMatch(ALPHABET);
    const left = (new Date(c.expires_at).getTime() - Date.now()) / 60_000;
    expect(left).toBeGreaterThan(9.5);
    expect(left).toBeLessThanOrEqual(10.1);
    const rows = await codeRows(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["code_hash"]).toBe(sha(c.code));
  });

  it("K57-API-002 PC 無し × 画面 × 取引先の人・運営の人：403 でコードは出ない（行も作らない）", async () => {
    const p = await newPerson();
    for (const role of ["client", "ops"] as const) {
      const r = await f.req("POST", "/bridge/pairing-codes", { body: {}, headers: f.as(p, role) });
      expect(r.status).toBe(403);
    }
    expect(await codeRows(p.id)).toHaveLength(0);
  });

  it("K57-API-003 コード（期限内・使っていない）× Bridge が引き取る：確定。PC の印を 1 回だけ返し、コードは使い終わり。受け箱に 1 件・はじめにやることに印", async () => {
    const p = await newPerson();
    const c = await pair(p);
    const d = await claimOk(c.code);
    expect(d.device_token).toMatch(/^kpc_[A-Za-z0-9_-]{43}$/);
    expect(d.device_token).not.toBe(d.device_id); // 印は一覧の番号とは別
    expect(d.member_id).toBe(p.id);
    const code = (await codeRows(p.id))[0]!;
    expect(code["used_at"]).not.toBeNull();
    expect(code["used_session_id"]).toBe(d.device_id);
    const s = await sessionRow(d.device_id);
    expect(s["kind_id"]).toBe("bridge");
    expect(s["device_token_hash"]).toBe(sha(d.device_token));
    const n = await f.admin.query(
      "select * from notifications where member_id = $1 and event_kind_id = 'bridge.connected'",
      [p.id],
    );
    expect(n.rowCount).toBe(1);
    const m = await f.admin.query<{ s: number }>("select setup_step as s from members where id = $1", [p.id]);
    expect(m.rows[0]!.s).toBeGreaterThanOrEqual(1);
  });

  it("K57-API-004 コード（期限内）× 画面を再読み込み・「新しいコード」：新しいコードが出て、前のコードは使えなくなる", async () => {
    const p = await newPerson();
    const a = await pair(p);
    const b = await pair(p);
    expect(b.code).not.toBe(a.code);
    await sameAsWrongCode(await claim(a.code));
    await claimOk(b.code);
  });

  it("K57-API-005 前のコード（出し直した）× Bridge が前のコードを入れる：「その接続コードは使えません」（違うコードと同じ返事）", async () => {
    const p = await newPerson();
    const a = await pair(p);
    await pair(p);
    const old = await sameAsWrongCode(await claim(a.code));
    const wrong = await sameAsWrongCode(await claim("ZZZZZZ"));
    expect(old).toEqual(wrong);
  });

  it("K57-API-006 コード（期限切れ・10 分を過ぎた）× Bridge が引き取る：違うコードと同じ返事", async () => {
    const p = await newPerson();
    const c = await pair(p);
    await f.admin.query(
      "update bridge_pairing_codes set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes' where member_id = $1",
      [p.id],
    );
    const expired = await sameAsWrongCode(await claim(c.code));
    expect(expired).toEqual(await sameAsWrongCode(await claim("ZZZZZZ")));
  });

  it("K57-API-007 コード（使い終わり）× 別の PC が同じコードを入れる：「使えません」。先の PC だけがつながったまま", async () => {
    const p = await newPerson();
    const c = await pair(p);
    const first = await claimOk(c.code, "PC 1");
    await sameAsWrongCode(await claim(c.code, "PC 2"));
    expect((await beat(first.device_token)).status).toBe(201);
    const list = await devices(p);
    expect(list.map((x) => x["device_label"])).toEqual(["PC 1"]);
  });

  it("K57-API-008 コード（期限内）× 別の端末のブラウザで同じ人が開く：その端末で新しいコードが出て、前の端末のコードは使えなくなる", async () => {
    const p = await newPerson();
    const onMac = await pair(p, { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/131" });
    const onWin = await pair(p, { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/131" });
    await sameAsWrongCode(await claim(onMac.code));
    await claimOk(onWin.code);
  });

  it("K57-API-009 PC（つながって・生きている）× Bridge が生きている知らせ：最後に見えた時刻が進み、自己診断と版が残る。一覧は「生きている」", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    await f.admin.query("update sessions set last_seen_at = now() - interval '30 seconds' where id = $1", [
      d.device_id,
    ]);
    const before = new Date(String((await sessionRow(d.device_id))["last_seen_at"])).getTime();
    const health = [{ name: "Claude Code", ok: true, detail: "入っている" }];
    const r = await beat(d.device_token, { health, protocol: 5, version: "1.4.0" }); // 約束の版は K-62 で 5
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await json(r)).data).toMatchObject({ ok: true, outdated: false });
    const s = await sessionRow(d.device_id);
    expect(new Date(String(s["last_seen_at"])).getTime()).toBeGreaterThan(before);
    expect(s["health"]).toEqual(health);
    expect(s["bridge_version"]).toBe("1.4.0");
    const [row] = await devices(p);
    expect(row).toMatchObject({ id: d.device_id, state: "live", version: "1.4.0", device_label: "高本の MacBook" });
  });

  it("K57-API-010 PC（つながって・生きている）× 古い Bridge の知らせ：自己診断に「古い」（E-CONN-012）を足す", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    const r = await beat(d.device_token, { health: [], protocol: 2 });
    expect((await json(r)).data).toMatchObject({ outdated: true });
    const s = await sessionRow(d.device_id);
    expect(s["health"]).toEqual([expect.objectContaining({ ok: false, fix: "update", code: "E-CONN-012" })]);
  });

  it("K57-API-011 PC（記録はあるが、まだ一度も知らせが無い）× 一覧：「つながっています」と言わない（待っている・D-090）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    const [row] = await devices(p);
    expect(row).toMatchObject({ id: d.device_id, state: "waiting", last_seen_at: null });
  });

  it("K57-API-012 PC（眠っている・最後の知らせから 75 秒より前）× 一覧：「眠っている」。起きて知らせると「生きている」に戻る", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    await beat(d.device_token);
    await f.admin.query("update sessions set last_seen_at = now() - interval '76 seconds' where id = $1", [
      d.device_id,
    ]);
    expect((await devices(p))[0]).toMatchObject({ state: "asleep" });
    await beat(d.device_token);
    expect((await devices(p))[0]).toMatchObject({ state: "live" });
  });

  it("K57-API-013 PC（つながっている）× ブラウザでログアウト：Bridge はつながったまま（D-128.121）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    await f.admin.query(
      "insert into sessions (tenant_id, member_id, kind_id, auth_session_id) values ($1, $2, 'web', $3)",
      [p.tenantId, p.id, `k57-web-${p.id}`],
    );
    await f.admin.query("select app.close_session($1, 'logout')", [`k57-web-${p.id}`]);
    expect((await beat(d.device_token)).status).toBe(201);
  });

  it("K57-API-014 PC（切れた・外した）× Bridge が生きている知らせ：401（Bridge は印を捨てる）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    await f.admin.query("update sessions set revoked_at = now(), revoke_reason_id = 'logout' where id = $1", [
      d.device_id,
    ]);
    const r = await beat(d.device_token);
    expect(r.status).toBe(401);
    expect((await json(r))["code"]).toBe("UNAUTHENTICATED");
  });

  it("K57-API-015 PC（切れた・パスワードを変えた・再設定した）× 生きている知らせ：401（app.revoke_all_sessions で全部切れる）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    await f.admin.query("select app.revoke_all_sessions($1, 'password_changed')", [p.id]);
    expect((await beat(d.device_token)).status).toBe(401);
  });

  it("K57-API-016 PC（切れた・人が抜けた・止められた）× 生きている知らせ：次の知らせで 401（E-AUTH-005 の扱い）", async () => {
    const left = await newPerson();
    const a = await claimOk((await pair(left)).code);
    await f.admin.query("update members set deleted_at = now() where id = $1", [left.id]);
    expect((await beat(a.device_token)).status).toBe(401);
    const stopped = await newPerson();
    const b = await claimOk((await pair(stopped)).code);
    await f.admin.query("update members set suspended_at = now(), suspended_by = id where id = $1", [stopped.id]);
    expect((await beat(b.device_token)).status).toBe(401);
  });

  it("K57-API-017 PC（国か端末が変わった）× 生きている知らせ：切って 401。セキュリティの出来事に残す（D-128.120）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    const ua = { "user-agent": "Kaname-Bridge/1.4.0 (Macintosh; Mac OS X)" };
    expect((await beat(d.device_token, undefined, { ...ua, "x-vercel-ip-country": "JP" })).status).toBe(201);
    expect((await beat(d.device_token, undefined, { ...ua, "x-vercel-ip-country": "US" })).status).toBe(401);
    const s = await sessionRow(d.device_id);
    expect(s["revoke_reason_id"]).toBe("country_changed");
    const ev = await f.admin.query(
      "select * from security_events where member_id = $1 and kind_id = 'suspicious_connection'",
      [p.id],
    );
    expect(ev.rowCount).toBe(1);
    expect((await beat(d.device_token, undefined, { ...ua, "x-vercel-ip-country": "JP" })).status).toBe(401);
  });

  it("K57-API-018 PC（つながっている）× 別のワークスペースに切り替えて開く：同じ PC として見える（アカウント全体・D-128.137）", async () => {
    const p = await newPerson({ authUserId: `k57-au-${Date.now()}` });
    const d = await claimOk((await pair(p)).code);
    const there = await f.alsoIn(p, T2.tenantId, T2.rootScope);
    expect((await devices(there)).map((x) => x["id"])).toEqual([d.device_id]);
    // 別のワークスペースでコードを出し直しても、同じアカウントの前のコードは使えなくなる
    const a = await pair(p);
    const b = await pair(there);
    await sameAsWrongCode(await claim(a.code));
    await claimOk(b.code, "別の PC");
    expect((await devices(p)).length).toBe(2);
  });

  it("K57-API-019 同じ人・同じ PC の印（machine_id）でつなぎ直す：前のつながりを切って 1 台 1 行（理由は replaced）。名前を変えていても同じ PC（D-128.174）", async () => {
    const p = await newPerson();
    const machine = randomUUID();
    const a = await claimAsOk((await pair(p)).code, { label: "前の名前", machine });
    const b = await claimAsOk((await pair(p)).code, { label: "新しい名前", machine });
    expect((await sessionRow(a.device_id))["revoke_reason_id"]).toBe("replaced");
    expect((await sessionRow(b.device_id))["machine_id"]).toBe(machine);
    expect((await devices(p)).map((x) => x["id"])).toEqual([b.device_id]);
    expect((await beat(a.device_token)).status).toBe(401);
    expect((await beat(b.device_token)).status).toBe(201);
  });

  it("K57-API-051 同じ人・同じ名前・別の PC の印：別の PC として 2 台ともつながる（名前では見分けない・D-128.174）", async () => {
    const p = await newPerson();
    const a = await claimAsOk((await pair(p)).code, { label: "MacBook-Pro", machine: randomUUID() });
    const b = await claimAsOk((await pair(p)).code, { label: "MacBook-Pro", machine: randomUUID() });
    expect((await sessionRow(a.device_id))["revoked_at"]).toBeNull();
    expect((await devices(p)).map((x) => x["id"]).sort()).toEqual([a.device_id, b.device_id].sort());
    expect((await beat(a.device_token)).status).toBe(201);
    expect((await beat(b.device_token)).status).toBe(201);
  });

  it("K57-API-052 印の無い古い Bridge（machine_id を送らない）：同じ PC か分からないので、どの行も切らない・どの行からも切られない（名前が同じでも両方つなぐ・D-128.174）", async () => {
    const p = await newPerson();
    const old1 = await claimAsOk((await pair(p)).code, { label: "古い PC" });
    const old2 = await claimAsOk((await pair(p)).code, { label: "古い PC" });
    expect((await sessionRow(old1.device_id))["machine_id"]).toBeNull();
    // 印のある新しい Bridge がつないでも、印の無い行は同じ PC と見なさない
    const fresh = await claimAsOk((await pair(p)).code, { label: "古い PC", machine: randomUUID() });
    for (const d of [old1, old2, fresh]) {
      expect((await sessionRow(d.device_id))["revoked_at"], d.device_id).toBeNull();
      expect((await beat(d.device_token)).status).toBe(201);
    }
    expect((await devices(p)).length).toBe(3);
  });

  it("K57-API-053 同じ PC の印 × 別の人（この PC の Bridge を別のアカウントに切り替えた）：前の人のつながりは切らない（切るのは同じ人の同じ印だけ・D-128.174）。同じアカウントの別のワークスペースなら同じ人として切る", async () => {
    const machine = randomUUID();
    const p = await newPerson();
    const q = await newPerson();
    const a = await claimAsOk((await pair(p)).code, { machine });
    const b = await claimAsOk((await pair(q)).code, { machine });
    expect((await sessionRow(a.device_id))["revoked_at"]).toBeNull();
    expect((await sessionRow(b.device_id))["revoked_at"]).toBeNull();
    // 同じアカウント（同じログインの人）の別のワークスペースは同じ人（PC はアカウント全体・D-128.137）
    const r = await newPerson({ authUserId: `k57-au-m-${Date.now()}` });
    const there = await f.alsoIn(r, T2.tenantId, T2.rootScope);
    const m2 = randomUUID();
    const c = await claimAsOk((await pair(r)).code, { machine: m2 });
    const d = await claimAsOk((await pair(there)).code, { machine: m2 });
    expect((await sessionRow(c.device_id))["revoke_reason_id"]).toBe("replaced");
    expect((await devices(r)).map((x) => x["id"])).toEqual([d.device_id]);
  });

  it("K57-API-054 入力：PC の印（machine_id）の形が違う（UUID でない・空・長すぎる・数）：422 で欄は machine_id。コードは使い終わりにならない", async () => {
    const p = await newPerson();
    const c = await pair(p);
    for (const machine of ["not-a-uuid", "", `${randomUUID()}x`, "a".repeat(200), 12345]) {
      const r = await claimAs(c.code, { machine });
      expect(r.status, JSON.stringify(machine)).toBe(422);
      expect(fields(await json(r)), JSON.stringify(machine)).toContain("machine_id");
    }
    expect((await codeRows(p.id))[0]!["used_at"]).toBeNull();
    // 大文字の UUID は同じ印として小文字にそろえて持つ（表記ゆらぎ）
    const m = randomUUID();
    const d = await claimAsOk(c.code, { machine: m.toUpperCase() });
    expect((await sessionRow(d.device_id))["machine_id"]).toBe(m);
  });

  it("K57-API-050 同意し直しが要るセッション（K-53 の印）：コードを出す・端末の一覧・新しい版・受け取るは 403・E-AUTH-010（コードは作らない）。PC の印は止めない（D-128.137）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    const before = (await codeRows(p.id)).length;
    for (const [m, path] of [
      ["POST", "/bridge/pairing-codes"],
      ["GET", "/bridge/devices"],
      ["GET", "/bridge/releases/latest"],
      ["GET", "/bridge/releases/mac/file"],
    ] as const) {
      const r = await f.req(m, path, { headers: f.pending(p), ...(m === "POST" ? { body: {} } : {}) });
      expect(r.status, `${m} ${path}: ${await r.clone().text()}`).toBe(403);
      expect((await json(r))["code"], `${m} ${path}`).toBe("E-AUTH-010");
    }
    expect((await codeRows(p.id)).length, "コードは作らない").toBe(before);
    // 同じ人の PC の印は同意し直しの印を見ない（Bridge は時間で切らないので、止めると PC の仕事が全部止まる）
    expect((await beat(d.device_token)).status).toBe(201);
    expect((await f.req("GET", "/bridge/releases/latest", { headers: dev(d.device_token) })).status).toBe(200);
  });
});

describe("K-57 配布物（受け取る・新しい版を見に来る）", () => {
  const RELEASE = () => {
    const dir = mkdtempSync(join(tmpdir(), "k57-release-"));
    const bytes = Buffer.from("Kaname-Bridge の中身（試験）");
    writeFileSync(join(dir, "Kaname-Bridge-1.4.0-arm64.dmg"), bytes);
    writeFileSync(join(dir, "Kaname-Bridge-1.4.0-arm64-mac.zip"), bytes);
    const manifest = {
      version: "1.4.0",
      released_at: "2026-11-01T00:00:00Z",
      files: [
        {
          platform: "mac",
          arch: "arm64",
          kind: "installer",
          name: "Kaname-Bridge-1.4.0-arm64.dmg",
          sha256: sha(bytes.toString()),
          size: bytes.length,
        },
        {
          platform: "mac",
          arch: "arm64",
          kind: "app",
          name: "Kaname-Bridge-1.4.0-arm64-mac.zip",
          sha256: sha(bytes.toString()),
          size: bytes.length,
        },
        {
          platform: "win",
          arch: "x64",
          kind: "installer",
          name: "Kaname-Bridge-Setup-1.4.0.exe",
          sha256: "a".repeat(64),
          size: 10,
        },
      ],
    };
    writeFileSync(join(dir, "kaname-bridge.json"), JSON.stringify(manifest));
    return { dir, bytes };
  };
  const set = (dir: string, base = "") => {
    f.release.dir = dir;
    f.release.base = base;
  };

  it("K57-API-020 配布物（置いていない）× 受け取る：「まだ配布していません」（E-CONN-014）。新しい版は released: false", async () => {
    set("");
    const p = await newPerson();
    const r = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth });
    expect(r.status).toBe(404);
    expect((await json(r))["code"]).toBe("E-CONN-014");
    const l = await f.req("GET", "/bridge/releases/latest", { headers: p.auth });
    expect((await json(l)).data).toEqual({ released: false });
  });

  it("K57-API-021 配布物（置いてある）× 受け取る・Bridge が新しい版を見に来る：その OS のインストーラを渡す／版と指紋を返す。PC の印でも呼べる", async () => {
    const { dir, bytes } = RELEASE();
    set(dir);
    const p = await newPerson();
    const r = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth });
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes)).toBe(true);
    const d = await claimOk((await pair(p)).code);
    const l = await f.req("GET", "/bridge/releases/latest?os=mac&arch=arm64", { headers: dev(d.device_token) });
    expect(l.status).toBe(200);
    const data = (await json(l)).data!;
    expect(data).toMatchObject({ released: true, version: "1.4.0" });
    expect(data["update"]).toMatchObject({ name: "Kaname-Bridge-1.4.0-arm64-mac.zip", sha256: sha(bytes.toString()) });
    const url = String((data["update"] as { url: string }).url).replace("/api/v1", "");
    const file = await f.req("GET", url, { headers: dev(d.device_token) });
    expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("K57-API-022 配布物（目録にあるのにファイルが無い）× 受け取る：「まだ配布していません」と同じ扱い", async () => {
    const { dir } = RELEASE();
    set(dir);
    const p = await newPerson();
    const r = await f.req("GET", "/bridge/releases/win/file", { headers: p.auth });
    expect(r.status).toBe(404);
    expect((await json(r))["code"]).toBe("E-CONN-014");
  });

  it("K57-API-023 入力：OS・CPU が違う値：受け取るは 422、新しい版は更新を返さない", async () => {
    const { dir } = RELEASE();
    set(dir);
    const p = await newPerson();
    expect((await f.req("GET", "/bridge/releases/linux/file", { headers: p.auth })).status).toBe(422);
    const l = await f.req("GET", "/bridge/releases/latest?os=mac&arch=riscv", { headers: p.auth });
    expect((await json(l)).data).toMatchObject({ released: true, update: null });
  });

  it("K57-API-024 失敗：置き場（BRIDGE_RELEASE_BASE）に届かない：「読み込めませんでした」（E-PAGE-007）。「まだ配布していません」と混ぜない", async () => {
    set("", "http://127.0.0.1:9/k57-unreachable");
    const p = await newPerson();
    const r = await f.req("GET", "/bridge/releases/latest", { headers: p.auth });
    expect(r.status).toBe(503);
    expect((await json(r))["code"]).toBe("E-PAGE-007");
    const d = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth });
    expect((await json(d))["code"]).toBe("E-PAGE-007");
  });

  it("K57-API-025 失敗：目録（kaname-bridge.json）が壊れている・形が違う：配っていない扱い（500 にしない）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "k57-broken-"));
    writeFileSync(join(dir, "kaname-bridge.json"), "{not json");
    set(dir);
    const p = await newPerson();
    const l = await f.req("GET", "/bridge/releases/latest", { headers: p.auth });
    expect(l.status).toBe(200);
    expect((await json(l)).data).toEqual({ released: false });
    writeFileSync(join(dir, "kaname-bridge.json"), JSON.stringify({ version: "x", files: "no" }));
    expect((await json(await f.req("GET", "/bridge/releases/latest", { headers: p.auth }))).data).toEqual({
      released: false,
    });
  });

  it("K57-API-026 守り：配布物の名前に「../」や目録に無い名前：404（置き場の外を指させない）", async () => {
    const { dir } = RELEASE();
    set(dir);
    const p = await newPerson();
    for (const name of ["..%2F..%2Fetc%2Fpasswd", "kaname-bridge.json", "Other-1.0.0.dmg"]) {
      const r = await f.req("GET", `/bridge/releases/${name}/file`, { headers: p.auth });
      expect(r.status, name).toBe(404);
    }
  });

  it("K57-API-027 ログインしていない人が配布物を直に開く：401", async () => {
    const r = await f.req("GET", "/bridge/releases/mac/file");
    expect(r.status).toBe(401);
  });

  it("K57-API-047 配布物（外の置き場 BRIDGE_RELEASE_BASE）× 受け取る：200 で置き場の仕組みが作った短い期限の URL（url・expires_at）を返す。302 にしない。その URL で本当に取れ、期限切れ・書き換えた URL は置き場に断られる。目録に無い名前は URL を作らず 404（E-CONN-014・D-128.153・D-128.160）", async () => {
    // 置き場は S3 互換（path-style：<endpoint>/<バケット>/<頭>）。試験の偽の S3（apps/api/test/fake-s3.ts）は、
    //   SigV4 の期限つき URL を AWS の仕様どおりに計算し直して確かめる（署名した AWS SDK とは別の作り）
    const { dir, bytes } = RELEASE();
    const manifest = readFileSync(join(dir, "kaname-bridge.json"));
    const fake = await startFakeS3();
    const endpoint = fake.endpoint;
    const client = s3Client({
      endpoint,
      region: FAKE_S3.region,
      bucket: "k57-bridge",
      accessKeyId: FAKE_S3.accessKeyId,
      secretAccessKey: FAKE_S3.secretAccessKey,
    });
    const NAME = "Kaname-Bridge-1.4.0-arm64.dmg";
    const prefix = `k57-${randomUUID()}`;
    fake.objects.set(`k57-bridge/${prefix}/kaname-bridge.json`, { body: manifest, public: true });
    fake.objects.set(`k57-bridge/${prefix}/${NAME}`, { body: bytes });
    f.signer.current = s3Presigner(client, endpoint);
    try {
      const base = `${endpoint}/k57-bridge/${prefix}`;
      set("", base);
      const p = await newPerson();
      const before = Date.now();
      const r = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(r.headers.get("location")).toBeNull();
      const d = (await json(r)).data as { url: string; expires_at: string };
      const u = new URL(d.url);
      expect(`${u.origin}${u.pathname}`).toBe(`${base}/${NAME}`);
      // 署名は置き場の仕組み（SigV4）。Kaname の鍵の自前の署名（exp・sig）ではない（D-128.160）
      expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(u.searchParams.has("sig")).toBe(false);
      const left = new Date(d.expires_at).getTime() - before;
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThanOrEqual(10 * 60_000); // 短い期限（10 分まで）
      expect(Number(u.searchParams.get("X-Amz-Expires")) * 1000).toBeLessThanOrEqual(10 * 60_000);
      // 返す期限は、置き場の署名の時刻（X-Amz-Date）＋長さ（X-Amz-Expires）と同じ（Kaname の時計で別に数えない）
      const ad = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(u.searchParams.get("X-Amz-Date") ?? "")!;
      expect(new Date(d.expires_at).getTime()).toBe(
        Date.UTC(+ad[1]!, +ad[2]! - 1, +ad[3]!, +ad[4]!, +ad[5]!, +ad[6]!) +
          Number(u.searchParams.get("X-Amz-Expires")) * 1000,
      );
      // その URL で本当に取れる（置き場が署名を確かめて中身を返す）
      const got = await fetch(d.url);
      expect(got.status).toBe(200);
      expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);
      // 書き換えた URL は断られる：署名・別のファイル・期限を延ばす
      const sigBad = new URL(d.url);
      const sv = sigBad.searchParams.get("X-Amz-Signature")!;
      sigBad.searchParams.set("X-Amz-Signature", `${sv[0] === "0" ? "1" : "0"}${sv.slice(1)}`);
      expect((await fetch(sigBad)).status).toBe(403);
      const other = new URL(d.url);
      other.pathname = other.pathname.replace(NAME, "Kaname-Bridge-1.4.0-arm64-mac.zip");
      expect((await fetch(other)).status).toBe(403);
      const longer = new URL(d.url);
      longer.searchParams.set("X-Amz-Expires", "604800");
      expect((await fetch(longer)).status).toBe(403);
      // 期限切れは断られる（偽の S3 の時計を期限の後へ進める。眠らない）
      const exp = new Date(d.expires_at).getTime();
      fake.setNow(() => exp + 1_000);
      expect((await fetch(d.url)).status).toBe(403);
      expect(fake.denied).toContain("期限切れ");
      fake.setNow(() => exp - 1_000); // 期限の直前は取れる（G-12）
      expect((await fetch(d.url)).status).toBe(200);
      // 目録に載っていない名前は URL を作らず 404
      const miss = await f.req("GET", "/bridge/releases/Other-1.0.0.dmg/file", { headers: p.auth });
      expect(miss.status).toBe(404);
    } finally {
      f.signer.current = null;
      set("", "");
      await fake.close();
    }
  });

  it("K57-API-048 配布物（外の置き場）× 目録はあるがその OS が無い：署名 URL を作らず「まだ配布していません」（E-CONN-014・D-128.153）", async () => {
    const manifest = JSON.stringify({ version: "1.4.0", released_at: "2026-11-01T00:00:00Z", files: [] });
    const srv = createServer((q, s) => {
      if (q.url === "/k57-empty/kaname-bridge.json")
        s.writeHead(200, { "content-type": "application/json" }).end(manifest);
      else s.writeHead(404).end();
    });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
    try {
      set("", `http://127.0.0.1:${(srv.address() as AddressInfo).port}/k57-empty`);
      const p = await newPerson();
      const r = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth });
      expect(r.status).toBe(404);
      const b = await json(r);
      expect(b["code"]).toBe("E-CONN-014");
      expect(JSON.stringify(b)).not.toContain("sig=");
    } finally {
      set("", "");
      await new Promise<void>((ok) => srv.close(() => ok()));
    }
  });

  // 配布物の試験は 1 つの IP から呼ぶ（上限は人ごと。共有の IP の順番を進めて、ほかの試験の IP の上限と重ねない）
  it("K57-API-057 失敗：置き場の頭（BRIDGE_RELEASE_BASE）が置き場の出どころと違う・path-style でない（設定の誤り）：URL を作らず「読み込めませんでした」（E-PAGE-007）。「まだ配布していません」（E-CONN-014）と混ぜない（新しい版の受け取り先も同じ）", async () => {
    const { dir } = RELEASE();
    const manifest = readFileSync(join(dir, "kaname-bridge.json"));
    const store = await startFakeS3(); // 署名の口が向いている置き場
    const other = await startFakeS3(); // 目録を置いた別の出どころ（設定の誤り）
    const client = s3Client({
      endpoint: store.endpoint,
      region: FAKE_S3.region,
      bucket: "k57-bridge",
      accessKeyId: FAKE_S3.accessKeyId,
      secretAccessKey: FAKE_S3.secretAccessKey,
    });
    f.signer.current = s3Presigner(client, store.endpoint);
    try {
      const p = await newPerson();
      // ① 別の出どころ ② 同じ出どころでもバケットの下でない（path-style でない：道がバケットだけ）
      other.objects.set("k57-bridge/rel/kaname-bridge.json", { body: manifest, public: true });
      store.objects.set("kaname-bridge.json", { body: manifest, public: true });
      for (const base of [`${other.endpoint}/k57-bridge/rel`, store.endpoint]) {
        set("", base);
        const d = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth, ip: FIXED_IP });
        expect(d.status, base).toBe(503);
        expect((await json(d))["code"], base).toBe("E-PAGE-007");
        const l = await f.req("GET", "/bridge/releases/latest?os=mac&arch=arm64", { headers: p.auth, ip: FIXED_IP });
        expect(l.status, base).toBe(503);
        expect((await json(l))["code"], base).toBe("E-PAGE-007");
      }
    } finally {
      f.signer.current = null;
      set("", "");
      await store.close();
      await other.close();
    }
  });

  it("K57-API-055 守り：配布物の受け取りを取引先の人・運営の人が呼ぶ：403 で、置き場の URL も中身も返さない（役が合わない）", async () => {
    const { dir } = RELEASE();
    set(dir);
    try {
      const p = await newPerson();
      for (const role of ["client", "ops"] as const) {
        const r = await f.req("GET", "/bridge/releases/mac/file", { headers: f.as(p, role), ip: FIXED_IP });
        expect(r.status, role).toBe(403);
        const text = await r.text();
        expect(text, role).not.toContain("Kaname-Bridge");
      }
    } finally {
      set("");
    }
  });

  it("K57-API-056 守り：配布物の受け取りを 1 分に 121 回：429・待つ秒数（120 回までは受け取れる）", async () => {
    const { dir } = RELEASE();
    set(dir);
    try {
      const p = await newPerson();
      for (let i = 0; i < 120; i++)
        expect((await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth, ip: FIXED_IP })).status).toBe(200);
      const r = await f.req("GET", "/bridge/releases/mac/file", { headers: p.auth, ip: FIXED_IP });
      expect(r.status).toBe(429);
      expect((await json(r))["retry_after_sec"]).toBeGreaterThan(0);
    } finally {
      set("");
    }
  }, 60_000); // 何十回も続けて口を呼ぶ送りすぎの確かめ（重い台でも既定の 5 秒で切らない）
});

describe("K-57 入力・失敗・操作の揺れ・守り", () => {
  it("K57-API-028 入力：接続コードが空・形が違う・長すぎる：422 と欄ごとの理由", async () => {
    for (const code of ["", "ABC", "ABCDE0", "A".repeat(40)]) {
      const r = await claim(code);
      expect(r.status, code).toBe(422);
      const j = await json(r);
      expect(j["code"]).toBe("VALIDATION_ERROR");
      expect((j["details"] as { field: string }[])[0]!.field).toBe("code");
    }
  });

  it("K57-API-029 入力：コードの大文字小文字・前後の空白・全角・区切りの「-」：正規化して同じコードとして扱う", async () => {
    for (const shape of [
      (c: string) => c.toLowerCase(),
      (c: string) => `  ${c.slice(0, 3)}-${c.slice(3)} `,
      (c: string) => c.replace(/[A-Z0-9]/g, (x) => String.fromCharCode(x.charCodeAt(0) + 0xfee0)),
    ]) {
      const p = await newPerson();
      const c = await pair(p);
      await claimOk(shape(c.code));
    }
  });

  it("K57-API-030 入力：PC の名前が空・長すぎる・制御文字：空なら「この PC」、80 文字で切る、制御文字は消す", async () => {
    const a = await newPerson();
    expect((await sessionRow((await claimOk((await pair(a)).code, "")).device_id))["device_label"]).toBe("この PC");
    const b = await newPerson();
    expect(
      String((await sessionRow((await claimOk((await pair(b)).code, "あ".repeat(100))).device_id))["device_label"]),
    ).toHaveLength(80);
    const c = await newPerson();
    expect(
      (await sessionRow((await claimOk((await pair(c)).code, "My\u0001PC\u0007")).device_id))["device_label"],
    ).toBe("MyPC");
    // K-427：NUL（\u0000）は入口が 422・欄 device_label で断る（前は黙って消して 201 にしていた）。断った後も、同じコードで引き取れる
    const d = await newPerson();
    const code = (await pair(d)).code;
    const nul = await claim(code, "My\u0000PC");
    expect(nul.status, await nul.clone().text()).toBe(422);
    const nulBody = (await json(nul)) as { code?: string; details?: { field: string }[] };
    expect(nulBody.code).toBe("VALIDATION_ERROR");
    expect((nulBody.details ?? []).map((d) => d.field)).toEqual(["device_label"]);
    expect((await sessionRow((await claimOk(code, "MyPC")).device_id))["device_label"]).toBe("MyPC");
  });

  it("K57-API-031 入力：createPairingCode に member_id・code_hash を入れてくる：422（外から入れさせない）", async () => {
    const p = await newPerson();
    const other = await newPerson();
    for (const body of [{ member_id: other.id }, { code_hash: "x".repeat(64) }]) {
      const r = await f.req("POST", "/bridge/pairing-codes", { body, headers: p.auth });
      expect(r.status).toBe(422);
    }
    expect(await codeRows(other.id)).toHaveLength(0);
  });

  it("K57-API-032 入力：生きている知らせの health が配列でない・約束の版が無い：自己診断は空、約束の版が無ければ「古い」", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    const r = await beat(d.device_token, { health: "壊れた", version: "1.0.0" });
    expect(r.status).toBe(201);
    expect((await json(r)).data).toMatchObject({ outdated: true });
    expect((await sessionRow(d.device_id))["health"]).toEqual([expect.objectContaining({ fix: "update" })]);
  });

  it("K57-API-033 失敗：DB が途中で落ちた：引き取りは全部か何もしないか（コードは使い終わりにならず、PC の行も残らない）", async () => {
    const p = await newPerson();
    const c = await pair(p);
    await f.admin.query(`create or replace function app.k57_fail() returns trigger language plpgsql as $$ begin
      if new.member_id = '${p.id}' and new.event_kind_id = 'bridge.connected' then raise exception 'k57 試験の失敗'; end if; return new; end $$`);
    await f.admin.query(
      "create trigger k57_fail before insert on notifications for each row execute function app.k57_fail()",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await claim(c.code);
      expect(r.status).toBe(503);
    } finally {
      spy.mockRestore();
      await f.admin.query("drop trigger k57_fail on notifications");
      await f.admin.query("drop function app.k57_fail()");
    }
    expect((await codeRows(p.id))[0]!["used_at"]).toBeNull();
    const s = await f.admin.query("select 1 from sessions where member_id = $1 and kind_id = 'bridge'", [p.id]);
    expect(s.rowCount).toBe(0);
    await claimOk(c.code); // 落ちる前のコードは、まだ使える
  });

  it("K57-API-034 操作の揺れ：「つなぐ」の 2 回押し・2 つのタブ：コードは最後の 1 つだけが生き、つながる PC は 1 行", async () => {
    const p = await newPerson();
    const [a, b] = await Promise.all([pair(p), pair(p)]);
    const live = (await codeRows(p.id)).filter((x) => x["deleted_at"] === null && x["used_at"] === null);
    expect(live).toHaveLength(1);
    const winner = live[0]!["code_hash"] === sha(a.code) ? a : b;
    await claimOk(winner.code);
    expect(await devices(p)).toHaveLength(1);
  });

  it("K57-API-035 操作の揺れ：同じコードで同時に 2 つの PC が引き取る：1 つだけつながり、もう 1 つは「使えません」", async () => {
    const p = await newPerson();
    const c = await pair(p);
    const rs = await Promise.all([claim(c.code, "PC A"), claim(c.code, "PC B")]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 404]);
    expect(await devices(p)).toHaveLength(1);
  });

  it("K57-API-036 操作の揺れ：Bridge が同じ引き取りを 2 回送る（同じ冪等キーでも）：PC は 1 行。2 回目は「使えません」で、印は 2 度渡さない", async () => {
    const p = await newPerson();
    const c = await pair(p);
    const k = { "idempotency-key": `k57-${p.id}` };
    const ip = nextIp();
    const first = await claim(c.code, "PC", ip, k);
    expect(first.status).toBe(201);
    const again = await claim(c.code, "PC", ip, k);
    const j = await sameAsWrongCode(again);
    expect(JSON.stringify(j)).not.toContain("kpc_");
    expect(await devices(p)).toHaveLength(1);
  });

  it("K57-API-037 操作の揺れ：生きている知らせが重なって 2 回届く：最後に見えた時刻が進むだけ。行は増えない", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    const rs = await Promise.all([beat(d.device_token), beat(d.device_token)]);
    expect(rs.map((r) => r.status)).toEqual([201, 201]);
    const n = await f.admin.query("select 1 from sessions where member_id = $1 and kind_id = 'bridge'", [p.id]);
    expect(n.rowCount).toBe(1);
  });

  it("K57-API-038 守り：引き取りを 1 分に 6 回：429・待つ秒数（D-089：5 回まで）", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) expect((await claim("ZZZZZZ", "PC", ip)).status).toBe(404);
    const r = await claim("ZZZZZZ", "PC", ip);
    expect(r.status).toBe(429);
    expect((await json(r))["retry_after_sec"]).toBeGreaterThan(0);
  });

  it("K57-API-039 守り：コードを出すのを 1 分に 61 回：429・待つ秒数", async () => {
    const p = await newPerson();
    for (let i = 0; i < 60; i++)
      expect((await f.req("POST", "/bridge/pairing-codes", { body: {}, headers: p.auth })).status).toBe(201);
    const r = await f.req("POST", "/bridge/pairing-codes", { body: {}, headers: p.auth });
    expect(r.status).toBe(429);
    expect((await json(r))["retry_after_sec"]).toBeGreaterThan(0);
  }, 60_000); // 何十回も続けて口を呼ぶ送りすぎの確かめ（重い台でも既定の 5 秒で切らない）

  it("K57-API-040 守り：PC の印でコードを出す口・端末の一覧を呼ぶ／画面のログインで生きている知らせを呼ぶ：403（役が合わない・ZT10）", async () => {
    const p = await newPerson();
    const d = await claimOk((await pair(p)).code);
    expect((await f.req("POST", "/bridge/pairing-codes", { body: {}, headers: dev(d.device_token) })).status).toBe(403);
    expect((await f.req("GET", "/bridge/devices", { headers: dev(d.device_token) })).status).toBe(403);
    expect((await f.req("POST", "/bridge/heartbeat", { body: { protocol: 4 }, headers: p.auth })).status).toBe(403);
  });

  it("K57-API-041 守り：他の人・他の会社の PC の印・形だけ合う印で生きている知らせ：401（自分の行しか動かない）", async () => {
    const p = await newPerson();
    const other = await f.person(T2.tenantId, T2.rootScope);
    const mine = await claimOk((await pair(p)).code);
    const theirs = await claimOk((await pair(other)).code);
    await f.admin.query("update sessions set last_seen_at = now() - interval '1 hour' where id = $1", [
      theirs.device_id,
    ]);
    expect((await beat(`kpc_${"A".repeat(43)}`)).status).toBe(401);
    expect((await beat(mine.device_id)).status).toBe(401); // 一覧の番号（sessions の id）では入れない
    expect((await beat(mine.device_token)).status).toBe(201);
    const t = await sessionRow(theirs.device_id);
    expect(Date.now() - new Date(String(t["last_seen_at"])).getTime()).toBeGreaterThan(50 * 60_000);
  });

  it("K57-API-042 守り：端末の一覧は自分の PC だけ。他の人・他の会社の PC は件数にも入らず、印もそのハッシュも返さない", async () => {
    const p = await newPerson();
    const other = await newPerson();
    const far = await f.person(T2.tenantId, T2.rootScope);
    const d = await claimOk((await pair(p)).code);
    await claimOk((await pair(other)).code);
    await claimOk((await pair(far)).code);
    const list = await devices(p);
    expect(list.map((x) => x["id"])).toEqual([d.device_id]);
    const text = JSON.stringify(list);
    expect(text).not.toContain(d.device_token);
    expect(text).not.toContain(sha(d.device_token));
    expect(Object.keys(list[0]!)).not.toContain("device_token_hash");
  });

  it("K57-API-043 守り：DB の中に接続コードも PC の印も平文で無い（ハッシュだけ）", async () => {
    const p = await newPerson();
    const c = await pair(p);
    const d = await claimOk(c.code);
    const rows = await f.admin.query<{ t: string }>(
      "select row_to_json(x)::text as t from bridge_pairing_codes x where member_id = $1 union all select row_to_json(s)::text from sessions s where member_id = $1",
      [p.id],
    );
    for (const r of rows.rows) {
      expect(r.t).not.toContain(c.code);
      expect(r.t).not.toContain(d.device_token);
    }
  });

  it("K57-API-044 守り：ログに接続コードと PC の印が出ない", async () => {
    const out: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))),
    );
    try {
      const p = await newPerson();
      const c = await pair(p);
      const d = await claimOk(c.code);
      await beat(d.device_token);
      await claim(c.code);
      for (const line of out) {
        expect(line).not.toContain(c.code);
        expect(line).not.toContain(d.device_token);
      }
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("K57-API-045 PC 無し × 画面を開いたまま × セッションが切れた：コードの発行で 401（入り直しへ）", async () => {
    const r = await f.req("POST", "/bridge/pairing-codes", { body: {} });
    expect(r.status).toBe(401);
    expect((await json(r))["code"]).toBe("UNAUTHENTICATED");
    expect((await f.req("GET", "/bridge/devices")).status).toBe(401);
    expect((await f.req("GET", "/bridge/releases/latest")).status).toBe(401);
  });

  it("K57-API-046 閲覧のみの人も自分の PC をつなげる（D-128.137）", async () => {
    const viewer = await newPerson({ ticketAbility: "view" });
    const d = await claimOk((await pair(viewer)).code);
    expect((await beat(d.device_token)).status).toBe(201);
  });
});
