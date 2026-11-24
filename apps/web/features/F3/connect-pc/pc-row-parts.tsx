"use client";
// PC の行に差す部品（段 4 の下絵・部品先行）。「つないでいる PC」の行（pc-cards.tsx の Row）の本文の下に差す。
//   ClaudeCodeFix  … Claude Code の足りない物と直し方（K-361：入れる・取り直す・ログインする・ほかの端末では理由だけ・眠っている PC は報告の時刻）
//   BrowserChoice  … AI が使うブラウザを選ぶ（画面の葉 K-368：自分の Chrome（既定）／Bridge 専用のブラウザ／使わない・口は K-364）
//   BrowserFix     … Chrome とつながらないときのその場の一手（つなぎ方を見る・もう一度確かめる・Bridge 専用に切り替える・口は K-365）
//   PcMoreMenu・RemovePcConfirm … 行の「…」のメニューと、外す確かめの小窓（K-363。取り直しは段 2 の StepUpDialog をそのまま使う）
//   AddPcButton    … 「つないでいる PC」の見出しの行の「＋ PC をつなぐ」。Bridge を入れられない端末（スマホ・タブレット）では押せない形で、すぐ下に理由（画面の葉 K-373・代表の決め 2026-11-19）
//   OsWarning      … OS の警告（署名の前の版を初めて開くと止まる）の越え方。つなぐ小窓の受け取る段（K-374）と、入れ直す区画（K-375）に差す（代表の答え 2026-11-19 answer=7cf148a79dc9）
//   BridgeReinstall … Bridge が古い（自己診断の fix=update・E-CONN-012）PC の行の、入れ直す一手（K-375・同じ答え）
// どれも見せるだけの部品：値と押した結果は props で受け、口は呼ばない（口につなぐのは各チケットの画面の葉）。
// 値は正本（DESIGN-kaname.md → styles/k-tokens.css）のトークンだけ。生の色・大きさは pc-row-parts.css にも書かない
import type { ReactNode } from "react";
import { Button, Confirm, Menu, MenuItem, MenuPopup, MenuTrigger, TextField } from "@/components/k";
import { errorText } from "@/components/k/error-of";
import "./pc-row-parts.css";

/* ---------------- 行の中の知らせ（成功・途中は status、失敗は alert） ---------------- */

export function RowNote({ tone = "info", children }: { tone?: "info" | "ok" | "danger"; children: ReactNode }) {
  return (
    <p className="k-pc-part-note" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/* ---------------- 「＋ PC をつなぐ」（K-373・代表の決め 2026-11-19） ---------------- */

/** Bridge を入れられない端末で、押せない「＋ PC をつなぐ」のすぐ下に出す理由（スマホは PC の様子を見る・リモコンとして使う） */
export const PAIR_ONLY_ON_PC_TEXT = "つなぐ PC で、この画面を開いてください";
const PAIR_REASON_ID = "pc-add-reason";

export interface AddPcButtonProps {
  /** この端末に Bridge を入れられるか（pair-device.ts の canPairHere）。false なら押せない形と理由 */
  canPair: boolean;
  onAdd?: (() => void) | undefined;
}

/** 見出しの行のボタン。理由の 1 行は見出しの行の外（AddPcReason）に出す */
export function AddPcButton({ canPair, onAdd }: AddPcButtonProps) {
  return (
    <Button
      variant="outlined"
      className="k-pc-btn"
      data-act="add-pc"
      disabled={!canPair}
      aria-describedby={canPair ? undefined : PAIR_REASON_ID}
      onClick={canPair ? onAdd : undefined}
    >
      ＋ PC をつなぐ
    </Button>
  );
}

/** 押せない「＋ PC をつなぐ」の理由（見出しの行のすぐ下・canPair が false のときだけ） */
export function AddPcReason({ canPair }: { canPair: boolean }) {
  return canPair ? null : (
    <p className="k-pc-add-reason" id={PAIR_REASON_ID} data-pair-reason>
      {PAIR_ONLY_ON_PC_TEXT}
    </p>
  );
}

/* ---------------- Claude Code の足りない物と直し方（K-361） ---------------- */

export type ClaudeFix = "install" | "repair" | "login";

const CLAUDE_TITLE: Record<ClaudeFix, () => string> = {
  install: () => "Claude Code が入っていません",
  repair: () => errorText("E-CONN-011").entry.message,
  login: () => errorText("E-CONN-016").entry.message,
};
/** ほかの端末で見ている行（mine=false）の題。押せるボタンが無いので、ボタンを言わない文にする（E-CONN-016 は「下の『ログインする』を押して」と言う） */
function claudeTitle(fix: ClaudeFix, mine: boolean): string {
  return !mine && fix === "login" ? errorText("E-CONN-017").entry.message : CLAUDE_TITLE[fix]();
}
const CLAUDE_BUTTON: Record<Exclude<ClaudeFix, "login">, string> = {
  install: "Claude Code を入れる",
  repair: "Claude Code を取り直す",
};

export interface ClaudeLoginStep {
  /** Bridge が返したログインの入口（https） */
  url: string;
  code: string;
  busy?: boolean;
  error?: string | null;
}

export interface ClaudeCodeFixProps {
  fix: ClaudeFix;
  /** この PC の行（この PC の Bridge の device_id と行の id が同じ）。違えば押せるボタンを出さず、開く場所だけを言う */
  mine: boolean;
  /** 眠っている PC の古い報告の時刻（「MM/DD HH:MM」・jstStamp で作った字）。無ければ出さない */
  reportedAt?: string | null;
  /** 入れている途中（/install-progress の最後の行） */
  progress?: string | null;
  busy?: boolean;
  /** 押した結果の失敗（Bridge の文・届かないときの文） */
  error?: string | null;
  /** ログインの途中（入口とコードの欄） */
  login?: ClaudeLoginStep | null;
  onInstall?: () => void;
  onLogin?: () => void;
  onCode?: (v: string) => void;
  onSubmitCode?: () => void;
}

export function ClaudeCodeFix(p: ClaudeCodeFixProps) {
  const { fix, mine, reportedAt, progress, busy = false, error, login } = p;
  return (
    <section className="k-pc-part" data-part="claude-fix" data-fix={fix} aria-label="Claude Code">
      <b className="k-pc-part-title">{claudeTitle(fix, mine)}</b>
      <p className="k-pc-part-text">自分のAIもAI社員も、あなたのサブスクの Claude Code で動きます。</p>
      {reportedAt ? <p className="k-pc-part-meta">{reportedAt} の報告</p> : null}
      {mine ? (
        <div className="k-pc-part-acts">
          {fix === "login" ? (
            login ? null : (
              <Button className="k-pc-btn" data-login-claude loading={busy} onClick={p.onLogin}>
                ログインする
              </Button>
            )
          ) : (
            <Button className="k-pc-btn" data-install-claude loading={busy} onClick={p.onInstall}>
              {CLAUDE_BUTTON[fix]}
            </Button>
          )}
        </div>
      ) : (
        <p className="k-pc-part-meta">Bridge が入っている PC でこの画面を開いてください</p>
      )}
      {mine && login ? <ClaudeLogin step={login} onCode={p.onCode} onSubmit={p.onSubmitCode} /> : null}
      {progress ? <RowNote>{progress}</RowNote> : null}
      {error ? <RowNote tone="danger">{error}</RowNote> : null}
    </section>
  );
}

function ClaudeLogin({
  step,
  onCode,
  onSubmit,
}: {
  step: ClaudeLoginStep;
  onCode?: ((v: string) => void) | undefined;
  onSubmit?: (() => void) | undefined;
}) {
  const empty = step.code.trim() === "";
  return (
    <div className="k-pc-login" data-login-step>
      <ol className="k-pc-login-steps">
        <li>
          ブラウザが開きます。開かないときは{" "}
          <a className="k-link" href={step.url} target="_blank" rel="noopener noreferrer">
            この入口
          </a>{" "}
          を押してください
        </li>
        <li>承認すると画面にコードが出ます。それを下に貼って「決定」</li>
      </ol>
      <div className="k-pc-login-row">
        <TextField
          label="ブラウザに出たコード"
          name="claude_login_code"
          autoComplete="off"
          value={step.code}
          onChange={(e) => onCode?.(e.target.value)}
          error={step.error ?? undefined}
        />
        <Button className="k-pc-btn" loading={step.busy} disabled={empty} onClick={onSubmit}>
          決定
        </Button>
      </div>
    </div>
  );
}

/* ---------------- AI が使うブラウザを選ぶ（画面の葉 K-368・口は K-364） ---------------- */

export type AgentBrowser = "chrome" | "dedicated" | "off";

const BROWSER_OPTIONS: readonly { value: AgentBrowser; label: string; desc: string }[] = [
  {
    value: "chrome",
    label: "自分の Chrome",
    desc: "いつもの Chrome とそのログインの状態をそのまま使います。拡張機能「Claude in Chrome」が要ります",
  },
  {
    value: "dedicated",
    label: "Bridge 専用のブラウザ",
    desc: "いつもの Chrome とは別のログインの状態で動きます。Chrome を閉じていても使えます",
  },
  { value: "off", label: "使わない", desc: "AI はブラウザを開きません" },
];

export interface BrowserChoiceProps {
  /** 行ごとに違う名前（ラジオの組）。PC の id を渡す */
  deviceId: string;
  value: AgentBrowser;
  busy?: boolean;
  /** 押した結果（「変えました。次の仕事から使います」・失敗の文） */
  note?: { tone: "ok" | "danger"; text: string } | null;
  onChange?: (v: AgentBrowser) => void;
}

export function BrowserChoice({ deviceId, value, busy = false, note, onChange }: BrowserChoiceProps) {
  return (
    <fieldset className="k-pc-browser" data-browser-pick aria-busy={busy || undefined}>
      <legend className="k-pc-browser-legend">AI が使うブラウザ</legend>
      {BROWSER_OPTIONS.map((o) => (
        <label key={o.value} className="k-pc-choice">
          <input
            type="radio"
            name={`agent-browser-${deviceId}`}
            value={o.value}
            checked={value === o.value}
            disabled={busy}
            onChange={() => {
              if (o.value !== value) onChange?.(o.value);
            }}
          />
          <span>
            <span className="k-pc-choice-label">
              {o.label}
              {o.value === "chrome" ? <span className="k-pc-choice-tag">（既定）</span> : null}
            </span>
            <span className="k-pc-choice-desc">{o.desc}</span>
          </span>
        </label>
      ))}
      {note ? <RowNote tone={note.tone}>{note.text}</RowNote> : null}
    </fieldset>
  );
}

/* ---------------- Chrome とつながらないときのその場の一手（口は K-365） ---------------- */

/** 公式の入口（components/ai/browser-fix.tsx と同じ・2026-09-30 に確かめた） */
export const CHROME_EXTENSION_URL = "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn";

export interface BrowserFixProps {
  checking?: boolean;
  /** 確かめの結果・失敗（「まだつながっていません…」・「結果が返ってきませんでした…」・眠っている PC の 409 の文） */
  result?: { tone: "info" | "danger"; text: string } | null;
  /** つなぎ方を開いておく（モックで中身を見せる） */
  openSteps?: boolean;
  onCheck?: () => void;
  onDedicated?: () => void;
}

export function BrowserFix({ checking = false, result, openSteps = false, onCheck, onDedicated }: BrowserFixProps) {
  return (
    <section className="k-pc-part" data-part="browser-fix" aria-label="AI が使うブラウザの直し方">
      <b className="k-pc-part-title">AI が Chrome を使えません。</b>
      <details className="k-pc-fix-steps" open={openSteps}>
        <summary>つなぎ方を見る</summary>
        <ol>
          <li>Chrome を開く（閉じていると AI は使えません）</li>
          <li>
            拡張機能「Claude in Chrome」を入れて有効にする：
            <a
              className="k-link"
              href={CHROME_EXTENSION_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-browser-install
            >
              Chrome ウェブストアで開く
            </a>
            。初めて入れたときは Chrome を一度開き直す
          </li>
          <li>拡張機能に、この PC の Claude Code と同じアカウントでログインする</li>
        </ol>
      </details>
      <div className="k-pc-part-acts">
        <Button variant="outlined" className="k-pc-btn" data-browser-check loading={checking} onClick={onCheck}>
          {checking ? "確かめています…" : "もう一度確かめる"}
        </Button>
        <Button variant="ghost" className="k-pc-btn" data-browser-dedicated disabled={checking} onClick={onDedicated}>
          Bridge 専用に切り替える
        </Button>
      </div>
      {checking ? <RowNote>確かめています（1 分ほどかかります）…</RowNote> : null}
      {!checking && result ? <RowNote tone={result.tone}>{result.text}</RowNote> : null}
    </section>
  );
}

/* ---------------- 行の「…」のメニューと外す確かめ（K-363） ---------------- */

/** 行の「…」のメニュー。メニューの型（components/k/menu.tsx）を使う（この置き場は Base UI を直に読まない・K-230 の守り） */
export function PcMoreMenu({
  name,
  onRemove,
  defaultOpen = false,
}: {
  name: string;
  onRemove?: () => void;
  defaultOpen?: boolean;
}) {
  return (
    <Menu defaultOpen={defaultOpen}>
      <MenuTrigger className="k-pc-more k-pc-more-on" label={`…（${name} の操作）`}>
        …
      </MenuTrigger>
      <MenuPopup align="end" className="k-pc-menu">
        <MenuItem className="k-pc-menu-danger" onSelect={onRemove}>
          この PC を外す
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** 外す確かめの文（K-363 の案） */
export const REMOVE_PC_TEXT =
  "外すと、この PC の Bridge は Kaname に仕事を取りに来なくなり、預けたログイン情報もこの PC からは取り出せなくなります。この PC が動かしていた仕事は止まります。待っている仕事は消えません。もう一度使うときは、この画面からつなぎ直します";
export const REMOVED_PC_TEXT = "外しました。もう一度つなぐときは、この画面からつなぎ直してください";
export const REMOVE_PC_STEP_UP_REASON = "PC を外す前に、本人か確かめます";

export function RemovePcConfirm({
  name,
  open,
  busy = false,
  onOpenChange,
  onConfirm,
}: {
  name: string;
  open: boolean;
  busy?: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Confirm
      title={`「${name}」を外しますか？`}
      description={REMOVE_PC_TEXT}
      confirmLabel="外す"
      tone="danger"
      open={open}
      busy={busy}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}

/* ---------------- OS の警告の越え方（K-374・K-375） ---------------- */

/** 受け取る入れ物の OS（connect-dialog.tsx の Os と同じ値） */
export type InstallerOs = "mac" | "win";

/** 閉じた形で出す見出し（前の「PC をつなぐ」画面の字のまま・BRG-06-011） */
export const OS_WARNING_SUMMARY = "「開いていません」「PC が保護されました」と出たとき";

/** 署名（Apple の公証・Windows のコード署名）が済むまでは、初めて開くと OS が止める。越え方だけを案内し、手順は変えない（D-015.7・D-109）。
 *  os：受け取った入れ物の OS（その OS の越え方だけ）。null なら両方。いまの macOS では「右クリック → 開く」では越えられない */
export function OsWarning({ os, defaultOpen = false }: { os: InstallerOs | null; defaultOpen?: boolean }) {
  return (
    <details className="k-pc-os-warning" data-os-warning open={defaultOpen}>
      <summary>{OS_WARNING_SUMMARY}</summary>
      <div className="k-pc-os-warning-body">
        <p>
          いまは Apple と Microsoft の署名の手続き中のため、初回に OS が止めます。<b>中身の問題ではありません。</b>1
          回越えれば次からは出ません。
        </p>
        {os !== "win" ? (
          <div data-os-warning-os="mac">
            <b className="k-pc-os-warning-os">Mac（「&quot;Kaname Bridge&quot; は開いていません」）</b>
            <ol>
              <li>「完了」を押す（「ゴミ箱に入れる」は押さない）</li>
              <li>画面左上のアップルメニュー →「システム設定」→「プライバシーとセキュリティ」</li>
              <li>
                下の方の「&quot;Kaname Bridge&quot; は…ブロックされました」の横の「このまま開く」を押し、パスワードか
                Touch ID を入れる
              </li>
              <li>もう一度 Kaname Bridge を開き、出てきた確認で「開く」を押す</li>
            </ol>
          </div>
        ) : null}
        {os !== "mac" ? (
          <div data-os-warning-os="win">
            <b className="k-pc-os-warning-os">Windows（「Windows によって PC が保護されました」）</b>
            <ol>
              <li>「詳細情報」を押す</li>
              <li>「実行」を押す</li>
            </ol>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/* ---------------- Bridge が古いときの入れ直す一手（K-375） ---------------- */

/** 入れ直しの文（E-CONN-012 の題の下の 1 行・前の画面の [data-bridge-reinstall] の字のまま） */
export const REINSTALL_TEXT = "書いたことは溜めておき、入れ直した後に順に片づけます。";
/** この端末に Bridge を入れられない（スマホ・タブレット）ときの 1 行（PAIR_ONLY_ON_PC_TEXT と同じ考え） */
export const REINSTALL_ON_PC_TEXT = "その PC でこの画面を開いて、入れ直してください";
/** 受け取りを始めた後の知らせ。新しい Bridge が知らせを返すと、行の自己診断から「古い」が消え、この区画も消える */
export const REINSTALL_TAKEN_TEXT =
  "受け取りを始めました。受け取った Kaname Bridge を開いて入れ直すと、このお知らせは自分で消えます";

export interface BridgeReinstallProps {
  /** この端末に Bridge を入れられるか（pair-device.ts の canPairHere）。false なら受け取るボタンを出さず、開く場所だけを言う */
  canInstall: boolean;
  /** 受け取りを始めた OS（その OS の越え方を出す） */
  taken?: InstallerOs | null;
  /** 受け取りの答えを待っている OS */
  busy?: InstallerOs | null;
  /** 受け取りの失敗（目録の文） */
  error?: string | null;
  onTake?: (os: InstallerOs) => void;
}

export function BridgeReinstall({ canInstall, taken = null, busy = null, error, onTake }: BridgeReinstallProps) {
  return (
    <section className="k-pc-part" data-part="bridge-reinstall" aria-label="Bridge を入れ直す">
      <b className="k-pc-part-title">{errorText("E-CONN-012").entry.message}</b>
      <p className="k-pc-part-text">{REINSTALL_TEXT}</p>
      {canInstall ? (
        <div className="k-pc-part-acts">
          <Button
            className="k-pc-btn"
            data-reinstall="mac"
            loading={busy === "mac"}
            disabled={busy !== null}
            onClick={() => onTake?.("mac")}
          >
            Mac 用を受け取る
          </Button>
          <Button
            variant="outlined"
            className="k-pc-btn"
            data-reinstall="win"
            loading={busy === "win"}
            disabled={busy !== null}
            onClick={() => onTake?.("win")}
          >
            Windows 用を受け取る
          </Button>
        </div>
      ) : (
        <p className="k-pc-part-meta">{REINSTALL_ON_PC_TEXT}</p>
      )}
      {canInstall && taken ? (
        <>
          <RowNote>{REINSTALL_TAKEN_TEXT}</RowNote>
          <OsWarning os={taken} />
        </>
      ) : null}
      {error ? <RowNote tone="danger">{error}</RowNote> : null}
    </section>
  );
}
