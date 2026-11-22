"use client";
// パスワードを再設定する画面の見た目（段 2・K-76 の孫・枝 c/段2）。部品先行のモックと本番が同じこの部品を使う。動きは持たない。
//   キャンバス AuthReset（送りました）。キャンバスに無い状態（メールを入れる・新しいパスワード・済んだ・リンクが使えない・ログイン中）は同じ部品で足した
import Link from "next/link";
import { CATALOG } from "@kaname/errors/catalog";
import { Button, PasswordField, TextField } from "@/components/k";
import { NoteBox, ResultBox } from "@/components/k/auth-parts";
import { PAGE_ERROR } from "@/components/k/error-of";
import { AuthFrame } from "../sign-up/frame";
import "../login/login.css";
import "../login/views.css";

export type ResetStep = "ask" | "sent" | "new" | "done" | "dead" | "invalid";

export interface PasswordResetProps {
  step: ResetStep;
  email?: string;
  /** 口の文（形が違う・送りすぎ・短い・漏れたもの） */
  msg?: string | null;
  /** 送り直せるまでの秒（60 秒に 1 通・D-128.141）。0 なら押せる */
  waitSec?: number;
  /** ログイン中の人（安全の設定へのリンクを出す。メールの欄は出したまま） */
  signedIn?: boolean;
  /** 済んだとき、このブラウザが別のアカウントでログイン中（answer=8467d5780a91 ⑫） */
  otherAccount?: boolean;
  busy?: boolean;
  onSend?: () => void;
  onSave?: () => void;
}

function Back() {
  return (
    <Link href="/login" className="k-login-back">
      ← ログインに戻る
    </Link>
  );
}

/** 待つ長さの言い方：60 秒以上は「1 分」（キャンバス AuthReset）。それより短いと秒 */
const waitLabel = (sec: number): string => (sec >= 60 ? `${Math.floor(sec / 60)} 分` : `${sec} 秒`);

/** メールを入れて頼む・送りました・新しいパスワード・済んだ・リンクが使えない */
export function PasswordReset(p: PasswordResetProps) {
  if (p.step === "new")
    return (
      <AuthFrame>
        <form className="k-auth-form" data-auth="reset" data-state="p" noValidate onSubmit={(e) => e.preventDefault()}>
          <h1 className="k-login-h-left">新しいパスワードを決める</h1>
          <p className="k-auth-lead k-login-left" data-kind="body">
            12 文字以上。漏れたことのあるパスワードは使えません。決めると、ほかの端末と PC はすべてログアウトします
          </p>
          <PasswordField size="lg" label="新しいパスワード" name="new_password" autoComplete="new-password" />
          <PasswordField
            size="lg"
            label="もう一度"
            name="new_password_again"
            autoComplete="new-password"
            error={p.msg ?? undefined}
          />
          <Button type="submit" size="lg" loading={p.busy} onClick={p.onSave}>
            パスワードを決める
          </Button>
        </form>
      </AuthFrame>
    );
  if (p.step === "done")
    return (
      <AuthFrame>
        <div className="k-auth-form" data-auth="reset" data-state="done">
          <h1 className="k-login-h-left">パスワードを作り直しました</h1>
          <ResultBox tone="ok">新しいパスワードで入ってください。ほかの端末と PC は、入り直しになりました</ResultBox>
          {p.otherAccount ? (
            <NoteBox>別のアカウントでログイン中です。新しいパスワードで入るには、ログアウトしてください</NoteBox>
          ) : null}
          <NoteBox>2 段階認証を付けている人は、作り直したあとも 6 けたが要ります</NoteBox>
          <Link href="/login" className="k-btn" data-variant="primary" data-size="lg">
            ログインする
          </Link>
        </div>
      </AuthFrame>
    );
  if (p.step === "dead" || p.step === "invalid")
    return (
      <AuthFrame>
        <div className="k-auth-form" data-auth="reset" data-state={p.step}>
          <Back />
          <h1 className="k-login-h-left">このリンクは使えません</h1>
          <ResultBox tone="bad">
            {p.step === "dead"
              ? "このリンクはもう使えません。もう一度、再設定メールを送ってください"
              : CATALOG[PAGE_ERROR.linkExpired]?.message}
          </ResultBox>
          <NoteBox>リンクは 30 分のあいだ、1 回だけ使えます。新しく頼むと、前のリンクは使えなくなります</NoteBox>
          <Link href="/password-reset" className="k-btn" data-variant="outlined" data-size="lg">
            再設定メールを送り直す
          </Link>
        </div>
      </AuthFrame>
    );
  const sent = p.step === "sent";
  return (
    <AuthFrame>
      <form
        className="k-auth-form"
        data-auth="reset"
        data-state={sent ? "s" : "n"}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          p.onSend?.();
        }}
      >
        <Back />
        <h1 className="k-login-h-left">パスワードを作り直す</h1>
        {p.signedIn ? (
          <NoteBox>
            ログイン中は <Link href="/mfa-setup">ログインと安全</Link> から変えられます
          </NoteBox>
        ) : null}
        {sent ? (
          <>
            <ResultBox tone="ok">
              登録されていれば、{p.email} に作り直しのリンクを送りました。30 分のあいだ、1 回だけ使えます
            </ResultBox>
            <ul className="k-reset-points">
              <li>・ 届いたリンクを開くと、新しいパスワードを決められる</li>
              <li>・ 2 段階認証を付けている人は、作り直したあとも 6 けたが要る</li>
              <li>・ 作り直すと、ほかの端末はすべてログアウトする</li>
            </ul>
          </>
        ) : (
          <>
            <p className="k-auth-lead k-login-left" data-kind="body">
              登録したメールアドレスを入れてください。作り直しのリンクを送ります
            </p>
            <TextField
              size="lg"
              label="メールアドレス"
              name="email"
              type="text"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              defaultValue={p.email}
              error={p.msg ?? undefined}
            />
          </>
        )}
        <NoteBox>
          パスキーがあるなら、パスワードを作り直さなくても <Link href="/login">パスキーで入れる</Link>
        </NoteBox>
        {sent ? (
          <div className="k-login-center k-reset-resend" data-part="resend">
            <button type="submit" className="k-login-textbtn" disabled={(p.waitSec ?? 0) > 0}>
              もう一度送る
            </button>
            {(p.waitSec ?? 0) > 0 ? <span>（{waitLabel(p.waitSec ?? 0)}あとから）</span> : null}
          </div>
        ) : (
          <Button type="submit" size="lg" loading={p.busy}>
            再設定メールを送る
          </Button>
        )}
      </form>
    </AuthFrame>
  );
}
