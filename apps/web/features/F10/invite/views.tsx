"use client";
// 招く（F10 の葉を段 9 の前に出す・代表の答え answer=56812da22008）の画面の部品（切る段の下絵・部品先行・枝 c/段9）。
//   キャンバス WsPeople（ワークスペースの管理 › メンバー）・WsInvite（招くの小窓）と、契約 createInvitations（POST /api/v1/invitations）・
//   createInvitationLink（招待のリンク）から。口とはまだつながず、値を受け取って描くだけ。
//   この葉が作るのは「並びを読む・招く・リンクを作る」だけ（代表の決め 2026-11-20）。役割を変える ▾・「⋯」・＋ グループ・送り直す・
//   このグループに招く・決まり／記録／設定 は F9・F10 の残りの物で、キャンバスに在るのでグレーで押せない形で出す（answer=78cb822fc1f1）
//   招待の入力にグループの欄を足す（代表の決め 2026-11-20）。画面に出る文は全部「仮」
//   並べ方（代表の直し 2026-11-20）：PC は本文の幅いっぱいのグループのカードに 1 人 1 行（丸いアイコン・名前とメール・役割・状態・操作）。
//     スマホは 1 人 1 行（丸いアイコン・名前とメール・役割の札）。小窓はメールを入れる欄・入れたメールの並び・グループと役割を段に分ける
import { ClipboardList, Settings, ShieldCheck, Users, X, type LucideIcon } from "lucide-react";
import { Badge, Button, Dialog, Menu, MenuItem, MenuPopup, MenuTrigger, NoticeBox } from "@/components/k";
import "@/components/k/me-sub.css";
import "./invite.css";

const inert = { "aria-disabled": true, tabIndex: -1, title: "まだ使えません" } as const;

// ---------------------------------------------------------------- ワークスペースの管理の頭と第 2 ナビ
/** ワークスペースの管理の頭（キャンバス WsPeople の上の帯：会社の印・名前・あなたの役割） */
export function WsHead({ name, initial }: { name: string; initial: string }) {
  return (
    <div className="k-inv-ws">
      <span className="k-inv-ws-mark" aria-hidden="true">
        {initial}
      </span>
      <div className="k-inv-ws-main">
        <p className="k-inv-ws-name">{name}</p>
        <p className="k-inv-sub">ワークスペースの管理 ・ あなたは管理者（権限のある人だけに出る）</p>
      </div>
    </div>
  );
}

interface SubItem {
  key: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}
const WS_ITEMS: SubItem[] = [
  { key: "members", label: "メンバー", icon: Users },
  { key: "rules", label: "決まり", icon: ShieldCheck },
  { key: "log", label: "記録", icon: ClipboardList },
  { key: "settings", label: "設定", icon: Settings },
];

/** ワークスペースの管理の第 2 ナビ（自分の設定の第 2 ナビ MeSub と同じ形・クラス。メンバーのほかは F9・F10 の残りなので押せない） */
export function WsSub({ members }: { members: number }) {
  return (
    <aside aria-label="ワークスペースの管理の中" className="k-me-sub">
      <div className="k-me-sub-m">
        <Menu>
          <MenuTrigger className="k-btn k-inv-sub-trigger" label="ワークスペースの管理 › メンバー（管理の中を選ぶ）">
            ワークスペースの管理 › メンバー ▾
          </MenuTrigger>
          <MenuPopup align="start" className="k-inv-sub-menu">
            {WS_ITEMS.map((it) => (
              <MenuItem key={it.key} className="k-select-item" disabled={it.key !== "members"}>
                {it.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
      {WS_ITEMS.map((it) => {
        const Icon = it.icon;
        const body = (
          <>
            <span className="k-me-sub-ic">
              <Icon size={16} aria-hidden="true" />
            </span>
            <span className="k-me-sub-t">{it.label}</span>
            {it.key === "members" ? <span className="k-inv-sub-count">{members}</span> : null}
          </>
        );
        return it.key === "members" ? (
          <a key={it.key} className="k-me-sub-i" href="#members" aria-current="page" title={it.label}>
            {body}
          </a>
        ) : (
          <a
            key={it.key}
            className="k-me-sub-i"
            role="link"
            aria-disabled="true"
            tabIndex={-1}
            title={`${it.label}（準備中）`}
          >
            {body}
          </a>
        );
      })}
      <div className="k-me-sub-note">直せるのは管理者と、権限を付けた人</div>
    </aside>
  );
}

// ---------------------------------------------------------------- メンバーの並び
export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  /** 状態の 1 行（分身 動いている・PC 3 日つながっていない・分身なし） */
  state: string;
  stateTone: "ok" | "warn" | "none";
  /** 名前の横の小さな注（自分・経理も兼ねる） */
  note?: string;
  /** 招待中（まだ入っていない）なら「あと N 日」 */
  invitedLeft?: string;
}
export interface MemberGroup {
  code: string;
  name: string;
  tone: "teal" | "plum" | "amber" | "indigo";
  rows: readonly MemberRow[];
}

function Person({ r }: { r: MemberRow }) {
  const invited = Boolean(r.invitedLeft);
  return (
    <li className="k-inv-row">
      <span className="k-inv-avatar" data-invited={invited || undefined} aria-hidden="true">
        {invited ? "？" : r.name.slice(0, 1)}
      </span>
      <span className="k-inv-who">
        <span className="k-inv-name">
          {invited ? r.email : r.name}
          {r.note ? <span className="k-inv-note">{r.note}</span> : null}
        </span>
        <span className="k-inv-sub">{invited ? `招待中 ・ あと ${r.invitedLeft}` : r.email}</span>
      </span>
      <span className="k-inv-role-cell">
        {invited ? (
          <Badge tone="progress">招待中</Badge>
        ) : (
          <button type="button" className="k-inv-role" data-admin={r.role === "管理者" || undefined} {...inert}>
            {`${r.role} ▾`}
          </button>
        )}
      </span>
      <span className="k-inv-state" data-tone={r.stateTone}>
        {invited ? "" : r.state}
      </span>
      <span className="k-inv-more">
        {invited ? (
          <Button variant="outlined" size="sm" {...inert}>
            送り直す
          </Button>
        ) : (
          <Button variant="ghost" size="sm" aria-label={`${r.name}のほかの操作`} {...inert}>
            ⋯
          </Button>
        )}
      </span>
    </li>
  );
}

/** メンバーの画面の本文（見出しの帯・グループごとのカード・下の注） */
export function MembersBody({ groups }: { groups: readonly MemberGroup[] }) {
  return (
    <section className="k-root k-page k-me-page k-inv-page" aria-labelledby="members-title">
      <header className="k-page-head">
        <h1 id="members-title">メンバー</h1>
        <p className="k-page-sub">グループごとに並ぶ。役割はその場で変えられる</p>
        <div className="k-page-acts">
          <Button variant="outlined" {...inert}>
            ＋ グループ
          </Button>
          <Button>＋ 招く</Button>
        </div>
      </header>
      <div className="k-inv-body">
        {groups.map((g) => {
          const invited = g.rows.filter((r) => r.invitedLeft).length;
          const people = g.rows.length - invited;
          return (
            <section key={g.code} className="k-inv-group" aria-labelledby={`grp-${g.code}`}>
              <div className="k-inv-group-head">
                <span className="k-inv-code" data-tone={g.tone} aria-hidden="true">
                  {g.code}
                </span>
                <h2 id={`grp-${g.code}`} className="k-inv-group-name">
                  {g.name}
                </h2>
                <span className="k-inv-sub">{`${people} 人${invited ? ` ＋ 招待中 ${invited}` : ""}`}</span>
                <Button variant="ghost" size="sm" className="k-inv-group-invite" {...inert}>
                  ＋ このグループに招く
                </Button>
              </div>
              <ul className="k-inv-rows">
                {g.rows.map((r) => (
                  <Person key={r.id} r={r} />
                ))}
              </ul>
            </section>
          );
        })}
        <p className="k-inv-sub">
          「⋯」から：グループを移す・兼ねる・一時的に止める・ワークスペースから外す（外すときは担当しているチケットの引き継ぎ先を選ぶ）
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 招くの小窓
export interface InviteValues {
  /** メールの欄にいま打っている字 */
  typing: string;
  /** 足したメール（招く人） */
  emails: readonly string[];
  group: string;
  role: string;
  message: string;
}
export interface InviteErrors {
  emails?: string;
}

/** 招くの小窓（キャンバス WsInvite）。メールを入れる欄 → 招く人の並び → グループと役割 → ひとこと・リンクで招く（開くと出る）の段 */
export function InviteDialog({
  open,
  values,
  errors = {},
  notice,
  link,
  more = false,
}: {
  open: boolean;
  values: InviteValues;
  errors?: InviteErrors;
  /** 口が断ったとき（送りすぎ・調子が悪い）。書いた中身は消さない */
  notice?: string;
  /** 作った招待のリンク（7 日・1 回だけ） */
  link?: string;
  /** 「ひとこと・リンクで招く」を開いておく */
  more?: boolean;
}) {
  return (
    <Dialog
      title="招く"
      subtitle="メールが届き、7 日のあいだ入れる"
      open={open}
      actions={
        <>
          <Button variant="outlined">やめる</Button>
          <Button>{values.emails.length > 1 ? `${values.emails.length} 人を招く` : "招く"}</Button>
        </>
      }
    >
      <div className="k-dialog-stack">
        {notice ? <NoticeBox>{notice}</NoticeBox> : null}
        <div className="k-field">
          <label className="k-label" htmlFor="inv-mail">
            メール<span className="k-field-required"> 必須</span>
          </label>
          <div className="k-inv-add">
            <input
              id="inv-mail"
              className="k-input"
              type="email"
              value={values.typing}
              placeholder="name@example.com"
              readOnly
              aria-invalid={errors.emails ? true : undefined}
            />
            <Button variant="outlined">足す</Button>
          </div>
          <span className="k-inv-sub">続けて入れると何人でも招ける（カンマで分けて貼ってもよい）</span>
        </div>
        {values.emails.length ? (
          <div className="k-field">
            <span className="k-label">{`招く人（${values.emails.length} 人）`}</span>
            <ul className="k-inv-chips">
              {values.emails.map((m) => (
                <li key={m} className="k-inv-chip">
                  <span className="k-inv-chip-t">{m}</span>
                  <button type="button" className="k-inv-chip-x" aria-label={`${m} を外す`}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {errors.emails ? <span className="k-err">{errors.emails}</span> : null}
        <div className="k-inv-pair">
          <label className="k-field">
            <span className="k-label">グループ</span>
            <select className="k-input" value={values.group} onChange={() => undefined}>
              {["営業", "受託開発"].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="k-field">
            <span className="k-label">役割</span>
            <select className="k-input" value={values.role} onChange={() => undefined}>
              {["メンバー", "マネージャー", "閲覧のみ", "管理者"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        <details className="k-inv-more-box" open={more}>
          <summary className="k-inv-more-sum">ひとこと・リンクで招く</summary>
          <div className="k-dialog-stack">
            <label className="k-field">
              <span className="k-label">ひとこと（任意）</span>
              <textarea className="k-input" rows={2} value={values.message} readOnly />
            </label>
            {link ? (
              <div className="k-field">
                <span className="k-label">招待のリンク（7 日・1 回だけ）</span>
                <div className="k-inv-add">
                  <input className="k-input" value={link} readOnly aria-label="招待のリンク" />
                  <Button variant="outlined">コピー</Button>
                </div>
                <span className="k-inv-sub">リンクを知っている人が 1 回だけ入れます。7 日で使えなくなります</span>
              </div>
            ) : (
              <Button variant="outlined" size="sm" className="k-inv-link-btn">
                招待のリンクを作る（7 日・1 回だけ）
              </Button>
            )}
          </div>
        </details>
        <p className="k-inv-sub">入ると、その人の PC をつなぐ案内が出る</p>
      </div>
    </Dialog>
  );
}
