"use client";
// 渡す・配る（F8・段 9）の画面の部品（切る段の下絵・部品先行・枝 c/段9）。口とはまだつながず、値を受け取って描くだけ。
//   入口（代表の答え answer=56812da22008）：詳細の右のパネルの「担当者 ▾」→ 相手を選ぶ小窓 → 引き継いでもらう小窓（担当者本人）／配る小窓（マネージャー）。
//   担当者を黙って直に書き換える道は作らない。担当者でない人は「引き継ぐ（申し出る）」だけ（題名の下のボタン・聞くこと 11 の勧め）。
//   AI が動いている・承認を待っているチケットは渡せない（answer=56812da22008）。渡し中も渡した人は全部できる（answer=eaa451436670）。
//   形は正本の部品（Dialog・Confirm・Band・Button・components/k の欄の型）だけで組む。値は正本のトークン（handover.css）だけ。
//   画面に出る文は全部「仮」（代表に聞くこと 20 の勧めのとおり）。エラーの番号（E-HND-…）は契約を書くときに一覧にする
//   値と動きは任意の props で受ける（onOpen・onPick・onSubmit・onClose・busy・notice など）。渡されなければ今のモックと同じ描き方
//   （ボタンは押しても何もしない・欄は読むだけ）。本物の画面の葉はこのファイルを触らず、props を渡して口とつなぐ
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Band, BandLine, Button, Callout, Confirm, Dialog, NoticeBox, SearchField } from "@/components/k";
import "./handover.css";

/** 相手を選ぶ小窓の 1 人 */
export interface PickMember {
  id: string;
  name: string;
  /** 主のグループと役割（「営業」「営業 マネージャー」） */
  sub: string;
  /** 今週の件数（担当者でまだ終わっていない・期限が今週・聞くこと 14 の勧め） */
  week: number;
  /** メール（名前と同じく探す欄で絞れる） */
  email: string;
  /** 見ている人 */
  self?: boolean;
  /** 今の担当者（✓・選べない） */
  current?: boolean;
  /** 選べない訳（止まっている・招待中）。在れば押せない形で出す */
  unavailable?: string;
}

/** 配る小窓でグループを選ぶときの 1 つ */
export interface PickGroup {
  id: string;
  code: string;
  name: string;
}

/** 小窓の頭の下の対象の行（モックの字。本物の画面は target で差し替える） */
const TARGET = "EG-119 問い合わせ（山田様）に一次返信する";

/** 小窓の閉じる手段（やめる・× ・Esc）。答えを待つ間（busy）は閉じない */
const closeOn =
  (onClose: (() => void) | undefined, busy = false) =>
  (next: boolean) => {
    if (!next && !busy) onClose?.();
  };

/** 小窓の足：やめる・決める。答えを待つ間（busy）は決めるが処理中になり、やめるも押せない */
function Foot({
  label,
  tone = "primary",
  busy = false,
  onSubmit,
  onClose,
}: {
  label: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onSubmit: (() => void) | undefined;
  onClose: (() => void) | undefined;
}) {
  return (
    <>
      <Button variant="outlined" disabled={busy} {...(onClose ? { onClick: onClose } : {})}>
        やめる
      </Button>
      <Button variant={tone} loading={busy} {...(onSubmit ? { onClick: onSubmit } : {})}>
        {label}
      </Button>
    </>
  );
}

const Avatar = ({ name }: { name: string }) => (
  <span className="k-detail-avatar" aria-hidden="true">
    {name.slice(0, 1)}
  </span>
);

export interface AssigneeValueProps {
  name: string;
  mode: "can" | "plain" | "blocked";
  /** 渡し中の相手（「→ 佐藤（返事待ち）」を名前の下に出す） */
  waitingFor?: string;
  reason?: string;
  /** ▾ を押したとき（相手を選ぶ小窓を開く）。blocked でも押せる（訳は小窓に出す・D-148.24） */
  onOpen?: () => void;
}

/** パネルの「担当者」の値。can＝押せる（▾）・plain＝読むだけ（閲覧のみ・取引先・申し出だけの人）・blocked＝AI が動いている（押せる形のまま・名前の下に訳を出す） */
export function AssigneeValue({ name, mode, waitingFor, reason, onOpen }: AssigneeValueProps) {
  const who = (
    <span className="k-detail-who">
      <Avatar name={name} />
      {name}
    </span>
  );
  return (
    <span className="k-hnd-assignee">
      {mode === "plain" ? (
        who
      ) : (
        <button
          type="button"
          className="k-hnd-assignee-btn"
          aria-haspopup="dialog"
          aria-label={`担当者 ${name}（担当者を変える）`}
          {...(mode === "blocked" && reason ? { title: reason } : {})}
          {...(onOpen ? { onClick: onOpen } : {})}
        >
          {who}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
      {waitingFor ? <span className="k-hnd-assignee-note">{`→ ${waitingFor}（返事待ち）`}</span> : null}
      {mode === "blocked" && reason ? <span className="k-hnd-assignee-note">{reason}</span> : null}
    </span>
  );
}

/** 探す字で絞る（名前・メール・グループ名。全角・半角のゆらぎ（NFKC）・前後の空白・大文字小文字は見ない） */
export function matchesQuery(text: readonly string[], query: string): boolean {
  const fold = (s: string) => s.normalize("NFKC").trim().toLowerCase();
  const q = fold(query);
  return q === "" || text.some((t) => fold(t).includes(q));
}

function MemberItem({
  m,
  blocked,
  onPick,
}: {
  m: PickMember;
  blocked: boolean;
  onPick: ((id: string) => void) | undefined;
}) {
  const off = blocked || Boolean(m.unavailable) || Boolean(m.current);
  const mark = m.self ? "（自分）" : m.current ? "（今の担当者）" : "";
  return (
    <li>
      <button
        type="button"
        className="k-hnd-pick-item"
        aria-current={m.current || undefined}
        {...(off ? { "aria-disabled": true, tabIndex: -1 } : onPick ? { onClick: () => onPick(m.id) } : {})}
      >
        <Avatar name={m.name} />
        <span className="k-hnd-pick-main">
          <span className="k-hnd-pick-name">{`${m.name}${mark}`}</span>
          <span className="k-hnd-pick-sub">{m.unavailable ? m.unavailable : `${m.sub} ・ 今週 ${m.week} 件`}</span>
          <span className="k-hnd-pick-sub">{m.email}</span>
        </span>
        {m.current ? <Check size={14} aria-label="今の担当者" /> : null}
      </button>
    </li>
  );
}

export interface PickDialogProps {
  open: boolean;
  members: readonly PickMember[];
  /** マネージャー（配る）のときだけ：グループにも配れる */
  groups?: readonly PickGroup[];
  /** 渡せない訳（AI が動いている・承認待ち・いま別の渡しの返事を待っている） */
  blocked?: string;
  /** 一覧の上の 1 行（引き継いでもらう／配る のどちらになるか） */
  intro: string;
  /** 探す欄に入っている字 */
  query?: string;
  /** 探す欄に打ったとき（渡すと探す欄は打てる欄になる。無ければ今の読むだけ） */
  onQueryChange?: (query: string) => void;
  /** 人を選んだとき */
  onPick?: (memberId: string) => void;
  /** グループを選んだとき（配る） */
  onPickGroup?: (groupId: string) => void;
  /** やめる・× ・Esc */
  onClose?: () => void;
  /** 頭の下の対象の行（既定はモックの字） */
  target?: ReactNode;
  /** 下見が読めないときなどの赤い知らせ */
  notice?: string;
  /** 知らせの下の「もう一度読む」（渡すと出る） */
  onRetry?: () => void;
}

/** 相手を選ぶ小窓（キャンバス TdAssignee の「担当者」の箱を小窓にした形）。上に探す欄（名前・メールで絞る・代表の直し 2026-11-20） */
export function PickDialog({
  open,
  members,
  groups,
  blocked,
  intro,
  query = "",
  onQueryChange,
  onPick,
  onPickGroup,
  onClose,
  target,
  notice,
  onRetry,
}: PickDialogProps) {
  const people = members.filter((m) => matchesQuery([m.name, m.email], query));
  const teams = (groups ?? []).filter((g) => matchesQuery([g.name, g.code], query));
  const none = people.length === 0 && teams.length === 0;
  return (
    <Dialog
      title="担当者を選ぶ"
      open={open}
      onOpenChange={closeOn(onClose)}
      target={target ?? TARGET}
      actions={
        <Button variant="outlined" {...(onClose ? { onClick: onClose } : {})}>
          やめる
        </Button>
      }
    >
      <div className="k-dialog-stack">
        {blocked ? <Callout tone="warn">{blocked}</Callout> : null}
        {notice ? <NoticeBox>{notice}</NoticeBox> : null}
        {notice && onRetry ? (
          <Button variant="outlined" size="sm" onClick={onRetry}>
            もう一度読む
          </Button>
        ) : null}
        <p className="k-hnd-intro">{intro}</p>
        <SearchField
          label={groups ? "名前・メール・グループで探す" : "名前・メールで探す"}
          value={query}
          {...(onQueryChange ? { onChange: (e) => onQueryChange(e.target.value) } : { readOnly: true })}
        />
        {none && query.trim() !== "" ? (
          <p className="k-hnd-empty" role="status">
            {`「${query.trim()}」に合う人がいません。名前かメールの一部で探してください（止まっている人・招待中の人も出ます）`}
          </p>
        ) : null}
        {people.length ? (
          <ul className="k-hnd-pick" aria-label="人">
            {people.map((m) => (
              <MemberItem key={m.id} m={m} blocked={Boolean(blocked)} onPick={onPick} />
            ))}
          </ul>
        ) : null}
        {teams.length ? (
          <ul className="k-hnd-pick" aria-label="グループ">
            {teams.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="k-hnd-pick-item"
                  {...(blocked
                    ? { "aria-disabled": true, tabIndex: -1 }
                    : onPickGroup
                      ? { onClick: () => onPickGroup(g.id) }
                      : {})}
                >
                  <span className="k-hnd-code" aria-hidden="true">
                    {g.code}
                  </span>
                  <span className="k-hnd-pick-main">
                    <span className="k-hnd-pick-name">{`グループ「${g.name}」に配る`}</span>
                    <span className="k-hnd-pick-sub">担当はそのグループの人が決める</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 一緒に切り替えるものの 1 行。fixed＝ワークスペースの決まりで「いつも」（印が付いて外せない） */
export interface CarryItem {
  label: string;
  checked: boolean;
  fixed?: boolean;
}

export interface HandoverValues {
  reason: string;
  ask: string;
  due: string;
}
export interface HandoverErrors {
  to?: string;
  reason?: string;
  due?: string;
}

function TextBox({
  label,
  required,
  value,
  error,
  rows = 2,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  error?: string | undefined;
  rows?: number;
  /** 打ったとき（渡すと打てる欄になる。無ければ読むだけ） */
  onChange?: ((value: string) => void) | undefined;
}) {
  return (
    <label className="k-field">
      <span className="k-label">
        {label}
        {required ? <span className="k-field-required"> 必須</span> : null}
      </span>
      <textarea
        className="k-input"
        rows={rows}
        value={value}
        aria-invalid={error ? true : undefined}
        {...(onChange ? { onChange: (e) => onChange(e.target.value) } : { readOnly: true })}
      />
      {error ? <span className="k-err">{error}</span> : null}
    </label>
  );
}

function LineBox({
  label,
  value,
  error,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  error?: string | undefined;
  type?: string;
  onChange?: ((value: string) => void) | undefined;
}) {
  return (
    <label className="k-field">
      <span className="k-label">{label}</span>
      <input
        className="k-input"
        type={type}
        value={value}
        aria-invalid={error ? true : undefined}
        {...(onChange ? { onChange: (e) => onChange(e.target.value) } : { readOnly: true })}
      />
      {error ? <span className="k-err">{error}</span> : null}
    </label>
  );
}

/** 相手の行（変える＝相手を選ぶ小窓に戻る） */
function ToRow({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string | undefined;
  onChange?: (() => void) | undefined;
}) {
  return (
    <div className="k-field">
      <span className="k-label">{label}</span>
      <div className="k-hnd-to">
        <span className="k-detail-who">
          <Avatar name={value} />
          {value}
        </span>
        <Button variant="ghost" size="sm" {...(onChange ? { onClick: onChange } : {})}>
          変える
        </Button>
      </div>
      {error ? <span className="k-err">{error}</span> : null}
    </div>
  );
}

export interface HandoverDialogProps {
  open: boolean;
  to: string;
  values: HandoverValues;
  errors?: HandoverErrors;
  carry: readonly CarryItem[];
  notifyManagers?: boolean;
  /** 口が断ったとき（もう渡し中・完了した・送りすぎ・調子が悪い）の赤い知らせ。書いた中身は消さない */
  notice?: string;
  /** 理由・お願い・返事の期限を打ったとき（変えた欄だけ） */
  onChange?: (patch: Partial<HandoverValues>) => void;
  /** 「一緒に切り替えるもの」のチェックを変えたとき（carry の何番目か） */
  onCarryChange?: (index: number, checked: boolean) => void;
  onNotifyChange?: (notify: boolean) => void;
  /** 「変える」（相手を選ぶ小窓に戻る） */
  onChangeTo?: () => void;
  onSubmit?: () => void;
  onClose?: () => void;
  /** 答えを待っている間（決めるが処理中・やめるも押せず閉じない） */
  busy?: boolean;
  /** 返事の期限の欄の type（既定 text。本物は日時の欄） */
  dueType?: string;
  /** 小窓の上の橙の文（口が 409 で断ったときなど）。無ければ出さない */
  callout?: string;
  /** 頭の下の対象の行（既定はモックの字） */
  target?: ReactNode;
}

/** 引き継いでもらうの小窓（キャンバス StModal） */
export function HandoverDialog({
  open,
  to,
  values,
  errors = {},
  carry,
  notifyManagers = false,
  notice,
  onChange,
  onCarryChange,
  onNotifyChange,
  onChangeTo,
  onSubmit,
  onClose,
  busy = false,
  dueType = "text",
  callout,
  target,
}: HandoverDialogProps) {
  const edit = (key: keyof HandoverValues) =>
    onChange ? (v: string) => onChange({ [key]: v } as Partial<HandoverValues>) : undefined;
  return (
    <Dialog
      title="引き継いでもらう"
      open={open}
      onOpenChange={closeOn(onClose, busy)}
      target={target ?? TARGET}
      actions={<Foot label="引き継いでもらう" busy={busy} onSubmit={onSubmit} onClose={onClose} />}
    >
      <div className="k-dialog-stack">
        {callout ? <Callout tone="warn">{callout}</Callout> : null}
        {notice ? <NoticeBox>{notice}</NoticeBox> : null}
        <ToRow label="渡す相手" value={to} error={errors.to} onChange={onChangeTo} />
        <TextBox label="理由" required value={values.reason} error={errors.reason} onChange={edit("reason")} />
        <TextBox label="お願い" value={values.ask} onChange={edit("ask")} />
        <LineBox label="返事の期限" value={values.due} error={errors.due} type={dueType} onChange={edit("due")} />
        {carry.length ? (
          <fieldset className="k-dialog-group">
            <legend>一緒に切り替えるもの（ワークスペースの決まりで選ばれている）</legend>
            {carry.map((c, i) => (
              <label key={c.label} className="k-dialog-check">
                <input
                  type="checkbox"
                  checked={c.checked}
                  {...(onCarryChange && !c.fixed
                    ? { onChange: (e) => onCarryChange(i, e.target.checked) }
                    : { readOnly: true })}
                  {...(c.fixed ? { disabled: true, "aria-disabled": true } : {})}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="k-dialog-check">
          <input
            type="checkbox"
            checked={notifyManagers}
            {...(onNotifyChange ? { onChange: (e) => onNotifyChange(e.target.checked) } : { readOnly: true })}
          />
          <span>上の層（マネージャー）にも知らせる</span>
        </label>
        <p className="k-hnd-note">相手が受けるまで担当者はあなたのまま（渡し中）。断られたら理由つきで戻ってきます。</p>
      </div>
    </Dialog>
  );
}

export interface DistributeDialogProps {
  open: boolean;
  to: string;
  toGroup?: boolean;
  reason: string;
  /** お願い（既定は空） */
  ask?: string;
  /** 理由の欄の下の赤い字 */
  error?: string;
  /** 理由・お願いを打ったとき（変えた欄だけ） */
  onChange?: (patch: { reason?: string; ask?: string }) => void;
  /** 「変える」（相手を選ぶ小窓に戻る） */
  onChangeTo?: () => void;
  onSubmit?: () => void;
  onClose?: () => void;
  busy?: boolean;
  /** 口が断ったときの赤い知らせ。書いた中身は消さない */
  notice?: string;
  /** 頭の下の対象の行（既定はモックの字） */
  target?: ReactNode;
}

/** 配る小窓（マネージャー・合意なしの既定・聞くこと 15 の勧め） */
export function DistributeDialog({
  open,
  to,
  toGroup = false,
  reason,
  ask = "",
  error,
  onChange,
  onChangeTo,
  onSubmit,
  onClose,
  busy = false,
  notice,
  target,
}: DistributeDialogProps) {
  return (
    <Dialog
      title="配る"
      open={open}
      onOpenChange={closeOn(onClose, busy)}
      target={target ?? TARGET}
      actions={<Foot label="配る" busy={busy} onSubmit={onSubmit} onClose={onClose} />}
    >
      <div className="k-dialog-stack">
        {notice ? <NoticeBox>{notice}</NoticeBox> : null}
        <ToRow label={toGroup ? "配るグループ" : "配る相手"} value={to} onChange={onChangeTo} />
        <TextBox
          label="理由"
          required
          value={reason}
          error={error}
          onChange={onChange ? (v) => onChange({ reason: v }) : undefined}
        />
        <TextBox label="お願い" value={ask} onChange={onChange ? (v) => onChange({ ask: v }) : undefined} />
        <p className="k-hnd-note">
          {toGroup
            ? `${to}の人が「自分が持つ」か「人を決める」を押すまで、担当者はあなたのままです。`
            : `配るとすぐ${to}さんが担当者になり、お知らせが届きます。`}
        </p>
      </div>
    </Dialog>
  );
}

export interface DeclineDialogProps {
  open: boolean;
  from: string;
  value: string;
  error?: string;
  /** 理由を打ったとき */
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onClose?: () => void;
  busy?: boolean;
  /** 口が断ったときの赤い知らせ。書いた中身は消さない */
  notice?: string;
  /** 頭の下の対象の行（既定はモックの字） */
  target?: ReactNode;
}

/** 断る小窓（理由は必須・承認待ちの行からも詳細の帯からも同じ） */
export function DeclineDialog({
  open,
  from,
  value,
  error,
  onChange,
  onSubmit,
  onClose,
  busy = false,
  notice,
  target,
}: DeclineDialogProps) {
  return (
    <Dialog
      title="断る"
      open={open}
      onOpenChange={closeOn(onClose, busy)}
      target={target ?? TARGET}
      actions={<Foot label="断る" tone="danger" busy={busy} onSubmit={onSubmit} onClose={onClose} />}
    >
      <div className="k-dialog-stack">
        {notice ? <NoticeBox>{notice}</NoticeBox> : null}
        <TextBox label="断る理由" required value={value} error={error} onChange={onChange} />
        <p className="k-hnd-note">{`理由は${from}さんに届き、チケットの記録に残ります。`}</p>
      </div>
    </Dialog>
  );
}

export interface OfferDialogProps {
  open: boolean;
  assignee: string;
  value: string;
  error?: string;
  /** 理由を打ったとき */
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onClose?: () => void;
  busy?: boolean;
  /** 口が断ったときの赤い知らせ。書いた中身は消さない */
  notice?: string;
  /** 頭の下の対象の行（既定はモックの字） */
  target?: ReactNode;
}

/** 引き継ぐ（申し出る）の小窓（返事の期限は付けない・聞くこと 11 の勧め） */
export function OfferDialog({
  open,
  assignee,
  value,
  error,
  onChange,
  onSubmit,
  onClose,
  busy = false,
  notice,
  target,
}: OfferDialogProps) {
  return (
    <Dialog
      title="引き継ぎを申し出る"
      open={open}
      onOpenChange={closeOn(onClose, busy)}
      target={target ?? TARGET}
      actions={<Foot label="申し出る" busy={busy} onSubmit={onSubmit} onClose={onClose} />}
    >
      <div className="k-dialog-stack">
        {notice ? <NoticeBox>{notice}</NoticeBox> : null}
        <TextBox label="理由" required value={value} error={error} onChange={onChange} />
        <p className="k-hnd-note">{`担当者（${assignee}さん）が「渡す」と答えたら、あなたが担当者になります。`}</p>
      </div>
    </Dialog>
  );
}

export interface WithdrawConfirmProps {
  open: boolean;
  to: string;
  /** 「取り消す」を押したとき */
  onConfirm?: () => void;
  /** 開け閉め（やめる・Esc で false） */
  onOpenChange?: (open: boolean) => void;
  /** 答えを待っている間（処理中・閉じない） */
  busy?: boolean;
}

/** 渡しを取り消す確かめ */
export function WithdrawConfirm({ open, to, onConfirm, onOpenChange, busy = false }: WithdrawConfirmProps) {
  return (
    <Confirm
      title="渡しを取り消しますか？"
      description={`${to}さんへの渡しを取り消します。担当者はあなたのままです。${to}さんに「取り消されました」と知らせます。`}
      confirmLabel="取り消す"
      open={open}
      busy={busy}
      onOpenChange={(next) => onOpenChange?.(next)}
      onConfirm={() => onConfirm?.()}
    />
  );
}

/** 担当者でない人の、題名の下のボタン（申し出の入口） */
export function OfferEntry({ onClick }: { onClick?: () => void }) {
  return (
    <div className="k-hnd-offer">
      <Button variant="outlined" size="sm" {...(onClick ? { onClick } : {})}>
        引き継ぐ（申し出る）
      </Button>
    </div>
  );
}

/** 帯の種類（use-handovers.ts の bandKindOf が決める。本物の帯を書く葉は種類を自分で決めない） */
export type HandoverBandKind =
  | "sending"
  | "receiving"
  | "declined"
  | "overdue"
  | "accepted"
  | "taken"
  | "gone"
  | "offered"
  | "offering"
  | "offer-accepted"
  | "offer-declined"
  | "distributed"
  | "group"
  | "read-failed";

const btn = (label: string, variant: "primary" | "outlined" = "outlined"): ReactNode => (
  <Button key={label} size="sm" variant={variant}>
    {label}
  </Button>
);

export interface HandoverBandProps {
  kind: HandoverBandKind;
  /** 相手（渡した人から見た相手・渡された人から見た渡した人・配った人・申し出た人） */
  who: string;
  at?: string;
  reason?: string;
  ask?: string;
  due?: string;
  carry?: string;
  /** 右のボタンの並び（渡すと種類ごとの既定の並びを置き換える。押せる形にする葉が渡す） */
  acts?: ReactNode;
  /** 口が断ったときの赤い知らせ（帯の箱の上）。書いた中身は消さない */
  notice?: string;
}

/** 詳細の題名の下の、渡しの帯（承認と実行の帯と同じ場所） */
export function HandoverBand({ notice, ...rest }: HandoverBandProps) {
  return (
    <>
      {notice ? <NoticeBox>{notice}</NoticeBox> : null}
      <BandOf {...rest} />
    </>
  );
}

function BandOf({ kind, who, at, reason, ask, due, carry, acts }: Omit<HandoverBandProps, "notice">) {
  switch (kind) {
    case "sending":
      return (
        <Band
          tone="wait"
          title={`${who}さんの返事を待っています（渡し中）`}
          sub={`返事の期限 ${due ?? ""} ・ 担当者は返事が来るまであなたのまま`}
          acts={acts ?? [btn("催促する"), btn("取り消す"), btn("別の人にする")]}
        >
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
          <BandLine>完了にする・消すと、この渡しは取り消され、相手にお知らせが届きます</BandLine>
        </Band>
      );
    case "receiving":
      return (
        <Band
          tone="approval"
          title={`${who}さんから、引き継いでほしいと頼まれています`}
          sub={`返事の期限 ${due ?? ""}${carry ? ` ・ ${carry}` : ""}`}
          acts={acts ?? [btn("断る"), btn("受ける", "primary")]}
        >
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
          {ask ? <BandLine>{`お願い：${ask}`}</BandLine> : null}
        </Band>
      );
    case "declined":
      return (
        <Band
          tone="danger"
          title={`${who}さんに断られました`}
          sub={at}
          acts={acts ?? [btn("閉じる"), btn("別の人にする", "primary")]}
        >
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
        </Band>
      );
    case "overdue":
      return (
        <Band
          tone="wait"
          title={`${who}さんの返事がまだありません`}
          sub={`返事の期限 ${due ?? ""} を過ぎました。${who}さんは今からでも受ける・断るを押せます`}
          acts={acts ?? [btn("取り消す"), btn("別の人にする"), btn("催促する", "primary")]}
        />
      );
    case "accepted":
    case "offer-accepted":
      return (
        <Band tone="ok" title="担当者になりました" sub={`${who}さんから引き継ぎ ・ ${at ?? ""}`}>
          {carry ? <BandLine>{carry}</BandLine> : null}
        </Band>
      );
    case "taken":
      return <Band tone="ok" title={`${who}さんが引き継ぎました`} sub={`${at ?? ""} ・ 担当者は${who}さんです`} />;
    case "gone":
      return (
        <Band tone="plain" title="この渡しは取り消されました" sub={`${who}さんが ${at ?? ""} に取り消し`}>
          <BandLine>あなたが答える必要はなくなりました</BandLine>
        </Band>
      );
    case "offered":
      return (
        <Band
          tone="approval"
          title={`${who}さんが、引き継ぎを申し出ています`}
          sub={at}
          acts={acts ?? [btn("断る"), btn("渡す", "primary")]}
        >
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
        </Band>
      );
    case "offering":
      return (
        <Band
          tone="wait"
          title={`${who}さんに引き継ぎを申し出ています`}
          sub={`担当者は返事が来るまで${who}さんのまま ・ ${at ?? ""}`}
          acts={acts ?? [btn("取り消す")]}
        >
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
        </Band>
      );
    case "offer-declined":
      return (
        <Band tone="danger" title={`${who}さんに断られました`} sub={at}>
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
        </Band>
      );
    case "distributed":
      return (
        <Band tone="info" title={`${who}さんから配られました`} sub={at}>
          <BandLine>{`理由：${reason ?? ""}`}</BandLine>
        </Band>
      );
    case "group":
      return (
        <Band
          tone="wait"
          title={`グループ「${who}」に配り中`}
          sub={`そのグループの人が担当を決めるまで、担当者はあなたのまま ・ ${at ?? ""}`}
          acts={acts ?? [btn("取り消す")]}
        />
      );
    case "read-failed":
      return (
        <Band tone="danger" role="alert" title="渡しの様子を読み込めませんでした" acts={acts ?? [btn("もう一度読む")]}>
          <BandLine>本文はそのまま読めます</BandLine>
        </Band>
      );
  }
}

/** 承認待ちの「渡された」の行（行の部品に種類を足す・本番は queue-table.tsx の Row が種類で出し分ける） */
export interface HandoverQueueRow {
  id: string;
  number: string;
  title: string;
  sub: string;
  from: string;
  due: string;
  late?: boolean;
  /** 左の従・右の主のボタン（受ける／断る・渡す／断る・人を決める／自分が持つ） */
  acts: readonly [string, string];
  highlight?: boolean;
}

export interface HandoverRowProps {
  row: HandoverQueueRow;
  /** 押したボタンの字（row.acts の左右どちらか）を知らせる。無ければ押しても何もしない */
  onAct?: (label: string) => void;
  /** 答えを待っている間（ボタンは押せない） */
  busy?: boolean;
  /** 題名と番号の行き先（既定は # のまま） */
  href?: string;
  /** 右のボタンの並び（渡すと既定の 2 つを置き換える。AI の成果物の行の「中身を見る」のリンクなど） */
  acts?: ReactNode;
  /** 行の中の赤い字（role=alert） */
  error?: string;
}

export function HandoverRow({ row, onAct, busy = false, href = "#ticket", acts, error }: HandoverRowProps) {
  return (
    <tr className="k-hnd-row" data-highlight={row.highlight || undefined}>
      <td>
        <span className="k-ap-dash" title="1 件ずつ決める">
          —
        </span>
      </td>
      <td>
        <span className="k-ap-kind">渡された</span>
      </td>
      <td />
      <td>
        <a className="k-link k-ap-num" href={href}>
          {row.number}
        </a>
      </td>
      <td className="k-ap-title">
        <a href={href}>{row.title}</a>
        <span className="k-ap-sub">{row.sub}</span>
        {error ? (
          <span className="k-err" role="alert">
            {error}
          </span>
        ) : null}
      </td>
      <td>
        <span className="k-ap-from">
          <span className="k-ap-avatar" aria-hidden="true">
            {row.from.slice(0, 1)}
          </span>
          {row.from}
        </span>
      </td>
      <td className="k-ap-check" />
      <td data-late={row.late || undefined}>{row.due}</td>
      <td className="k-ap-end">
        <span className="k-ap-acts">
          {acts ?? (
            <>
              <Button
                size="sm"
                variant="outlined"
                disabled={busy}
                {...(onAct ? { onClick: () => onAct(row.acts[0]) } : {})}
              >
                {row.acts[0]}
              </Button>
              <Button size="sm" disabled={busy} {...(onAct ? { onClick: () => onAct(row.acts[1]) } : {})}>
                {row.acts[1]}
              </Button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

/** 承認待ちのスマホの 1 枚（キャンバス MbApprovals のカード：番号の札と誰から・題名・中身の 1 行・2 つのボタン）。
 *  幅 767 以下は表の代わりにこのカードを縦に並べる（表を横に送らない・代表の直し 2026-11-20） */
export interface QueueCardView {
  id: string;
  number: string;
  /** 番号の札の右の 1 行（「高本さんから ・ 渡された」「佐藤のAI ・ 確認 通過 3」） */
  meta: string;
  title: string;
  sub?: string;
  /** 返事の期限など（橙の字） */
  note?: string;
  acts: readonly [string, string];
}

export interface QueueCardMobileProps {
  card: QueueCardView;
  /** 押したボタンの字（card.acts の左右どちらか）を知らせる。無ければ押しても何もしない */
  onAct?: (label: string) => void;
  busy?: boolean;
  /** 題名の行き先（既定は # のまま） */
  href?: string;
  /** ボタンの並び（渡すと既定の 2 つを置き換える。AI の成果物の「中身を見る」のリンクなど） */
  acts?: ReactNode;
  /** カードの中の赤い字（role=alert） */
  error?: string;
}

export function QueueCardMobile({ card, onAct, busy = false, href = "#ticket", acts, error }: QueueCardMobileProps) {
  return (
    <li className="k-hnd-mcard">
      <div className="k-hnd-mcard-meta">
        <span className="k-hnd-mcard-num">{card.number}</span>
        <span className="k-hnd-mcard-from">{card.meta}</span>
      </div>
      <a className="k-hnd-mcard-title" href={href}>
        {card.title}
      </a>
      {card.sub ? <p className="k-hnd-mcard-sub">{card.sub}</p> : null}
      {card.note ? <p className="k-hnd-mcard-note">{card.note}</p> : null}
      {error ? (
        <p className="k-err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="k-hnd-mcard-acts">
        {acts ?? (
          <>
            <Button variant="outlined" disabled={busy} {...(onAct ? { onClick: () => onAct(card.acts[0]) } : {})}>
              {card.acts[0]}
            </Button>
            <Button disabled={busy} {...(onAct ? { onClick: () => onAct(card.acts[1]) } : {})}>
              {card.acts[1]}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
