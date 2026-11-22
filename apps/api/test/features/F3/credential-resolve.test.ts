// K-354 PC がログイン情報を取り出す口 resolveCredential（POST /api/v1/bridge/credentials/resolve・D-128.57 ②④）。
//   取り出せるのは、つないだ PC が取った動いている仕事のためだけ・持ち主の分身（個人の物）かその範囲の人（ワークスペースの物）だけ・
//   使える場所（宛先のドメイン）に入れるときだけ。答えは PC の鍵でしか開けない封（平文を返さない形）。
// 本番と同じ bootApi・本物の DB・本物の PC の印・本物の関門 C8（土台 credential-device.harness.ts・K-355 が持ち込む）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MemoryVault, RateLimited } from "@kaname/secrets";
import { E, msg, setupCredentialDevice, type Pc, type Sealed, type Who } from "./credential-device.harness.js";
// 作り物の秘密の値は _fake/secrets.ts に置いて import する（.gitleaks.toml が置き場だけを外す・K-328）
import { K354_UNIQUE_PASSWORD, K355_KEY_VALUE, K355_PASSWORD } from "../../_fake/secrets.js";

const h = setupCredentialDevice("k354");
const T = 60_000;
const PASSWORD = K355_PASSWORD;

/** 宛先の判定の表（Bridge の試験 apps/bridge/test/k354-credential-bridge.test.ts の K354-BRG-005 と同じ 1 つのファイルを字として読む。
 *  片方だけ直って、口と Bridge の判定がずれる事を止める）。target＝送る宛先、host＝ブラウザが読む行き先の名前（名前として読めない宛先は null）、
 *  allowed＝使える場所 destinations に入るか。口は allowed なら 201（K354-API-005）、host が在って外なら 403（K354-API-010）、host が null（名前に読めない・253 字超）でも 403・E-CRED-016（K354-API-013。使える場所に入りようが無い。名前が無いので知らせと証跡は残さない）。
 *  入口は体の字を先に NFKC にする（apps/api/src/contract/op.ts の normalize）ので、口は宛先だけ、その前の字で名前を取り出す。
 *  NFKC の後の字で読むと、全角の区切り（／ ＃ ？ ＼）を @ の前に置いた宛先が、ブラウザの行き先と違う名前で使える場所に当たる */
type HostCase = { target: string; host: string | null; allowed: boolean; note: string };
const HOST_CASES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "credential-host-cases.json"), "utf8"),
) as { destinations: string[]; cases: HostCase[] };
const HOST_INSIDE = HOST_CASES.cases.filter((c) => c.allowed);
const HOST_OUTSIDE = HOST_CASES.cases.filter((c) => !c.allowed && c.host !== null);
const HOST_UNREADABLE = HOST_CASES.cases.filter((c) => c.host === null);

/** 本人・PC・個人のログイン情報（PC をつなぐ前に預けるので、預けた直後の確かめは積まれない）。
 *  PC が最初に仕事を問い合わせた時（alive_at が初めて入る）に、まだ確かめていない物（行が no_bridge）の確かめが積まれる（K-355 の引き金）。
 *  預けた物が 2 つある試験は、会話の仕事を取る前に h.drain で片付ける（積まれた確かめが、後から積む会話の仕事より先に返るため） */
async function setup(tag: string, o: Parameters<typeof h.cred>[1] = {}): Promise<{ w: Who; p: Pc; id: string }> {
  const w = await h.who(tag);
  const id = await h.cred(w, o);
  const p = await h.pc(w);
  return { w, p, id };
}
/** 確かめの仕事を積んで PC が取る */
async function checkJob(w: Who, p: Pc, id: string): Promise<string> {
  const r = await h.check(w, id);
  expect(r.status, await r.clone().text()).toBe(201);
  const job = await h.take(p);
  expect(job, "確かめの仕事を取る").not.toBeNull();
  return job!.job_id;
}
/** 会話の仕事を積んで PC が取る */
async function chatTaken(p: Pc, memberId: string, tenantId: string): Promise<string> {
  const id = await h.chatJob(memberId, tenantId);
  const got = await h.take(p);
  expect(got?.job_id, "会話の仕事を取る").toBe(id);
  return id;
}
const body = (job: string, cred: string, pub: string, destination = "hacchu-navi.example") => ({
  job_id: job,
  credential_id: cred,
  destination,
  executor_key: pub,
});
const sealed = async (r: Response) => (await h.json(r)).data as unknown as Sealed;
const useCount = async (id: string) => Number((await h.credRow(id))["use_count"]);

describe("K-354 resolveCredential：取り出せるとき", () => {
  it(
    "K354-API-001 確かめの仕事・使える場所に入れる：201。答えの鍵は決めた 10 個で、PC の鍵で開けるとログイン名・パスワード・鍵。答えの字に平文は無い・no-store",
    async () => {
      const { w, p, id } = await setup("ok", { password: PASSWORD, twoFactor: "sms" });
      const job = await checkJob(w, p, id);
      const k = h.executorKey();
      const r = await h.resolve(p, body(job, id, k.pub));
      const text = await r.clone().text();
      expect(r.status, text).toBe(201);
      const s = await sealed(r);
      expect(Object.keys(s).sort()).toEqual(
        [
          "ciphertext_for_executor",
          "credential_id",
          "destinations",
          "expires_at",
          "iv",
          "kind",
          "name",
          "server_key",
          "tag",
          "two_factor",
        ].sort(),
      );
      expect(s).toMatchObject({
        credential_id: id,
        kind: "login",
        destinations: ["hacchu-navi.example"],
        two_factor: "sms",
      });
      expect(k.open(s, job, id)).toEqual({ login: "me@example.com", password: PASSWORD, totp_secret: null });
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain("me@example.com");
      expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    },
    T,
  );

  it(
    "K354-API-002 使った記録：use_count が 1 増え last_used_at が入る。証跡 credential.bridge_resolve（job_id つき・値は無い）が 1 つ",
    async () => {
      const { w, p, id } = await setup("used");
      const job = await checkJob(w, p, id);
      expect((await h.resolve(p, body(job, id, h.executorKey().pub))).status).toBe(201);
      const row = await h.credRow(id);
      expect(Number(row["use_count"])).toBe(1);
      expect(row["last_used_at"]).not.toBeNull();
      const a = (
        await h.admin.query(
          "select payload::text as t from audit_events where action = 'credential.bridge_resolve' and target_id = $1",
          [id],
        )
      ).rows as { t: string }[];
      expect(a).toHaveLength(1);
      expect(a[0]!.t).toContain(job);
      expect(a[0]!.t).not.toContain(PASSWORD);
    },
    T,
  );

  it(
    "K354-API-003 持ち主の分身の会話の仕事で、自分の個人の物：201",
    async () => {
      const { w, p, id } = await setup("chat");
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      expect((await h.resolve(p, body(job, id, h.executorKey().pub))).status).toBe(201);
    },
    T,
  );

  it(
    "K354-API-004 ワークスペースの物は、同じワークスペースのほかの人の仕事でも 201（その範囲の人の実行）",
    async () => {
      const a = await h.who("ws-a");
      const id = await h.cred(a, { layer: "workspace" });
      const b = await h.who("ws-b");
      const bm = await h.joinWorkspace(b.user, a.user.tenantId);
      const pb = await h.pc(b);
      const job = await chatTaken(pb, bm, a.user.tenantId);
      const k = h.executorKey();
      const r = await h.resolve(pb, body(job, id, k.pub));
      expect(r.status, await r.clone().text()).toBe(201);
      expect(k.open(await sealed(r), job, id)["password"]).toBe(K355_PASSWORD);
    },
    T,
  );

  it(
    "K354-API-005 使える場所の合わせ方（名前の取り出しは new URL の hostname・口と Bridge で同じ関数）：Bridge の試験と同じ表（credential-host-cases.json）の「通る」の宛先（同じ名前・下の階層 login.・大文字・URL の形・末尾の点・全角の英字と点・@ の後ろが使える場所の URL・道の中に全角の区切りと @ が在る URL）と、日本語の名前（punycode）で送っても通る",
    async () => {
      const w = await h.who("sub");
      const id = await h.cred(w, { destinations: HOST_CASES.destinations });
      const jp = await h.cred(w, { destinations: ["例え.jp"] }); // 預ける口が xn--r8jz45g.jp に直して置く
      const p = await h.pc(w);
      const job = await checkJob(w, p, id);
      expect(HOST_INSIDE.length, "表の「通る」の行").toBeGreaterThanOrEqual(9);
      for (const c of HOST_INSIDE) {
        const r = await h.resolve(p, body(job, id, h.executorKey().pub, c.target));
        expect(r.status, `${c.note}: ${c.target}`).toBe(201);
      }
      // PC の最初の問い合わせ（上の checkJob）で、2 つ目の物（jp）の確かめが積まれている。会話の仕事より先に返るので片付ける
      await h.drain(p);
      const chat = await chatTaken(p, w.user.memberId, w.user.tenantId);
      for (const d of ["例え.jp", "https://ログイン.例え.jp/", "xn--r8jz45g.jp"]) {
        const r = await h.resolve(p, body(chat, jp, h.executorKey().pub, d));
        expect(r.status, d).toBe(201);
      }
    },
    T,
  );

  it(
    "K354-API-006 API キー（kind key）：201・kind key・開けると { value }",
    async () => {
      const w = await h.who("key");
      const id = await h.cred(w, { kind: "key", value: K355_KEY_VALUE });
      const p = await h.pc(w);
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      const k = h.executorKey();
      const r = await h.resolve(p, body(job, id, k.pub));
      expect(r.status, await r.clone().text()).toBe(201);
      const s = await sealed(r);
      expect(s.kind).toBe("key");
      expect(k.open(s, job, id)).toEqual({ value: K355_KEY_VALUE });
    },
    T,
  );
});

describe("K-354 resolveCredential：取り出せないとき", () => {
  it(
    "K354-API-007 個人の物を、同じワークスペースのほかの人の仕事で：404（在るかを漏らさない）。証跡 credential.bridge_denied（理由 not_owner）・use_count はそのまま",
    async () => {
      const a = await h.who("own-a");
      const id = await h.cred(a, { layer: "personal" });
      const b = await h.who("own-b");
      const bm = await h.joinWorkspace(b.user, a.user.tenantId);
      const pb = await h.pc(b);
      const job = await chatTaken(pb, bm, a.user.tenantId);
      const r = await h.resolve(pb, body(job, id, h.executorKey().pub));
      expect(r.status).toBe(404);
      expect(await useCount(id)).toBe(0);
      const denied = (
        await h.admin.query(
          "select payload->>'reason' as r from audit_events where action = 'credential.bridge_denied' and target_id = $1",
          [id],
        )
      ).rows as { r: string }[];
      expect(denied.map((x) => x.r)).toEqual(["not_owner"]);
    },
    T,
  );

  it(
    "K354-API-008 ほかのワークスペースの物・消した物・確かめの仕事に結んでいない物：どれも 404・use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("nf");
      const other = await h.who("nf-other");
      const theirs = await h.cred(other);
      const gone = await h.cred(w);
      await h.admin.query("update credentials set deleted_at = now() where id = $1", [gone]);
      const second = await h.cred(w);
      await h.drain(p);
      const job = await checkJob(w, p, id);
      for (const [label, c] of [
        ["ほかのワークスペース", theirs],
        ["消した", gone],
        ["結んでいない", second],
      ] as const) {
        const r = await h.resolve(p, body(job, c, h.executorKey().pub));
        expect(r.status, label).toBe(404);
        expect(await useCount(c), label).toBe(0);
      }
    },
    T,
  );

  it(
    "K354-API-009 仕事が動いていない（まだ取っていない・終わった）：403・E-CRED-010 と目録の文。ほかのアカウントの仕事：404",
    async () => {
      const { w, p, id } = await setup("job");
      const queued = await h.chatJob(w.user.memberId, w.user.tenantId);
      let r = await h.resolve(p, body(queued, id, h.executorKey().pub));
      expect(r.status).toBe(403);
      const j = await h.json(r);
      expect(j["code"]).toBe(E.jobNotRunning);
      expect(String(j["message"] ?? "")).toBe(msg(E.jobNotRunning));
      const taken = await h.take(p);
      await h.admin.query("update bridge_jobs set state_id = 'done', finished_at = now() where id = $1", [
        taken!.job_id,
      ]);
      r = await h.resolve(p, body(taken!.job_id, id, h.executorKey().pub));
      expect(r.status).toBe(403);
      expect((await h.json(r))["code"]).toBe(E.jobNotRunning);
      const stranger = await h.who("job-stranger");
      const ps = await h.pc(stranger);
      const theirs = await chatTaken(ps, stranger.user.memberId, stranger.user.tenantId);
      r = await h.resolve(p, body(theirs, id, h.executorKey().pub));
      expect(r.status).toBe(404);
      expect(await useCount(id)).toBe(0);
    },
    T,
  );

  it(
    "K354-API-010 使える場所の外（Bridge の試験と同じ表 credential-host-cases.json の「外」の宛先：別のドメイン・名前の後ろに足した偽物・前に字を足した偽物・URL の @ の前に名前を置いた偽物・道や問い合わせや断片にだけ名前がある URL・全角の区切り ／ ＃ ？ ＼ と小さい形 ﹖ ﹟ ﹨ を @ の前に置いた偽物。それと *.example.com の名前そのもの）：403・E-CRED-016。持ち主に知らせ（credential.wrong_destination・取り出した名前あり・値は無い）は同じ情報・同じ場所なら 1 時間に 1 つにまとめる（全角の区切りの偽物は @ の後ろの名前 evil.test になる）。証跡（理由 wrong_destination）は毎回。*.example.com の下の名前（login.example.com）は通る",
    async () => {
      const w = await h.who("wrong");
      const id = await h.cred(w, { destinations: HOST_CASES.destinations });
      const wild = await h.cred(w, { destinations: ["*.example.com"] });
      const p = await h.pc(w);
      const job = await checkJob(w, p, id);
      // 表の「外」の宛先が取り出す名前（出た順）。全角の区切りと小さい形の偽物は、どれも @ の後ろの evil.test
      const names = [...new Set(HOST_OUTSIDE.map((c) => c.host))];
      expect(names).toEqual(["evil.example", "hacchu-navi.example.evil.test", "evilhacchu-navi.example", "evil.test"]);
      // 最後は同じ場所（表の 1 行目）をもう一度：知らせは増えない・証跡は増える
      for (const c of [...HOST_OUTSIDE, HOST_OUTSIDE[0]!]) {
        const r = await h.resolve(p, body(job, id, h.executorKey().pub, c.target));
        expect(r.status, `${c.note}: ${c.target}`).toBe(403);
        const j = await h.json(r);
        expect(j["code"], c.target).toBe(E.wrongPlace);
        expect(String(j["message"] ?? ""), c.target).toBe(msg(E.wrongPlace));
      }
      // PC の最初の問い合わせ（上の checkJob）で、ほかの物の確かめが積まれていれば、会話の仕事より先に返るので片付ける
      await h.drain(p);
      const chat = await chatTaken(p, w.user.memberId, w.user.tenantId);
      const self = await h.resolve(p, body(chat, wild, h.executorKey().pub, "https://example.com/login"));
      expect(self.status, "*.example.com に example.com 自身は当たらない").toBe(403);
      expect((await h.json(self))["code"]).toBe(E.wrongPlace);
      const sub = await h.resolve(p, body(chat, wild, h.executorKey().pub, "https://login.example.com/"));
      expect(sub.status, "*.example.com の下の名前は通る").toBe(201);
      const n = (
        await h.admin.query(
          "select payload::text as t, payload->>'destination' as d from notifications where member_id = $1 and event_kind_id = 'credential.wrong_destination' order by created_at",
          [w.user.memberId],
        )
      ).rows as { t: string; d: string }[];
      expect(n.map((x) => x.d)).toEqual([...names, "example.com"]);
      expect(n.map((x) => x.t).join("")).not.toContain(PASSWORD);
      expect(n.map((x) => x.t).join("")).not.toContain("?u=");
      expect(n.map((x) => x.t).join("")).not.toContain("@"); // 知らせに載るのは取り出した名前だけ（@ の前の字・全角の区切りは載らない）
      expect(
        await h.count(
          "select count(*) as n from audit_events where action = 'credential.bridge_denied' and target_id = $1 and payload->>'reason' = 'wrong_destination'",
          [id],
        ),
      ).toBe(HOST_OUTSIDE.length + 1); // 表の「外」の 16 件と、もう一度の 1 件
      expect(await useCount(id)).toBe(0);
    },
    2 * T, // 口への取り出しが 19 回（表の「外」16 件・もう一度・通る名前）。台が混んでも足りるよう 120 秒
  );

  it(
    "K354-API-011 失効した・期限が過ぎた：403・E-CRED-011。use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("revoked");
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      await h.admin.query("update credentials set revoked_at = now() where id = $1", [id]);
      let r = await h.resolve(p, body(job, id, h.executorKey().pub));
      expect(r.status).toBe(403);
      expect((await h.json(r))["code"]).toBe(E.revoked);
      await h.admin.query(
        "update credentials set revoked_at = null, expires_at = now() - interval '1 minute' where id = $1",
        [id],
      );
      r = await h.resolve(p, body(job, id, h.executorKey().pub));
      expect(r.status).toBe(403);
      expect((await h.json(r))["code"]).toBe(E.revoked);
      expect(await useCount(id)).toBe(0);
    },
    T,
  );

  it(
    "K354-API-012 預かり先の物が読めない（参照が壊れた）：403・E-CRED-011（預け直す）。封も平文も返さない・use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("vault");
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      await h.admin.query(
        "update credentials set vault_ref = 'sec_00000000-0000-7000-8000-000000000000' where id = $1",
        [id],
      );
      const r = await h.resolve(p, body(job, id, h.executorKey().pub));
      expect(r.status).toBe(403);
      const j = await h.json(r);
      expect(j["code"]).toBe(E.revoked);
      expect(JSON.stringify(j)).not.toContain("ciphertext_for_executor");
      expect(await useCount(id)).toBe(0);
    },
    T,
  );

  it(
    "K354-API-013 入力：PC の鍵が base64 でない・長さが違う・X25519 でない（Ed25519）、場所が空か空白だけ、job_id が無いのは 422（契約の形）。名前に読めない宛先（Bridge の試験と同じ表 credential-host-cases.json の「名前として読めない」宛先：全角の区切りや全角の ＠ が @ 無しで名前の中・途中に空白・http(s) でない）と 253 文字を超える名前は、使える場所に入りようが無いので 403・E-CRED-016（知らせも証跡も残さない）。use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("input");
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      const ed = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
      const pub = h.executorKey().pub;
      for (const b of [
        body(job, id, "これは鍵でない"),
        body(job, id, Buffer.alloc(10).toString("base64")),
        body(job, id, ed),
        body(job, id, pub, ""),
        body(job, id, pub, "   "),
        { credential_id: id, destination: "hacchu-navi.example", executor_key: pub },
      ]) {
        const r = await h.resolve(p, b);
        expect(r.status, JSON.stringify(b).slice(0, 90)).toBe(422);
      }
      // 名前として読めない宛先：入口の NFKC の後の字で読むと「hacchu-navi.example/evil.test/」になり使える場所に当たってしまう形を含む
      expect(HOST_UNREADABLE.length, "表の「名前として読めない」行").toBeGreaterThanOrEqual(5);
      for (const target of [...HOST_UNREADABLE.map((c) => c.target), `${"a".repeat(250)}.com`]) {
        const r = await h.resolve(p, body(job, id, pub, target));
        expect(r.status, target).toBe(403);
        expect((await h.json(r))["code"], target).toBe(E.wrongPlace);
      }
      expect(await useCount(id)).toBe(0);
      // 名前が取れないので、持ち主への知らせも証跡（wrong_destination）も残さない
      expect(
        await h.count(
          "select count(*) as n from notifications where member_id = $1 and event_kind_id = 'credential.wrong_destination'",
          [w.user.memberId],
        ),
      ).toBe(0);
      expect(
        await h.count(
          "select count(*) as n from audit_events where action = 'credential.bridge_denied' and target_id = $1 and payload->>'reason' = 'wrong_destination'",
          [id],
        ),
      ).toBe(0);
    },
    T,
  );

  it(
    "K354-API-014 利用者の状態：外した PC の印 → 401。use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("gone");
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      await h.admin.query("update sessions set revoked_at = now() where id = $1", [p.sessionId]);
      expect((await h.resolve(p, body(job, id, h.executorKey().pub))).status).toBe(401);
      expect(await useCount(id)).toBe(0);
    },
    T,
  );

  it("K354-API-015 守り：同じ PC から 1 分に 61 回目は 429・retry_after_sec は 1〜60", async () => {
    const { w, p, id } = await setup("rate");
    const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
    const pub = h.executorKey().pub;
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) last = await h.resolve(p, body(job, id, pub, "nowhere.invalid"));
    expect(last!.status).toBe(429);
    const s = Number((await h.json(last!))["retry_after_sec"]);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(60);
  }, 180_000);

  it(
    "K354-API-016 秘密を出さない：取り出す間のログに、ログイン名・パスワード・鍵の値の字が無い",
    async () => {
      const { w, p, id } = await setup("log", { password: K354_UNIQUE_PASSWORD });
      const job = await checkJob(w, p, id);
      const logs = await h.captureLogs(async () => {
        expect((await h.resolve(p, body(job, id, h.executorKey().pub))).status).toBe(201);
      });
      expect(logs).not.toContain(K354_UNIQUE_PASSWORD);
      expect(logs).not.toContain("me@example.com");
    },
    T,
  );

  it(
    "K354-API-017 失敗 S3：使った記録の関数が使えない → 503・E-PAGE-003。封は返さない（記録できない取り出しはしない）・use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("s3");
      const job = await checkJob(w, p, id);
      await h.withoutFn("app.credential_used(uuid, uuid, uuid)", async () => {
        const r = await h.resolve(p, body(job, id, h.executorKey().pub));
        expect(r.status).toBe(503);
        const j = await h.json(r);
        expect(j["code"]).toBe("E-PAGE-003");
        expect(JSON.stringify(j)).not.toContain("ciphertext_for_executor");
      });
      expect(await useCount(id)).toBe(0);
    },
    T,
  );

  it(
    "K354-API-018 失敗 S4：使える場所の外の知らせの関数が使えない → それでも 403・E-CRED-016（止める側に倒す）。知らせは 0",
    async () => {
      const { w, p, id } = await setup("s4");
      const job = await checkJob(w, p, id);
      await h.withoutFn("app.credential_wrong_place(uuid, uuid, uuid, text)", async () => {
        const r = await h.resolve(p, body(job, id, h.executorKey().pub, "evil.example"));
        expect(r.status).toBe(403);
        expect((await h.json(r))["code"]).toBe(E.wrongPlace);
      });
      expect(
        await h.count(
          "select count(*) as n from notifications where member_id = $1 and event_kind_id = 'credential.wrong_destination'",
          [w.user.memberId],
        ),
      ).toBe(0);
    },
    T,
  );

  it(
    "K354-API-019 失敗 S2：預かり先に届かない → 502・E-SEC-001、預かり先の上限 → 503・E-SEC-003 と retry_after_sec 42。どちらも封を返さず、use_count はそのまま",
    async () => {
      const { w, p, id } = await setup("vault-down");
      const job = await chatTaken(p, w.user.memberId, w.user.tenantId);
      // 預かり先（開発の保管先 MemoryVault）の読みを 2 回だけ失敗させる（本番では Infisical に届かない・上限）
      const spy = vi
        .spyOn(MemoryVault.prototype, "get")
        .mockRejectedValueOnce(new Error("預かり先に届かない"))
        .mockRejectedValueOnce(new RateLimited(42));
      try {
        const r = await h.resolve(p, body(job, id, h.executorKey().pub));
        expect(r.status, await r.clone().text()).toBe(502);
        const j = await h.json(r);
        expect(j["code"]).toBe("E-SEC-001");
        expect(JSON.stringify(j)).not.toContain("ciphertext_for_executor");
        const r2 = await h.resolve(p, body(job, id, h.executorKey().pub));
        expect(r2.status, await r2.clone().text()).toBe(503);
        const j2 = await h.json(r2);
        expect(j2["code"]).toBe("E-SEC-003");
        expect(j2["retry_after_sec"]).toBe(42);
        expect(JSON.stringify(j2)).not.toContain("ciphertext_for_executor");
      } finally {
        spy.mockRestore();
      }
      expect(await useCount(id)).toBe(0);
    },
    T,
  );
});
