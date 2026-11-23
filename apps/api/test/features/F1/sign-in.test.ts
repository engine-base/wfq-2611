// K-301「パスワードで入る口」（signInWithPassword・POST /api/v1/auth/sign-in）の単体の試験（口・本物の DB・本物のログインの部品）。
// 名前の頭の行 ID（K301-API-…）は 11_tickets/K-301.md の表のマスと分岐に 1 対 1 で結ぶ。土台・口の形・決めた文は login.harness.ts。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { emailHash } from "@kaname/auth/signup";
import {
  FEATURE_DIR,
  LOCKED_MESSAGE,
  PW,
  SIGN_IN,
  UA_MAC,
  UA_WIN,
  failMailTo,
  mails,
  msg,
  setupLogin,
  wrongMessage,
} from "./login.harness.js";

const h = setupLogin("k301");

const fiveWrong = async (email: string, ip?: string) => {
  for (let i = 0; i < 5; i++) await h.signIn(email, "wrong-password-0000", ip ? { ip } : {});
};
const newDeviceNotices = async (memberId: string) =>
  Number(
    (
      await h.admin.query<{ n: string }>(
        "select count(*) as n from notifications where member_id = $1 and event_kind_id = 'security.new_device'",
        [memberId],
      )
    ).rows[0]!.n,
  );
const securityEvents = async (memberId: string, kind: string) =>
  (
    await h.admin.query<{ tenant_id: string; ip_region: string | null; detail: Record<string, unknown> }>(
      "select tenant_id, ip_region, detail from security_events where member_id = $1 and kind_id = $2",
      [memberId, kind],
    )
  ).rows;

describe("K-301 パスワードで入る：アカウントの状態 × 入口 × 利用者の状態", () => {
  it("K301-API-001 2 段階なし × 正しいメールとパスワード × ログインしていない：201・token（その印で入れる）・two_factor=false・pending=null。sessions に画面のセッションが 1 行・失敗の数の行は消える", async () => {
    const u = await h.makeUser("ok");
    await h.signIn(u.email, "wrong-password-0000"); // 失敗を 1 回残してから
    const before = await h.liveSessions(u.memberId);
    const r = await h.signIn(u.email, PW, { ua: UA_MAC });
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data!;
    expect(d["two_factor"]).toBe(false);
    expect(d["pending"] ?? null).toBeNull();
    expect(typeof d["token"]).toBe("string");
    expect(await h.resolves(String(d["token"]), UA_MAC)).toBe(true);
    expect(await h.liveSessions(u.memberId)).toBe(before + 1);
    expect(await h.attempts(u.email), "成功したら app.login_attempts の行は消える").toBeUndefined();
  });

  it("K301-API-002 2 段階あり × 正しいメールとパスワード：201・token=null・two_factor=true・pending（文字列）。まだセッションは作らない（認証側も sessions も増えない）・新しい端末の知らせ（画面とメール）も成功の記録（login_succeeded）も出さない（6 けたの後に出す）。待ちの印の期限は 5 分", async () => {
    const u = await h.makeUser("tf", { twoFactor: true });
    const authBefore = await h.authSessions(u.userId);
    const liveBefore = await h.liveSessions(u.memberId);
    const noticesBefore = await newDeviceNotices(u.memberId);
    const okBefore = (await securityEvents(u.memberId, "login_succeeded")).length;
    const from = mails.length;
    const r = await h.signIn(u.email, PW, { ua: UA_WIN });
    expect(r.status, await r.clone().text()).toBe(201);
    const d = (await h.json(r)).data!;
    expect(d["token"] ?? null).toBeNull();
    expect(d["two_factor"]).toBe(true);
    expect(typeof d["pending"]).toBe("string");
    expect(String(d["pending"]).length).toBeGreaterThan(10);
    expect(await h.authSessions(u.userId)).toBe(authBefore);
    expect(await h.liveSessions(u.memberId), "パスワードの段では sessions に写さない").toBe(liveBefore);
    expect(await newDeviceNotices(u.memberId), "新しい端末の知らせは 6 けたの後").toBe(noticesBefore);
    expect(mails.slice(from).filter((m) => m.to === u.email)).toHaveLength(0);
    expect((await securityEvents(u.memberId, "login_succeeded")).length, "成功の記録は 6 けたの後").toBe(okBefore);
    const left = (
      await h.admin.query<{ s: number }>(
        `select extract(epoch from ("expiresAt" - now()))::float as s from kaname_auth.verification
          where identifier like '2fa-%' and identifier not like '2fa-attempts-%' and value = $1 order by "expiresAt" desc limit 1`,
        [u.userId],
      )
    ).rows[0]!.s;
    expect(left, "待ちの印は 5 分（部品の既定 10 分を 300 秒に直す）").toBeGreaterThan(280);
    expect(left).toBeLessThanOrEqual(300);
  });

  it("K301-API-003 違うパスワードの 1〜4 回目：401・E-AUTH-001。文と remaining に残り回数（4・3・2・1）。間で正しく入れば数え直し（次の失敗は 4）", async () => {
    const u = await h.makeUser("wrong");
    for (const left of [4, 3, 2, 1]) {
      const r = await h.signIn(u.email, "wrong-password-0000");
      expect(r.status).toBe(401);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-AUTH-001");
      expect(j["remaining"]).toBe(left);
      expect(j["message"]).toBe(wrongMessage(left));
    }
    expect((await h.signIn(u.email)).status).toBe(201);
    const again = await h.json(await h.signIn(u.email, "wrong-password-0000"));
    expect(again["remaining"]).toBe(4);
  });

  it("K301-API-004 違うパスワードの 5 回目：429・E-AUTH-002。文は D-128.141 で直した「15 分たってから」の文・retry_after_sec は 15 分ぶん・remaining 0", async () => {
    expect(msg("E-AUTH-002"), "errors.json の E-AUTH-002 の文を直す（解除のメールは作らない）").toBe(LOCKED_MESSAGE);
    const u = await h.makeUser("lock5");
    for (let i = 0; i < 4; i++) await h.signIn(u.email, "wrong-password-0000");
    const r = await h.signIn(u.email, "wrong-password-0000");
    expect(r.status).toBe(429);
    const j = await h.json(r);
    expect(j["code"]).toBe("E-AUTH-002");
    expect(j["message"]).toBe(LOCKED_MESSAGE);
    expect(Number(j["retry_after_sec"])).toBeGreaterThan(880);
    expect(Number(j["retry_after_sec"])).toBeLessThanOrEqual(900);
    expect(j["remaining"]).toBe(0);
  });

  it("K301-API-005 ロック中 × 正しいメールとパスワード：429・E-AUTH-002。正しくても入れず、認証側のセッションも sessions も増えない（サーバーが最後の砦）", async () => {
    const u = await h.makeUser("locked");
    await fiveWrong(u.email);
    const authBefore = await h.authSessions(u.userId);
    const r = await h.signIn(u.email);
    expect(r.status).toBe(429);
    expect((await h.json(r))["code"]).toBe("E-AUTH-002");
    expect(await h.authSessions(u.userId)).toBe(authBefore);
  });

  it("K301-API-006 ロックの 15 分の境目（DB の now()）：直前（あと 2 秒）は 429、ちょうど（期限＝今・1 つの取引の中で app.login_locked_until が null＝入れる）、直後は 201 で入れる", async () => {
    const u = await h.makeUser("edge");
    await fiveWrong(u.email);
    const hash = emailHash(u.email);
    const set = (sql: string) =>
      h.admin.query(`update app.login_attempts set locked_until = ${sql} where email_hash = $1`, [hash]);
    await set("now() + interval '2 seconds'");
    expect((await h.signIn(u.email)).status).toBe(429);
    // ちょうど：同じ取引の中では now() が同じなので、期限＝今 を作って同じ時刻で判定する（要求を挟むと「直後」になる）
    const c = await h.admin.connect();
    try {
      await c.query("begin");
      await c.query("update app.login_attempts set locked_until = now() where email_hash = $1", [hash]);
      const at = await c.query<{ u: Date | null }>("select app.login_locked_until($1) as u", [hash]);
      expect(at.rows[0]!.u, "期限ちょうどはロックの外（locked_until > now() で判定）").toBeNull();
      await c.query("rollback");
    } finally {
      c.release();
    }
    await set("now() - interval '1 millisecond'");
    expect((await h.signIn(u.email)).status).toBe(201);
  });

  it("K301-API-007 登録していないメール・確認していない申し込みだけのメール：401・E-AUTH-001（違うパスワードと同じ文・同じ欄・remaining 4）。失敗の数も同じに数え、5 回目は 429・E-AUTH-002", async () => {
    const ghost = h.email("ghost");
    const u = await h.makeUser("cmp");
    const a = await h.json(await h.signIn(ghost, "wrong-password-0000"));
    const b = await h.json(await h.signIn(u.email, "wrong-password-0000"));
    expect(a).toEqual(b);
    expect(a["code"]).toBe("E-AUTH-001");
    for (let i = 0; i < 3; i++) await h.signIn(ghost, "wrong-password-0000");
    const r = await h.signIn(ghost, "wrong-password-0000");
    expect(r.status).toBe(429);
    expect((await h.json(r))["code"]).toBe("E-AUTH-002");
  });

  it("K301-API-008 時間で有る無しを漏らさない：無いメールの答えにかかる時間（5 回の中央値）が、違うパスワードの中央値の半分を下回らない（無いメールでもパスワードのハッシュを計算する）", async () => {
    const u = await h.makeUser("timing");
    const median = async (e: string) => {
      const ts: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await h.signIn(e, `wrong-password-${i}000`);
        ts.push(performance.now() - t0);
        await h.admin.query(
          "delete from app.login_attempts where email_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
          [e],
        );
      }
      return ts.sort((x, y) => x - y)[2]!;
    };
    const wrong = await median(u.email);
    const ghost = await median(h.email("timing-ghost"));
    expect(ghost, `無いメール ${ghost.toFixed(0)}ms・違うパスワード ${wrong.toFixed(0)}ms`).toBeGreaterThanOrEqual(
      wrong * 0.5,
    );
  });
});

describe("K-301 パスワードで入る：入力", () => {
  it("K301-API-009 メールかパスワードが空：422・E-VAL-008（文は errors.json）。DB は引かず、失敗の数にも入れない", async () => {
    const u = await h.makeUser("empty");
    for (const body of [{ email: u.email, password: "" }, { email: "", password: PW }, {}]) {
      const r = await h.req("POST", SIGN_IN, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-VAL-008");
      expect(j["message"]).toBe(msg("E-VAL-008"));
    }
    expect(await h.attempts(u.email)).toBeUndefined();
  });

  it("K301-API-010 メールの形が違う（@ が無い・ドメインが無い）：422・E-VAL-004。失敗の数に入れない", async () => {
    for (const e of ["no-at-mark.example.com", `${h.run}-x@nodomain`]) {
      const r = await h.signIn(e, "wrong-password-0000");
      expect(r.status, e).toBe(422);
      expect((await h.json(r))["code"]).toBe("E-VAL-004");
      expect(await h.attempts(e)).toBeUndefined();
    }
  });

  it("K301-API-011 メールの全角・前後と途中の空白・大文字：正規化（NFKC・空白を除く・小文字）して同じ人として入れる。違うパスワードも同じ人の数え（残り回数が続く）", async () => {
    const u = await h.makeUser("norm");
    const [local, domain] = u.email.split("@") as [string, string];
    const wide = `\u3000${local.toUpperCase().replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))} @ ${domain.toUpperCase()} `;
    const ok = await h.signIn(wide);
    expect(ok.status, await ok.clone().text()).toBe(201);
    expect((await h.signIn(u.email.toUpperCase(), "wrong-password-0000")).status).toBe(401);
    const second = await h.json(await h.signIn(` ${u.email} `, "wrong-password-0000"));
    expect(second["remaining"], "大文字と空白の違いは同じ人の 2 回目").toBe(3);
  });

  it("K301-API-012 パスワードの前後の空白は直さない（パスワードの一部として比べる）：401・E-AUTH-001", async () => {
    const u = await h.makeUser("pwspace");
    for (const p of [` ${PW}`, `${PW} `]) {
      const r = await h.signIn(u.email, p);
      expect(r.status).toBe(401);
      expect((await h.json(r))["code"]).toBe("E-AUTH-001");
    }
  });

  it("K301-API-013 知らない欄（remember_me・trust_device など）：422（契約の strict）。DB は引かず、失敗の数に入れない", async () => {
    const u = await h.makeUser("unknown");
    const before = await h.liveSessions(u.memberId);
    const r = await h.req("POST", SIGN_IN, { email: u.email, password: PW, remember_me: true });
    expect(r.status).toBe(422);
    expect(await h.liveSessions(u.memberId)).toBe(before);
    expect(await h.attempts(u.email)).toBeUndefined();
  });
});

describe("K-301 パスワードで入る：会社の人・セッション・知らせ", () => {
  it("K301-API-014 会社の人が抜けた（members.deleted_at）× 正しいパスワード：403・E-AUTH-007（文は errors.json）。生きたセッションは残らず、その印でも入れない。違うパスワードなら E-AUTH-001 のまま（止めの有無を探らせない）", async () => {
    const u = await h.makeUser("left");
    const before = await h.liveSessions(u.memberId); // 準備のセッションは閉じてある（決め 7）
    await h.admin.query("update members set deleted_at = now() where id = $1", [u.memberId]);
    const wrong = await h.signIn(u.email, "wrong-password-0000");
    expect(wrong.status).toBe(401);
    expect((await h.json(wrong))["code"]).toBe("E-AUTH-001");
    const r = await h.signIn(u.email);
    expect(r.status).toBe(403);
    const j = await h.json(r);
    expect(j["code"]).toBe("E-AUTH-007");
    expect(j["message"]).toBe(msg("E-AUTH-007"));
    expect(j["data"], "ログインの印を渡さない").toBeUndefined();
    expect(await h.liveSessions(u.memberId), "ログインの要求で生きたセッションが増えない").toBe(before);
  });

  it("K301-API-015 2 つのタブで同時にログイン：201 が 2 つ・セッションは 2 つ（どちらの印でも入れる）", async () => {
    const u = await h.makeUser("twotabs");
    const before = await h.liveSessions(u.memberId);
    const [a, b] = await Promise.all([h.signIn(u.email, PW, { ua: UA_MAC }), h.signIn(u.email, PW, { ua: UA_MAC })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const ta = String((await h.json(a)).data!["token"]);
    const tb = String((await h.json(b)).data!["token"]);
    expect(ta).not.toBe(tb);
    expect(await h.resolves(ta)).toBe(true);
    expect(await h.resolves(tb)).toBe(true);
    expect(await h.liveSessions(u.memberId)).toBe(before + 2);
  });

  it("K301-API-016 国か端末が変わって切られた（sessions.revoke_reason_id country_changed）後に入り直す：201 で普通に入れる。前のセッションは切れたまま", async () => {
    const u = await h.makeUser("relogin");
    const first = String((await h.json(await h.signIn(u.email, PW, { ua: UA_MAC }))).data!["token"]);
    await h.admin.query(
      "update sessions set revoked_at = now(), revoke_reason_id = 'country_changed' where member_id = $1 and revoked_at is null",
      [u.memberId],
    );
    expect(await h.resolves(first)).toBe(false);
    const r = await h.signIn(u.email, PW, { ua: UA_MAC });
    expect(r.status).toBe(201);
    expect(await h.resolves(String((await h.json(r)).data!["token"]))).toBe(true);
    expect(await h.resolves(first)).toBe(false);
  });

  it("K301-API-017 別の端末で初めて：画面の知らせ（security.new_device）とメールが 1 通ずつ（D-125.140）。同じ端末で 2 回目は増えない", async () => {
    const u = await h.makeUser("newdev");
    const from = mails.length;
    expect((await h.signIn(u.email, PW, { ua: UA_WIN })).status).toBe(201);
    expect(await newDeviceNotices(u.memberId)).toBe(1);
    expect(mails.slice(from).filter((m) => m.to === u.email && /新しい端末/.test(m.subject))).toHaveLength(1);
    expect((await h.signIn(u.email, PW, { ua: UA_WIN })).status).toBe(201);
    expect(await newDeviceNotices(u.memberId)).toBe(1);
    expect(mails.slice(from).filter((m) => m.to === u.email && /新しい端末/.test(m.subject))).toHaveLength(1);
  });

  it("K301-API-018 新しい端末の知らせのメールが送れない：ログインは止めない（201）。画面の知らせは残り、送れなかったことがログに残る", async () => {
    const u = await h.makeUser("mailfail");
    failMailTo.add(u.email);
    let status = 0;
    const logs = await h.captureLogs(async () => {
      status = (await h.signIn(u.email, PW, { ua: UA_WIN })).status;
    });
    failMailTo.delete(u.email);
    expect(status).toBe(201);
    expect(await newDeviceNotices(u.memberId)).toBe(1);
    expect(logs).toMatch(/送れなかった/);
  });

  it("K301-API-019 セッションを写す所（app.open_session の sessions への書き込み）で失敗：503・E-PAGE-003。認証側のセッションも残さない（半分だけ入った状態を作らない）・パスワードの失敗に数えない", async () => {
    const u = await h.makeUser("halfopen");
    const authBefore = await h.authSessions(u.userId);
    const liveBefore = await h.liveSessions(u.memberId);
    await h.admin.query(`create or replace function app.k301_down() returns trigger language plpgsql as $$
      begin if new.device_label like '%K301-FAIL%' then raise exception 'K-301 の試験：sessions に書けない'; end if; return new; end $$`);
    await h.admin.query(
      "create trigger k301_down before insert on sessions for each row execute function app.k301_down()",
    );
    let r: Response | undefined;
    try {
      await h.captureLogs(async () => {
        r = await h.signIn(u.email, PW, { ua: `${UA_MAC} K301-FAIL` });
      });
    } finally {
      await h.admin.query("drop trigger if exists k301_down on sessions");
      await h.admin.query("drop function if exists app.k301_down()");
    }
    expect(r!.status).toBe(503);
    const j = await h.json(r!);
    expect(j["code"]).toBe("E-PAGE-003");
    expect(j["message"]).toBe(msg("E-PAGE-003"));
    expect(await h.authSessions(u.userId), "認証側のセッションも消す").toBe(authBefore);
    expect(await h.liveSessions(u.memberId)).toBe(liveBefore);
    expect(await h.attempts(u.email), "パスワードは合っていたので、失敗の数に入れない").toBeUndefined();
  });
});

describe("K-301 パスワードで入る：守り", () => {
  it("K301-API-020 1 分に 11 回（同じ IP）：11 回目は 429・RATE_LIMITED・retry_after_sec。11 回目のメールは失敗の数に入らない", async () => {
    const ip = h.nextIp();
    for (let i = 0; i < 10; i++) {
      const r = await h.signIn(h.email(`rate-${i}`), "wrong-password-0000", { ip });
      expect(r.status, `${i + 1} 回目は上限の内`).not.toBe(429);
    }
    const last = h.email("rate-10");
    const r = await h.signIn(last, "wrong-password-0000", { ip });
    expect(r.status).toBe(429);
    const j = await h.json(r);
    expect(j["code"]).toBe("RATE_LIMITED");
    expect(Number(j["retry_after_sec"])).toBeGreaterThan(0);
    expect(await h.attempts(last)).toBeUndefined();
  });

  it("K301-API-021 ログ：ログインの間（成功・失敗・ロック・2 段階の待ち）に、パスワード・メール・ログインの印・待ちの印がログに出ない", async () => {
    const u = await h.makeUser("log");
    const t = await h.makeUser("log-tf", { twoFactor: true });
    const secrets: string[] = [];
    const logs = await h.captureLogs(async () => {
      const ok = await h.json(await h.signIn(u.email, PW, { ua: UA_WIN }));
      secrets.push(String(ok.data!["token"]));
      const tf = await h.json(await h.signIn(t.email));
      secrets.push(String(tf.data!["pending"]));
      for (let i = 0; i < 5; i++) await h.signIn(u.email, `wrong-password-${i}x`);
    });
    for (const s of [PW, u.email, u.email.split("@")[0]!, t.email, ...secrets, "wrong-password-"])
      expect(logs).not.toContain(s);
  });

  it("K301-API-022 記録：成功は login_succeeded・失敗は login_failed・ロックは login_locked が、その人の会社の security_events に残る（IP は地域だけ・メールとパスワードは入れない）。無いメールは何も残さない", async () => {
    const u = await h.makeUser("events");
    const ghost = h.email("events-ghost");
    const count = async () =>
      Number((await h.admin.query<{ n: string }>("select count(*) as n from security_events")).rows[0]!.n);
    const okBefore = (await securityEvents(u.memberId, "login_succeeded")).length; // 登録の確定で入った分は数えない
    expect((await h.signIn(u.email, PW, { headers: { "x-vercel-ip-country": "JP" } })).status).toBe(201);
    const ok = (await securityEvents(u.memberId, "login_succeeded")).filter((e) => e.ip_region === "JP");
    expect((await securityEvents(u.memberId, "login_succeeded")).length).toBe(okBefore + 1);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.tenant_id).toBe(u.tenantId);
    expect(ok[0]!.ip_region).toBe("JP");
    await fiveWrong(u.email);
    expect(await securityEvents(u.memberId, "login_failed")).toHaveLength(4);
    expect(await securityEvents(u.memberId, "login_locked")).toHaveLength(1);
    const text = JSON.stringify([...ok, ...(await securityEvents(u.memberId, "login_failed"))]);
    for (const s of [PW, u.email, "wrong-password-"]) expect(text).not.toContain(s);
    const before = await count();
    await h.signIn(ghost, "wrong-password-0000");
    expect(await count(), "無いメールは会社が無いので書かない").toBe(before);
  });

  it("K301-API-023 閉じた部品の道：POST /api/auth/sign-in/email は 404（ロックと止めを通らない道は無い）。セッションは作らない", async () => {
    const u = await h.makeUser("closed");
    const before = await h.authSessions(u.userId);
    const r = await h.req("POST", "/api/auth/sign-in/email", { email: u.email, password: PW });
    expect(r.status).toBe(404);
    expect(await h.authSessions(u.userId)).toBe(before);
  });

  it("K301-API-024 関門：振る舞いは apps/api/src/features/F1/login/ にあり、生の pg・外への fetch・ログインの部品（better-auth）を直に import しない（部品は @kaname/auth の中だけ・境界 B2）", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
      }
    };
    expect(() => walk(FEATURE_DIR), "apps/api/src/features/F1/login/ がある").not.toThrow();
    expect(files.length).toBeGreaterThan(0);
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/from\s+["']pg["']/);
    expect(src).not.toMatch(/from\s+["']better-auth/);
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it("K301-API-025 答えの形：201 の data の欄は token・two_factor・pending の 3 つだけ。401 の答えにメールアドレスを入れない", async () => {
    const u = await h.makeUser("shape");
    const ok = await h.json(await h.signIn(u.email));
    expect(Object.keys(ok.data!).sort()).toEqual(["pending", "token", "two_factor"]);
    const bad = await h.signIn(u.email, "wrong-password-0000");
    expect(await bad.text()).not.toContain(u.email);
  });

  it("K301-API-027 答えの頭に Server-Timing が無い：成功（201）・違うパスワード（401）・登録していないメール（401）のどれも、ログイン中（Bearer）で呼んでも同じ（文の数で登録の有無を漏らさない・K237-API-005 から移した）", async () => {
    const u = await h.makeUser("timing-st"); // K301-API-008 の "timing" と同じ回で同じメールにならないように
    const ok = await h.signIn(u.email);
    expect(ok.status, await ok.clone().text()).toBe(201);
    const token = String((await h.json(ok)).data!["token"]);
    const ghost = `k301-none-${Date.now().toString(36)}@example.com`;
    const seen: string[] = [];
    for (const bearer of [false, true]) {
      const headers = bearer ? { authorization: `Bearer ${token}` } : {};
      for (const [who, pw, want] of [
        [u.email, PW, 201],
        [u.email, "wrong-password-0000", 401],
        [ghost, "wrong-password-0000", 401],
      ] as const) {
        const r = await h.signIn(who, pw, { headers });
        expect(r.status, await r.clone().text()).toBe(want);
        seen.push(
          `${who === ghost ? "無いメール" : "在るメール"}・${want}${bearer ? "（ログイン中）" : ""}：${r.headers.get("server-timing")}`,
        );
      }
    }
    expect(
      seen.filter((x) => !x.endsWith("：null")),
      seen.join("\n"),
    ).toEqual([]);
  });

  it("K301-API-026 規約の新しい版にまだ同意していない人：契約の口のログインも K-53 の hook を通り、201 の後のセッションに同意し直しの印（sessions.terms_pending）が立つ", async () => {
    const u = await h.makeUser("terms");
    const ops = (await h.admin.query<{ id: string }>("select app.ops_tenant_id() as id")).rows[0]!.id;
    const v = `${h.run}-terms`;
    await h.admin.query(
      "insert into terms_versions (tenant_id, kind, version, url, published_at) values ($1, 'terms', $2, $3, now())",
      [ops, v, `https://kaname.example/terms/${v}`],
    );
    try {
      const r = await h.signIn(u.email, PW, { ua: UA_MAC });
      expect(r.status).toBe(201);
      const flags = await h.admin.query<{ p: boolean }>(
        "select terms_pending as p from sessions where member_id = $1 and revoked_at is null order by issued_at desc limit 1",
        [u.memberId],
      );
      expect(flags.rows[0]!.p).toBe(true);
    } finally {
      await h.admin.query("delete from terms_versions where version = $1", [v]);
    }
  });
});
