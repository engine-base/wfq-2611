// K-302「確認のコードで入る口」（verifySignInCode・POST /api/v1/auth/two-factor/verify）の単体の試験（口・本物の DB・本物のログインの部品）。
// 名前の頭の行 ID（K302-API-…）は 11_tickets/K-302.md の表のマスと分岐に 1 対 1 で結ぶ。土台・口の形・決めた文は login.harness.ts（K-301 が持ち込む）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
// 足すエラーの番号は精査の後の決め 1 で決め打ち：E-AUTH-013（待ちの印が切れた）・E-AUTH-014（6 けたの止め）。文は決めた文（D-128.141）。
import { describe, expect, it } from "vitest";
import {
  CODE_LOCKED_MESSAGE,
  PW,
  TF_EXPIRED_MESSAGE,
  UA_MAC,
  VERIFY_CODE,
  awayFromStepEdge,
  CODE_LOCKED,
  TF_EXPIRED,
  msg,
  pendingOf,
  setPendingExpiry,
  setupLogin,
  totp,
  type User,
} from "./login.harness.js";

const h = setupLogin("k302");

const codeOk = async (u: User, pending: string, step = 0, ua = UA_MAC) => {
  const r = await h.verifyCode({ pending, code: totp(u.secret!, step) }, { ua });
  return r;
};
const failures = async (userId: string) =>
  (
    await h.admin.query<{ n: number; until: Date | null }>(
      'select "failedVerificationCount" as n, "lockedUntil" as until from kaname_auth."twoFactor" where "userId" = $1',
      [userId],
    )
  ).rows[0]!;
const securityEvents = async (memberId: string, kind: string) =>
  Number(
    (
      await h.admin.query<{ n: string }>(
        "select count(*) as n from security_events where member_id = $1 and kind_id = $2",
        [memberId, kind],
      )
    ).rows[0]!.n,
  );

describe("K-302 確認のコードで入る：待ちの印の状態 × 入口", () => {
  it("K302-API-001 待ちの印（期限内）× 正しい 6 けた：201・token（その印で入れる）・backup_codes_left 10。sessions に画面のセッションが 1 行増える", async () => {
    const u = await h.makeUser("ok", { twoFactor: true });
    const before = await h.liveSessions(u.memberId);
    const p = await pendingOf(h, u, { ua: UA_MAC });
    const r = await codeOk(u, p);
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data!;
    expect(typeof d["token"]).toBe("string");
    expect(d["backup_codes_left"]).toBe(10);
    expect(await h.resolves(String(d["token"]), UA_MAC)).toBe(true);
    expect(await h.liveSessions(u.memberId)).toBe(before + 1);
  });

  it("K302-API-002 入った後に同じ待ちの印をもう一度：401・待ちの印が切れた（足すエラー・文は D-128.141）。セッションは増えない", async () => {
    const u = await h.makeUser("reuse", { twoFactor: true });
    const p = await pendingOf(h, u);
    expect((await codeOk(u, p)).status).toBe(201);
    const after = await h.liveSessions(u.memberId);
    const r = await h.verifyCode({ pending: p, code: totp(u.secret!) });
    expect(r.status).toBe(401);
    const j = await h.json(r);
    expect(j["code"]).toBe(TF_EXPIRED);
    expect(j["message"]).toBe(TF_EXPIRED_MESSAGE);
    expect(msg(TF_EXPIRED), "errors.json の E-AUTH-013 の文").toBe(TF_EXPIRED_MESSAGE);
    expect(await h.liveSessions(u.memberId)).toBe(after);
  });

  it("K302-API-003 待ちの印が切れた（5 分を過ぎた）× 正しい 6 けた：401・待ちの印が切れた。入れない（セッションを作らない）", async () => {
    const u = await h.makeUser("expired", { twoFactor: true });
    const p = await pendingOf(h, u);
    await setPendingExpiry(h, u.userId, "now() - interval '1 second'");
    const before = await h.authSessions(u.userId);
    const r = await codeOk(u, p);
    expect(r.status).toBe(401);
    expect((await h.json(r))["code"]).toBe(TF_EXPIRED);
    expect(await h.authSessions(u.userId)).toBe(before);
  });

  it("K302-API-004 待ちの印の 5 分の境目（DB の now()）：直前（あと 2 秒）は確かめて入れる、直後は 401・E-AUTH-013（直前と直後は別の人で確かめ、同じ 30 秒の使い回しの守りに当てない）", async () => {
    const before = await h.makeUser("edge-before", { twoFactor: true });
    const p1 = await pendingOf(h, before);
    await setPendingExpiry(h, before.userId, "now() + interval '2 seconds'");
    expect((await codeOk(before, p1)).status).toBe(201);
    const after = await h.makeUser("edge-after", { twoFactor: true });
    const p2 = await pendingOf(h, after);
    await setPendingExpiry(h, after.userId, "now() - interval '1 millisecond'");
    const r = await codeOk(after, p2);
    expect(r.status).toBe(401);
    expect((await h.json(r))["code"], "期限で断る（使い回しの E-AUTH-004 でない）").toBe(TF_EXPIRED);
  });

  it("K302-API-005 待ちの印がでたらめ・前の版の形（Cookie の文字列ごと）：401・待ちの印が切れた（同じ答え）。待ちの印の欄が無い：422", async () => {
    const u = await h.makeUser("garbage", { twoFactor: true });
    const p = await pendingOf(h, u);
    for (const bad of ["AAAAAAAAAAAAAAAAAAAAAAAAAAAA", `better-auth.two_factor=${p}`, `${p}x`]) {
      const r = await h.verifyCode({ pending: bad, code: totp(u.secret!) });
      expect(r.status, bad).toBe(401);
      expect((await h.json(r))["code"], bad).toBe(TF_EXPIRED);
    }
    expect((await h.verifyCode({ code: totp(u.secret!) })).status).toBe(422);
  });

  it("K302-API-006 違う 6 けたの 1〜4 回目：401・E-AUTH-004（文は errors.json）。部品の失敗の数（twoFactor.failedVerificationCount）が 1 つずつ増える", async () => {
    const u = await h.makeUser("wrong", { twoFactor: true });
    for (let i = 1; i <= 4; i++) {
      const p = await pendingOf(h, u);
      const r = await h.verifyCode({ pending: p, code: "000000" === totp(u.secret!) ? "111111" : "000000" });
      expect(r.status).toBe(401);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-AUTH-004");
      expect(j["message"]).toBe(msg("E-AUTH-004"));
      expect((await failures(u.userId)).n).toBe(i);
    }
  });

  it("K302-API-007 6 けたを 5 回違えた：5 回目で 429・6 けたの止め（足すエラー・文は D-128.141）・retry_after_sec は 15 分ぶん。止まっている間は、正しいコードでも、パスワードから入り直した新しい待ちの印でも 429（人ごとの止め）", async () => {
    const u = await h.makeUser("lock", { twoFactor: true });
    const bad = () => ("000000" === totp(u.secret!) ? "111111" : "000000");
    for (let i = 0; i < 4; i++) await h.verifyCode({ pending: await pendingOf(h, u), code: bad() });
    const r = await h.verifyCode({ pending: await pendingOf(h, u), code: bad() });
    expect(r.status).toBe(429);
    const j = await h.json(r);
    expect(j["code"]).toBe(CODE_LOCKED);
    expect(j["message"]).toBe(CODE_LOCKED_MESSAGE);
    expect(msg(CODE_LOCKED), "errors.json の E-AUTH-014 の文").toBe(CODE_LOCKED_MESSAGE);
    expect(Number(j["retry_after_sec"])).toBeGreaterThan(880);
    expect(Number(j["retry_after_sec"])).toBeLessThanOrEqual(900);
    const before = await h.authSessions(u.userId);
    const again = await codeOk(u, await pendingOf(h, u));
    expect(again.status).toBe(429);
    expect((await h.json(again))["code"]).toBe(CODE_LOCKED);
    expect(await h.authSessions(u.userId)).toBe(before);
  });

  it("K302-API-008 6 けたの止めの 15 分の境目：止めの期限があと 2 秒なら 429、過ぎていれば正しいコードで入れる（201）", async () => {
    const u = await h.makeUser("lockedge", { twoFactor: true });
    const setUntil = (sql: string) =>
      h.admin.query(
        `update kaname_auth."twoFactor" set "failedVerificationCount" = 5, "lockedUntil" = ${sql} where "userId" = $1`,
        [u.userId],
      );
    await setUntil("now() + interval '2 seconds'");
    expect((await codeOk(u, await pendingOf(h, u))).status).toBe(429);
    await setUntil("now() - interval '1 millisecond'");
    expect((await codeOk(u, await pendingOf(h, u))).status).toBe(201);
  });
});

describe("K-302 確認のコードで入る：バックアップコード・入力", () => {
  it("K302-API-009 バックアップコード：201・backup_codes_left 9。同じコードを、入り直した新しい待ちの印でもう一度：401・E-AUTH-004", async () => {
    const u = await h.makeUser("backup", { twoFactor: true });
    const code = u.backupCodes![0]!;
    const r = await h.verifyCode({ pending: await pendingOf(h, u), backup_code: code });
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await h.json(r)).data!["backup_codes_left"]).toBe(9);
    const again = await h.verifyCode({ pending: await pendingOf(h, u), backup_code: code });
    expect(again.status).toBe(401);
    expect((await h.json(again))["code"]).toBe("E-AUTH-004");
  });

  it("K302-API-010 バックアップコードの書きゆれ（ハイフンを抜く・前後と間の空白・全角）：部品の形（xxxxx-xxxxx）にそろえてから比べて通る", async () => {
    const u = await h.makeUser("backupnorm", { twoFactor: true });
    const [c1, c2, c3] = u.backupCodes!;
    const wide = (s: string) => s.replace(/[A-Za-z0-9-]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    for (const v of [c1!.replace("-", ""), ` ${c2!.replace("-", " - ")} `, wide(c3!)]) {
      const r = await h.verifyCode({ pending: await pendingOf(h, u), backup_code: v });
      expect(r.status, v).toBe(201);
    }
  });

  it("K302-API-022 バックアップコードは小文字と数字だけで作る（xxxxx-xxxxx）。大文字で打っても小文字にそろえて通る（代表の答え answer=6bdcb125e8f7）", async () => {
    const u = await h.makeUser("backupcase", { twoFactor: true });
    expect(u.backupCodes).toHaveLength(10);
    for (const c of u.backupCodes!) expect(c, "小文字と数字だけ").toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    const r = await h.verifyCode({ pending: await pendingOf(h, u), backup_code: u.backupCodes![0]!.toUpperCase() });
    expect(r.status, await r.clone().text()).toBe(201);
    expect((await h.json(r)).data!["backup_codes_left"]).toBe(9);
  });

  it("K302-API-011 6 けたの全角・間の空白・ハイフン（123 456・１２３４５６・123-456）：NFKC と空白・ハイフンの除きでそろえてから比べて通る", async () => {
    // 同じ 30 秒の使い回しの守り（K302-API-014）に当たらないよう、書きゆれ 1 つにつき 1 人（それぞれ別の鍵）で確かめる
    const forms = [
      (c: string) => `${c.slice(0, 3)} ${c.slice(3)}`,
      (c: string) => c.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)),
      (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`,
    ];
    for (const [i, f] of forms.entries()) {
      const u = await h.makeUser(`codenorm-${i}`, { twoFactor: true });
      await awayFromStepEdge();
      const p = await pendingOf(h, u);
      const r = await h.verifyCode({ pending: p, code: f(totp(u.secret!)) });
      expect(r.status, f("123456")).toBe(201);
    }
  });

  it("K302-API-012 コードが空・65 文字・code と backup_code の両方・どちらも無い：422（空と長すぎは E-VAL-009・文は errors.json）。部品の失敗の数に入れない", async () => {
    const u = await h.makeUser("codeempty", { twoFactor: true });
    const p = await pendingOf(h, u);
    for (const code of ["", "1".repeat(65)]) {
      const r = await h.verifyCode({ pending: p, code });
      expect(r.status, `「${code.slice(0, 5)}」${code.length}`).toBe(422);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-VAL-009");
      expect(j["message"]).toBe(msg("E-VAL-009"));
    }
    expect((await h.verifyCode({ pending: p })).status).toBe(422);
    expect((await h.verifyCode({ pending: p, code: totp(u.secret!), backup_code: u.backupCodes![0] })).status).toBe(
      422,
    );
    expect((await failures(u.userId)).n).toBe(0);
  });

  it("K302-API-013 1 つ前のコード（30 秒前）は通す・2 つ前（60 秒前）は 401・E-AUTH-004", async () => {
    const u = await h.makeUser("window", { twoFactor: true });
    await awayFromStepEdge();
    expect((await codeOk(u, await pendingOf(h, u), -1)).status).toBe(201);
    const old = await codeOk(u, await pendingOf(h, u), -2);
    expect(old.status).toBe(401);
    expect((await h.json(old))["code"]).toBe("E-AUTH-004");
  });

  it("K302-API-014 通った 6 けたを同じ 30 秒のうちにもう一度（パスワードから入り直した新しい待ちの印で）：2 回目は通さない・401・E-AUTH-004", async () => {
    const u = await h.makeUser("replay", { twoFactor: true });
    await awayFromStepEdge();
    const code = totp(u.secret!);
    expect((await h.verifyCode({ pending: await pendingOf(h, u), code })).status).toBe(201);
    const r = await h.verifyCode({ pending: await pendingOf(h, u), code });
    expect(r.status).toBe(401);
    expect((await h.json(r))["code"]).toBe("E-AUTH-004");
  });

  it("K302-API-015 信頼する端末は外した：trust_device を送ると 422（知らない欄）。前に部品で付いた「この端末を信頼する」の印（Cookie）を付けてパスワードで入っても、6 けたを聞く（two_factor=true）", async () => {
    const u = await h.makeUser("trust", { twoFactor: true });
    const p = await pendingOf(h, u);
    expect((await h.verifyCode({ pending: p, code: totp(u.secret!), trust_device: true })).status).toBe(422);
    // 部品の口を直に呼んで「信頼する端末」の印を作る（前の道すじが作っていた印。いまは作る道が無いことの確かめではなく、残っていた印が効かないことの確かめ）
    const si = (
      await (
        h.auth.api as unknown as {
          signInEmail: (o: {
            body: { email: string; password: string };
            returnHeaders: true;
          }) => Promise<{ headers: Headers }>;
        }
      ).signInEmail({ body: { email: u.email, password: PW }, returnHeaders: true })
    ).headers;
    const pendingCookie = si
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .join("; ");
    await awayFromStepEdge();
    const tv = await (
      h.auth.api as unknown as {
        verifyTOTP: (o: {
          headers: Headers;
          body: { code: string; trustDevice: boolean };
          returnHeaders: true;
        }) => Promise<{ headers: Headers }>;
      }
    ).verifyTOTP({
      headers: new Headers({ cookie: pendingCookie }),
      body: { code: totp(u.secret!), trustDevice: true },
      returnHeaders: true,
    });
    const trust = tv.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .filter((c) => /trust/i.test(c))
      .join("; ");
    expect(trust, "部品が信頼の印を出した（確かめの前提）").not.toBe("");
    const r = await h.signIn(u.email, PW, { headers: { cookie: trust } });
    expect(r.status).toBe(201);
    const d = (await h.json(r)).data!;
    expect(d["two_factor"]).toBe(true);
    expect(d["token"] ?? null).toBeNull();
  }, 60_000);
});

describe("K-302 確認のコードで入る：会社の人・失敗・守り", () => {
  it("K302-API-016 パスワードを通った後・6 けたの前に会社から抜けた（members.deleted_at）× 正しい 6 けた：403・E-AUTH-007。生きたセッションは残らない（切り替わりの瞬間・G-12）", async () => {
    const u = await h.makeUser("left", { twoFactor: true });
    const p = await pendingOf(h, u);
    const before = await h.liveSessions(u.memberId); // 準備のセッションは閉じてある（決め 7）・パスワードの段は写さない（K301-API-002）
    await h.admin.query("update members set deleted_at = now() where id = $1", [u.memberId]);
    const r = await codeOk(u, p);
    expect(r.status).toBe(403);
    const j = await h.json(r);
    expect(j["code"]).toBe("E-AUTH-007");
    expect(j["data"]).toBeUndefined();
    expect(await h.liveSessions(u.memberId), "6 けたの要求で生きたセッションが増えない").toBe(before);
  });

  it("K302-API-017 セッションを写す所（sessions への書き込み）で失敗：503・E-PAGE-003。認証側のセッションも残さない", async () => {
    const u = await h.makeUser("halfopen", { twoFactor: true });
    const p = await pendingOf(h, u, { ua: `${UA_MAC} K302-FAIL` });
    const authBefore = await h.authSessions(u.userId);
    await h.admin.query(`create or replace function app.k302_down() returns trigger language plpgsql as $$
      begin if new.device_label like '%K302-FAIL%' then raise exception 'K-302 の試験：sessions に書けない'; end if; return new; end $$`);
    await h.admin.query(
      "create trigger k302_down before insert on sessions for each row execute function app.k302_down()",
    );
    let r: Response | undefined;
    try {
      await h.captureLogs(async () => {
        r = await codeOk(u, p, 0, `${UA_MAC} K302-FAIL`);
      });
    } finally {
      await h.admin.query("drop trigger if exists k302_down on sessions");
      await h.admin.query("drop function if exists app.k302_down()");
    }
    expect(r!.status).toBe(503);
    expect((await h.json(r!))["code"]).toBe("E-PAGE-003");
    expect(await h.authSessions(u.userId)).toBe(authBefore);
  });

  it("K302-API-018 1 分に 11 回（同じ IP）：11 回目は 429・RATE_LIMITED・retry_after_sec。11 回目は 6 けたの失敗の数に入らない", async () => {
    const u = await h.makeUser("rate", { twoFactor: true });
    const p = await pendingOf(h, u);
    const ip = h.nextIp();
    for (let i = 0; i < 10; i++) {
      const r = await h.verifyCode({ pending: `rate-${h.run}-${i}`, code: "000000" }, { ip });
      expect(r.status, `${i + 1} 回目は上限の内`).not.toBe(429);
    }
    const r = await h.verifyCode({ pending: p, code: "000000" }, { ip });
    expect(r.status).toBe(429);
    const j = await h.json(r);
    expect(j["code"]).toBe("RATE_LIMITED");
    expect(Number(j["retry_after_sec"])).toBeGreaterThan(0);
    expect((await failures(u.userId)).n).toBe(0);
  });

  it("K302-API-019 ログ：6 けた・バックアップコード・待ちの印・ログインの印が、成功・失敗・止めのどれでもログに出ない", async () => {
    const u = await h.makeUser("log", { twoFactor: true });
    const seen: string[] = [];
    const logs = await h.captureLogs(async () => {
      const p1 = await pendingOf(h, u);
      seen.push(p1);
      const ok = await h.json(await h.verifyCode({ pending: p1, backup_code: u.backupCodes![1] }));
      seen.push(String(ok.data!["token"]));
      for (let i = 0; i < 5; i++) {
        const p = await pendingOf(h, u);
        seen.push(p);
        await h.verifyCode({ pending: p, code: "000000" === totp(u.secret!) ? "111111" : "000000" });
      }
    });
    for (const s of [...seen, u.backupCodes![1]!, u.secret!, PW]) expect(logs).not.toContain(s);
  });

  it("K302-API-020 記録：6 けたで入ったら login_succeeded、6 けたの違いは login_code_failed、止めは login_code_locked が、その人の会社の security_events に残る（コードは入れない）", async () => {
    const u = await h.makeUser("events", { twoFactor: true });
    const ok0 = await securityEvents(u.memberId, "login_succeeded");
    expect((await codeOk(u, await pendingOf(h, u))).status).toBe(201);
    expect(await securityEvents(u.memberId, "login_succeeded")).toBe(ok0 + 1);
    const bad = () => ("000000" === totp(u.secret!) ? "111111" : "000000");
    for (let i = 0; i < 5; i++) await h.verifyCode({ pending: await pendingOf(h, u), code: bad() });
    expect(await securityEvents(u.memberId, "login_code_failed")).toBe(4);
    expect(await securityEvents(u.memberId, "login_code_locked")).toBe(1);
    const text = JSON.stringify(
      (await h.admin.query("select detail from security_events where member_id = $1", [u.memberId])).rows,
    );
    for (const s of ["000000", "111111", u.secret!]) expect(text).not.toContain(s);
  });

  it("K302-API-021 答えの形：201 の data の欄は token・backup_codes_left の 2 つだけ。失敗の答えに TOTP の鍵・残りのバックアップコードを入れない", async () => {
    const u = await h.makeUser("shape", { twoFactor: true });
    const ok = await h.json(await codeOk(u, await pendingOf(h, u)));
    expect(Object.keys(ok.data!).sort()).toEqual(["backup_codes_left", "token"]);
    const bad = await (
      await h.req("POST", VERIFY_CODE, {
        pending: await pendingOf(h, u),
        code: "000000" === totp(u.secret!) ? "111111" : "000000",
      })
    ).text();
    for (const s of [u.secret!, ...u.backupCodes!]) expect(bad).not.toContain(s);
  });
});
