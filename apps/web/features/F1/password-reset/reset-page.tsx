"use client";
// パスワードを作り直す（T-U-06・A31・K-320）。見た目は段 2 の部品（views の PasswordReset）。ここは動きだけ。
//   口は契約の口だけ：requestPasswordReset（POST /api/v1/auth/password/forgot・K-313）・resetPassword（POST /api/v1/auth/password/reset・K-314）・getMe。
//   答えで画面を選ぶ：頼む 201 → 送りました／決める 201 → 済んだ／410 E-AUTH-006 → もう使えない／409 E-PAGE-006（リンクが無い・K-638）→ 正しくない／
//   422 → 欄の下に口の文／429 → 待つ秒数の文／500・網の切れ → E-PAGE-003 の文（手がかりは残す）。
//   リンクの手がかりは URL からすぐ消し、このタブだけ（sessionStorage）に置く（Referer・履歴に残さない）。済んだ・使えないで消す。
//   60 秒に 1 通（D-128.141）は口の答えでは分からないので、画面が自分で数える
import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG } from "@kaname/errors/catalog";
import { call, type CallErr } from "@/lib/api/call";
import { getToken, setToken } from "@/lib/api/client";
import { AuthLoading } from "../sign-up/auth-loading";
import { PasswordReset, type ResetStep } from "./views";

/** このタブだけに置くリンクの手がかり */
export const RESET_TOKEN_KEY = "kaname.reset-token";
/** ログインの画面が置く、入れかけのメール（URL に載せない・読んだら消す） */
export const RESET_EMAIL_KEY = "kaname.reset-email";
const RESEND_SEC = 60;
const MS_PER_SEC = 1000;
const PW_MIN = 12;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MISMATCH = "2 つのパスワードが違います";
const ROOT = '[data-auth="reset"]';
const AGAIN_LINK = `${ROOT} a[href="/password-reset"]`;

const catalogText = (id: string): string => CATALOG[id as keyof typeof CATALOG]?.message ?? id;
const DOWN = catalogText("E-PAGE-003");
/** 口の文（無ければ正本の文） */
const textOf = (r: CallErr): string => r.message ?? catalogText(r.code);
const waitText = (sec: number): string => catalogText("E-LIM-005").replace("{秒}", String(sec));
/** 口がメールをそろえる形と同じ（NFKC・空白を除く・小文字。packages/auth の normalizeEmail） */
const tidyEmail = (v: string): string => v.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

const session = {
  get: (k: string): string | null => {
    try {
      return window.sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      window.sessionStorage.setItem(k, v);
    } catch {
      /* private mode 等。メモリだけで続ける */
    }
  },
  drop: (k: string): void => {
    try {
      window.sessionStorage.removeItem(k);
    } catch {
      /* 同上 */
    }
  },
};

const fieldValue = (name: string): string =>
  document.querySelector<HTMLInputElement>(`${ROOT} input[name="${name}"]`)?.value ?? "";

/** URL の ?token= を読み、すぐ URL から消して、このタブに置く。手がかりが無ければこのタブに置いた物 */
function takeToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    session.set(RESET_TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return session.get(RESET_TOKEN_KEY);
}

/** 今このブラウザでログインしているか（印があり、getMe が 200） */
async function isSignedIn(): Promise<boolean> {
  if (!getToken()) return false;
  try {
    const r = await call("getMe", { keepOn401: true, screenId: "password-reset" });
    return r.ok;
  } catch {
    return false;
  }
}

export function PasswordResetPage() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<ResetStep>("ask");
  const [token, setTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [otherAccount, setOtherAccount] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const sending = useRef(false); // 2 回押しで口を 2 回呼ばない
  /** 開いたときにログイン中だったか（決めた後に、同じ人か別のアカウントかを見分ける） */
  const signedInAtOpen = useRef<Promise<boolean>>(Promise.resolve(false));

  useEffect(() => {
    const t = takeToken();
    const carried = session.get(RESET_EMAIL_KEY);
    if (carried !== null) {
      session.drop(RESET_EMAIL_KEY);
      setEmail(carried);
    }
    setTokenState(t);
    setStep(t ? "new" : "ask");
    setReady(true);
    let alive = true;
    signedInAtOpen.current = isSignedIn();
    void signedInAtOpen.current.then((v) => {
      if (alive) setSignedIn(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 送り直せるまでの秒を数える（時計に合わせて 1 秒ごと）
  useEffect(() => {
    if (sentAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), MS_PER_SEC);
    return () => window.clearInterval(id);
  }, [sentAt]);
  const waitSec = sentAt === null ? 0 : Math.max(0, Math.ceil((sentAt + RESEND_SEC * MS_PER_SEC - now) / MS_PER_SEC));

  /** 使えない・正しくないの「再設定メールを送り直す」は今と同じ道なので、画面が作り直されない。押下を拾ってメールを入れる段へ戻す */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(AGAIN_LINK)) return;
      setMsg(null);
      setSentAt(null);
      setStep("ask");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const run = useCallback(async (send: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await send();
    } catch {
      setMsg(DOWN); // 網が切れた（口が答えない）
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, []);

  const requestMail = (to: string) =>
    run(async () => {
      const r = await call("requestPasswordReset", { body: { email: to }, screenId: "password-reset" });
      if (r.ok) {
        setEmail(to);
        setSentAt(Date.now());
        setStep("sent");
        return;
      }
      setStep("ask");
      setMsg(r.status === 429 && r.retryAfterSec !== null ? waitText(r.retryAfterSec) : DOWN);
    });

  const onSend = () => {
    if (step === "sent") {
      if (waitSec > 0) return;
      void requestMail(email);
      return;
    }
    const raw = fieldValue("email");
    setEmail(raw);
    const to = tidyEmail(raw);
    if (!EMAIL_RE.test(to)) return setMsg(catalogText("E-VAL-004"));
    void requestMail(to);
  };

  const finish = async () => {
    session.drop(RESET_TOKEN_KEY);
    setTokenState(null);
    if (await signedInAtOpen.current) {
      // 同じ人なら、その画面の印も切れている（401）→ 印を消す。200 なら別のアカウントでログイン中
      const r = await call("getMe", { keepOn401: true, screenId: "password-reset" }).catch(() => null);
      if (r?.ok) setOtherAccount(true);
      else if (r?.status === 401) setToken(null);
    }
    setStep("done");
  };

  const onSave = () => {
    const pw = fieldValue("new_password");
    const again = fieldValue("new_password_again");
    if (pw !== again) return setMsg(MISMATCH);
    if (pw.length < PW_MIN) return setMsg(catalogText("E-VAL-005"));
    void run(async () => {
      const r = await call("resetPassword", {
        body: { token: token ?? "", new_password: pw },
        screenId: "password-reset",
      });
      if (r.ok) return finish();
      // 番号で分ける：リンクが無い（E-PAGE-006・409）は「正しくない」、期限切れ・使い終わった（E-AUTH-006・410）は「もう使えない」
      if (r.code === "E-PAGE-006" || r.code === "E-AUTH-006" || r.status === 410) {
        session.drop(RESET_TOKEN_KEY);
        setTokenState(null);
        setStep(r.code === "E-PAGE-006" ? "invalid" : "dead");
        return;
      }
      setMsg(r.status === 422 ? textOf(r) : DOWN);
    });
  };

  if (!ready) return <AuthLoading />;
  return (
    <PasswordReset
      key={step}
      step={step}
      email={email}
      msg={msg}
      waitSec={waitSec}
      signedIn={signedIn}
      otherAccount={otherAccount}
      busy={busy}
      onSend={onSend}
      onSave={onSave}
    />
  );
}
