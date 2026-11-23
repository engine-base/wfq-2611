// K-306「ログアウトする口」（signOut・POST /api/v1/auth/sign-out）の単体の試験（口・本物の DB・本物のログインの部品）。
// 名前の頭の行 ID（K306-API-…）は 11_tickets/K-306.md の表のマスと分岐に 1 対 1 で結ぶ。土台・口の形は login.harness.ts（K-301 が持ち込む）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
// ログインの印は、ログインの部品を直に呼んで作る（auth.api.signInEmail・上限に当たらない）。できたセッションは本番と同じ hook で sessions に写る。
import { describe, expect, it } from "vitest";
import { pairMemberForTest } from "../../bridge_pair.js";
import { PW, SIGN_OUT, UA_MAC, UA_WIN, msg, setupLogin, type User } from "./login.harness.js";

const h = setupLogin("k306");

/** ログインの部品で入り、ログインの印と認証側のセッションの id を返す */
const session = async (u: User, ua = UA_MAC): Promise<{ token: string; id: string }> => {
  const api = h.auth.api as unknown as {
    signInEmail: (o: { headers: Headers; body: { email: string; password: string } }) => Promise<{ token: string }>;
  };
  const r = await api.signInEmail({
    headers: new Headers({ "user-agent": ua }),
    body: { email: u.email, password: PW },
  });
  const id = (await h.admin.query<{ id: string }>("select id from kaname_auth.session where token = $1", [r.token]))
    .rows[0]!.id;
  return { token: r.token, id };
};
const bearer = (t: string, ua = UA_MAC) => ({ authorization: `Bearer ${t}`, "user-agent": ua });
const signOut = (token: string | null, o: { body?: unknown; ip?: string; ua?: string } = {}) =>
  h.req("POST", SIGN_OUT, o.body ?? {}, { ...(o.ip ? { ip: o.ip } : {}), headers: token ? bearer(token, o.ua) : {} });
const row = async (authSessionId: string) =>
  (
    await h.admin.query<{ revoked_at: Date | null; revoke_reason_id: string | null }>(
      "select revoked_at, revoke_reason_id from sessions where auth_session_id = $1",
      [authSessionId],
    )
  ).rows[0];
/** PC（Bridge）の sessions の行の revoked_at（pairMemberForTest の sid） */
const pcRevoked = async (sid: string) =>
  (await h.admin.query<{ r: Date | null }>("select revoked_at as r from sessions where id = $1", [sid])).rows[0]!.r;
const authRow = async (authSessionId: string) =>
  (await h.admin.query("select 1 from kaname_auth.session where id = $1", [authSessionId])).rowCount ?? 0;

describe("K-306 ログアウトする：セッションの状態 × 入口", () => {
  it("K306-API-001 ログイン中 × ログアウト：201・{ signed_out: true }（data の欄はこれだけ）。その画面の認証側のセッションが消え、sessions の行は revoked_at と理由 logout で閉じる。その印ではもう入れない", async () => {
    const u = await h.makeUser("ok");
    const s = await session(u);
    const r = await signOut(s.token);
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data!;
    expect(d).toEqual({ signed_out: true });
    expect(await authRow(s.id)).toBe(0);
    const x = await row(s.id);
    expect(x?.revoked_at).not.toBeNull();
    expect(x?.revoke_reason_id).toBe("logout");
    expect(await h.resolves(s.token)).toBe(false);
  });

  it("K306-API-002 その画面のセッションだけ閉じる：同じ人の別のブラウザのセッションと、PC（Bridge）のセッションは残る（D-125.140 はログアウトを全部切るに入れていない・D-128.121）", async () => {
    const u = await h.makeUser("only-this");
    const a = await session(u, UA_MAC);
    const b = await session(u, UA_WIN);
    const pc = await pairMemberForTest(h.admin, u.memberId, "K-306 の PC");
    expect((await signOut(a.token)).status).toBe(201);
    expect(await h.resolves(b.token, UA_WIN), "別のブラウザは入ったまま").toBe(true);
    expect((await row(b.id))?.revoked_at ?? null).toBeNull();
    expect(await pcRevoked(pc.sid), "PC のセッションは閉じない").toBeNull();
  });

  it("K306-API-003 ログアウトした古い印で、ログアウトとほかの口（GET /api/auth-ext/me）を直に呼ぶ：どれも 401。閉じた行は書き換えない（revoked_at・理由がそのまま）", async () => {
    const u = await h.makeUser("old-token");
    const s = await session(u);
    expect((await signOut(s.token)).status).toBe(201);
    const closed = await row(s.id);
    const again = await signOut(s.token);
    expect(again.status).toBe(401);
    expect((await h.json(again))["code"]).toBe("UNAUTHENTICATED");
    expect((await h.req("GET", "/api/auth-ext/me", undefined, { headers: bearer(s.token) })).status).toBe(401);
    expect(await row(s.id)).toEqual(closed);
  });

  it("K306-API-004 ログインしていない（頭が無い・でたらめの印）：401・UNAUTHENTICATED。何も書かない", async () => {
    const count = async () =>
      Number(
        (await h.admin.query<{ n: string }>("select count(*) as n from sessions where revoked_at is not null")).rows[0]!
          .n,
      );
    const before = await count();
    expect((await signOut(null)).status).toBe(401);
    const r = await signOut("not-a-real-token-0000000000");
    expect(r.status).toBe(401);
    expect((await h.json(r))["code"]).toBe("UNAUTHENTICATED");
    expect(await count()).toBe(before);
  });

  it("K306-API-005 同じ印で同時に 2 回押す：どちらも 201 か 401（500 にならない）・少なくとも 1 つは 201。行は 1 回だけ閉じ、理由は logout", async () => {
    const u = await h.makeUser("double");
    const s = await session(u);
    const rs = await Promise.all([signOut(s.token), signOut(s.token)]);
    const st = rs.map((r) => r.status);
    for (const x of st) expect([201, 401]).toContain(x);
    expect(st).toContain(201);
    expect((await row(s.id))?.revoke_reason_id).toBe("logout");
    expect(await authRow(s.id)).toBe(0);
  });

  it("K306-API-006 同意し直しの印（sessions.terms_pending）が立ったセッション：ログアウトは止めない（201・E-AUTH-010 にしない）", async () => {
    const u = await h.makeUser("terms");
    const s = await session(u);
    await h.admin.query("update sessions set terms_pending = true where auth_session_id = $1", [s.id]);
    const r = await signOut(s.token);
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await row(s.id))?.revoke_reason_id).toBe("logout");
  });

  it("K306-API-007 セッションの見張りで切られた（操作が無い 12 時間を過ぎた）後に押す：401。理由は idle のまま（logout に書き換えない）", async () => {
    const u = await h.makeUser("idle");
    const s = await session(u);
    await h.admin.query("update sessions set last_seen_at = now() - interval '13 hours' where auth_session_id = $1", [
      s.id,
    ]);
    const r = await signOut(s.token);
    expect(r.status).toBe(401);
    expect((await row(s.id))?.revoke_reason_id).toBe("idle");
  });
});

describe("K-306 ログアウトする：入力・失敗・守り", () => {
  it("K306-API-008 知らない欄（all: true・session_id など）：422。セッションは閉じない", async () => {
    const u = await h.makeUser("unknown");
    const s = await session(u);
    for (const body of [{ all: true }, { session_id: s.id }]) {
      const r = await signOut(s.token, { body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect(await h.resolves(s.token)).toBe(true);
  });

  it("K306-API-009 1 分に 61 回（同じ人・別々の印）：60 回目までは 201、61 回目は 429・RATE_LIMITED・retry_after_sec。61 回目の印は閉じない", async () => {
    const u = await h.makeUser("rate");
    const tokens: { token: string; id: string }[] = [];
    for (let i = 0; i < 61; i++) tokens.push(await session(u));
    for (let i = 0; i < 60; i++) expect((await signOut(tokens[i]!.token)).status, `${i + 1} 回目`).toBe(201);
    const r = await signOut(tokens[60]!.token);
    expect(r.status).toBe(429);
    const j = await h.json(r);
    expect(j["code"]).toBe("RATE_LIMITED");
    expect(Number(j["retry_after_sec"])).toBeGreaterThan(0);
    expect((await row(tokens[60]!.id))?.revoked_at ?? null).toBeNull();
  }, 60_000);

  it("K306-API-010 閉じる所（sessions の書き換え）で失敗：503・E-PAGE-003（文は errors.json）。半分だけ閉じない（認証側のセッションも残り、その印でまだ入れる・押し直せば閉じる）", async () => {
    const u = await h.makeUser("fail");
    const s = await session(u);
    await h.admin.query(`create or replace function app.k306_down() returns trigger language plpgsql as $$
      begin if new.auth_session_id = '${s.id}' and new.revoked_at is not null then raise exception 'K-306 の試験：閉じられない'; end if; return new; end $$`);
    await h.admin.query(
      "create trigger k306_down before update on sessions for each row execute function app.k306_down()",
    );
    let r: Response | undefined;
    try {
      await h.captureLogs(async () => {
        r = await signOut(s.token);
      });
    } finally {
      await h.admin.query("drop trigger if exists k306_down on sessions");
      await h.admin.query("drop function if exists app.k306_down()");
    }
    expect(r!.status).toBe(503);
    const j = await h.json(r!);
    expect(j["code"]).toBe("E-PAGE-003");
    expect(j["message"]).toBe(msg("E-PAGE-003"));
    expect(await authRow(s.id)).toBe(1);
    expect(await h.resolves(s.token)).toBe(true);
    expect((await signOut(s.token)).status, "押し直せば閉じる").toBe(201);
  });

  it("K306-API-012 PC の印（x-bridge-session）だけで呼ぶ：403・FORBIDDEN（この口は画面のセッションだけ・PC は端末を外す操作で閉じる）。PC のセッションは閉じない", async () => {
    const u = await h.makeUser("pc-token");
    const pc = await pairMemberForTest(h.admin, u.memberId, "K-306 の PC");
    const r = await h.req(
      "POST",
      SIGN_OUT,
      {},
      {
        headers: { "x-bridge-session": pc.token, "user-agent": "Kaname-Bridge/1.4.0 (Macintosh; Mac OS X)" },
      },
    );
    expect(r.status, await r.clone().text()).toBe(403);
    expect((await h.json(r))["code"]).toBe("FORBIDDEN");
    expect(await pcRevoked(pc.sid)).toBeNull();
  });

  it("K306-API-011 ログ：ログアウトの間（成功・古い印・失敗）に、ログインの印がログに出ない", async () => {
    const u = await h.makeUser("log");
    const s = await session(u);
    const logs = await h.captureLogs(async () => {
      await signOut(s.token);
      await signOut(s.token);
    });
    expect(logs).not.toContain(s.token);
  });
});
