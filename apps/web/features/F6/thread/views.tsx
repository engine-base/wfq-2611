"use client";
// 段 7 のやり取り（右のパネルのタブ「やり取り」・キャンバス TdTalk）の見た目の部品。下絵（K-66 の切る段・/dev/mock/f6）で並べる。
//   口はまだつながない（読む・書く・直す・消す・☆ の口は K-383〜K-386、画面の結線は K-392〜K-394）。ここは値を受け取って描くだけ。
//   代表の答え（2026-11-20）：⑧ 読める人は書ける（閲覧のみも書く欄が出る・段は変えられない）／⑨ 知らせる人の欄を残す（最初から担当者と承認する人・候補は見られる人だけ）／
//   ⑬「新しい」の印とタブの数を出す／⑩ 直した印／⑪ 消した跡の 1 行／⑫ ☆ は数を出す／⑭ 完了したチケットにも書ける／⑮ 小さな決めは勧めのとおり
//   まだの物（担当 ▾・📎）は隠さず、押せない形で出す（D-145.9）
import { Bot, Paperclip } from "lucide-react";
import { Fragment, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Button, Callout, Confirm, Menu, MenuItem, MenuPopup, MenuTrigger, TextArea, TextField } from "@/components/k";
import { InertButton } from "@/features/F4/create-ticket/detail-head";
import { STAGES, StageTag, type StageView } from "@/features/F6/progress/views";
import "./thread.css";

export type Tone = "lavender" | "indigo" | "teal";
export interface Person {
  name: string;
  /** 顔に出す頭の字 */
  initial: string;
  tone?: Tone;
}

/** glyph="css"：頭の字を文字として置かず、CSS の ::before で描く（変更の 1 行の字が「佐佐藤」と二重にならないように・K392-UI-024） */
export function Avatar({ who, small, glyph }: { who: Person; small?: boolean; glyph?: "css" }) {
  if (glyph === "css")
    return (
      <span
        className="k-talk-avatar"
        data-tone={who.tone}
        data-size={small ? "sm" : undefined}
        data-glyph={who.initial}
        aria-hidden="true"
      />
    );
  return (
    <span className="k-talk-avatar" data-tone={who.tone} data-size={small ? "sm" : undefined} aria-hidden="true">
      {who.initial}
    </span>
  );
}

/** 本文の中の @ の札 */
export function Mention({ children }: { children: ReactNode }) {
  return <span className="k-talk-mention">{children}</span>;
}

/** 右のパネルのタブ（属性・やり取り・〈見ている人〉のAI）。やり取りに読んでいない数の札。AI のタブは段 6 まで押せない形 */
export function TalkTabs({
  active,
  count,
  me,
  onTab,
}: {
  active: "attr" | "talk";
  count?: number;
  me: string;
  /** タブを押したとき（無ければ見た目だけ） */
  onTab?: (tab: "attr" | "talk") => void;
}) {
  return (
    <nav aria-label="パネルのタブ" className="k-detail-tabs">
      <button type="button" aria-current={active === "attr" ? "page" : undefined} onClick={() => onTab?.("attr")}>
        属性
      </button>
      <button type="button" aria-current={active === "talk" ? "page" : undefined} onClick={() => onTab?.("talk")}>
        やり取り
        {count ? (
          <span className="k-talk-count" aria-label={`まだ読んでいない書き込み ${count} 件`}>
            {count}
          </span>
        ) : null}
      </button>
      {me ? (
        <button type="button" aria-disabled="true" tabIndex={-1} title="まだ使えません">
          <Bot size={14} aria-hidden="true" />
          {`${me}のAI`}
        </button>
      ) : null}
    </nav>
  );
}

export type Filter = "all" | "talk" | "mine";
/** 絞り込みの帯（すべて・話だけ・自分あて N）と並び（古い順 ▾） */
export type Order = "asc" | "desc";
const ORDER_NAME: Record<Order, string> = { asc: "古い順", desc: "新しい順" };

export function ThreadFilters({
  active,
  mineCount,
  onFilter,
  order = "asc",
  onOrder,
}: {
  active: Filter;
  mineCount?: number;
  /** 札を押したとき（無ければ見た目だけ） */
  onFilter?: (f: Filter) => void;
  order?: Order;
  /** 並びを選んだとき */
  onOrder?: (o: Order) => void;
}) {
  const chip = (key: Filter, label: string) => (
    <button type="button" className="k-talk-chip" aria-pressed={active === key} onClick={() => onFilter?.(key)}>
      {label}
    </button>
  );
  return (
    <div className="k-talk-filters" role="group" aria-label="やり取りの絞り込み">
      {chip("all", "すべて")}
      {chip("talk", "話だけ")}
      {chip("mine", mineCount ? `自分あて ${mineCount}` : "自分あて")}
      <Menu>
        <MenuTrigger label={`並び：${ORDER_NAME[order]}`} className="k-talk-order">
          {ORDER_NAME[order]} ▾
        </MenuTrigger>
        <MenuPopup className="k-talk-menu">
          {(["asc", "desc"] as const).map((o) => (
            <MenuItem key={o} onSelect={() => onOrder?.(o)}>
              {ORDER_NAME[o]}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

export interface PostView {
  id: string;
  who: Person;
  time: string;
  body: ReactNode;
  /** 引用した書き込みの頭の 1〜2 行 */
  quote?: string;
  /** 書き込みと一緒に残った変更（状態：作業中 → 保留 など） */
  changes?: readonly string[];
  /** 知らせた人（名前を・でつないだ字） */
  notified?: string;
  /** 直した時刻（「直した 11/01 11:05」） */
  edited?: string;
  /** まだ読んでいない（最後に開いた時刻より後のほかの人の書き込み） */
  isNew?: boolean;
  stars?: number;
  /** 自分が ☆ を押している */
  starred?: boolean;
  /** この書き込みが決定になった */
  decided?: boolean;
  /** 「…」に出す操作：own＝直す・消す…（書いた本人）／manager＝消す…（マネージャーが人の書き込み）／none＝出さない */
  menu?: "own" | "manager" | "none";
  /** モックで「…」を開いておく */
  menuOpen?: boolean;
}

export type ThreadItem =
  | { kind: "day"; label: string }
  | { kind: "post"; post: PostView }
  | { kind: "editing"; post: PostView; text: string }
  | { kind: "line"; who: Person; text: ReactNode; time: string }
  | { kind: "run"; title: ReactNode; meta: string; result: string; onOpen?: () => void };

function PostMenu({ menu, open }: { menu: "own" | "manager"; open?: boolean }) {
  return (
    <Menu defaultOpen={open ?? false}>
      <MenuTrigger label="この書き込みの操作" className="k-talk-act k-talk-more-btn">
        …
      </MenuTrigger>
      <MenuPopup className="k-talk-menu">
        {menu === "own" ? <MenuItem>直す</MenuItem> : null}
        <MenuItem className="k-talk-danger">消す…</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** 「決定にする」「✓ 決定にした」（行の下の操作。K-398 も使う） */
export function DecideAct({
  decided,
  onDecide,
  disabled,
}: {
  decided?: boolean;
  onDecide?: () => void;
  disabled?: boolean;
}) {
  if (decided) return <span className="k-talk-decided">✓ 決定にした</span>;
  return (
    <button
      type="button"
      className="k-talk-act"
      aria-disabled={disabled ? "true" : undefined}
      onClick={disabled ? undefined : onDecide}
    >
      決定にする
    </button>
  );
}

export interface PostProps {
  post: PostView;
  onStar?: () => void;
  /** ☆ を送っている間（押せない形） */
  starBusy?: boolean;
  onQuote?: () => void;
  /** あれば「…」のメニューの代わりに置く */
  menuSlot?: ReactNode;
  /** あれば「決定にする」の代わりに置く */
  decideSlot?: ReactNode;
  /** article の id（飛び先 msg-<id>）。あれば焦点も受ける（Tab の順には入らない） */
  anchorId?: string;
}

export function Post({ post: p, onStar, starBusy, onQuote, menuSlot, decideSlot, anchorId }: PostProps) {
  return (
    <article
      className="k-talk-post"
      data-new={p.isNew || undefined}
      aria-label={`${p.who.name} ${p.time}`}
      {...(anchorId ? { id: anchorId, tabIndex: -1 } : {})}
    >
      <Avatar who={p.who} />
      <div className="k-talk-post-main">
        <div className="k-talk-post-head">
          <b>{p.who.name}</b>
          <time className="k-talk-sub">{p.time}</time>
          {p.edited ? <span className="k-talk-sub">直した {p.edited}</span> : null}
          {p.isNew ? <span className="k-talk-new">新しい</span> : null}
        </div>
        {p.quote ? <blockquote className="k-talk-quote">{p.quote}</blockquote> : null}
        <p className="k-talk-body">{p.body}</p>
        {p.changes?.length ? (
          <ul className="k-talk-changes" aria-label="一緒に残った変更">
            {p.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        {p.notified ? <div className="k-talk-sub">知らせた：{p.notified}</div> : null}
        <div className="k-talk-acts">
          <button
            type="button"
            className="k-talk-act"
            aria-label={`☆ ${p.stars ?? 0}`}
            aria-pressed={p.starred ?? false}
            aria-disabled={starBusy ? "true" : undefined}
            onClick={starBusy ? undefined : onStar}
          >
            {p.stars ? `☆ ${p.stars}` : "☆"}
          </button>
          <button type="button" className="k-talk-act" onClick={onQuote}>
            引用
          </button>
          {decideSlot ?? <DecideAct decided={p.decided ?? false} />}
          {menuSlot ??
            (p.menu && p.menu !== "none" ? <PostMenu menu={p.menu} {...(p.menuOpen ? { open: true } : {})} /> : null)}
        </div>
      </div>
    </article>
  );
}

/** @ の候補（見られる人だけ） */
export interface MentionOption {
  name: string;
  sub: string;
}
export function MentionList({
  options,
  active = 0,
  onPick,
}: {
  options: readonly MentionOption[];
  active?: number;
  onPick?: (i: number) => void;
}) {
  if (!options.length) return null;
  return (
    <ul className="k-talk-mentions" role="listbox" aria-label="呼べる人（このチケットを見られる人だけ）">
      {options.map((m, i) => (
        <li
          key={m.name}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault(); // 打っている欄から焦点を外さない
            onPick?.(i);
          }}
        >
          {m.name}
          <span className="k-talk-sub">{m.sub}</span>
        </li>
      ))}
    </ul>
  );
}

export interface EditingPostProps {
  post: PostView;
  text: string;
  value?: string;
  onText?: (s: string) => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  error?: string;
  mentions?: readonly MentionOption[];
  activeMention?: number;
  onPickMention?: (i: number) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** 自分の書き込みをその場で直している形（「やめる」「直す」） */
export function EditingPost({
  post: p,
  text,
  value,
  onText,
  onCancel,
  onSave,
  saving,
  error,
  mentions,
  activeMention,
  onPickMention,
  textareaRef,
  onKeyDown,
}: EditingPostProps) {
  return (
    <article className="k-talk-post" aria-label={`${p.who.name} ${p.time}（直している）`}>
      <Avatar who={p.who} />
      <div className="k-talk-post-main">
        <div className="k-talk-post-head">
          <b>{p.who.name}</b>
          <time className="k-talk-sub">{p.time}</time>
        </div>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {mentions?.length ? (
          <MentionList options={mentions} onPick={onPickMention} active={activeMention ?? 0} />
        ) : null}
        <div className="k-talk-box">
          <TextArea
            label={<span className="sr-only">書き込みを直す</span>}
            name="edit_body"
            rows={2}
            onKeyDown={onKeyDown}
            {...(textareaRef ? ({ ref: textareaRef } as object) : {})}
            {...(value !== undefined
              ? { value, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => onText?.(e.target.value) }
              : { defaultValue: text })}
          />
        </div>
        <div className="k-talk-edit-acts">
          <Button variant="outlined" size="sm" onClick={onCancel} disabled={saving ?? false}>
            やめる
          </Button>
          <Button size="sm" onClick={onSave} loading={saving ?? false}>
            直す
          </Button>
        </div>
      </div>
    </article>
  );
}

/** 変更だけの記録・消した跡の小さな 1 行 */
export function Line({ who, text, time }: { who: Person; text: ReactNode; time: string }) {
  return (
    <div className="k-talk-line">
      <Avatar who={who} small glyph="css" />
      <span>{text}</span>
      <time className="k-talk-sub">{time}</time>
    </div>
  );
}

/** AI の実行 1 回＝1 枚（押すと実行の記録へ） */
export function RunCard({
  title,
  meta,
  result,
  onOpen,
}: {
  title: ReactNode;
  meta: string;
  result: string;
  /** 押したとき（既定の動きを止めて呼ぶ） */
  onOpen?: () => void;
}) {
  return (
    <a
      className="k-talk-run"
      href="#run-log"
      onClick={
        onOpen
          ? (e) => {
              e.preventDefault();
              onOpen();
            }
          : undefined
      }
    >
      <span className="k-talk-run-mark" aria-hidden="true">
        AI
      </span>
      <span className="k-talk-run-text">
        {title}
        <span className="k-talk-sub">{meta} ・ 実行の記録を見る →</span>
      </span>
      <span className="k-badge" data-tone="success">
        {result}
      </span>
    </a>
  );
}

/** 最初に出す件数（新しい方から）。古い書き込みは「前の書き込みを見る（あと N 件）」で同じ件数ずつ足す（代表の直し 2026-11-20） */
export const THREAD_PAGE = 20;

/** 並びを逆にする：日付ごとのまとまりの順と、まとまりの中の順を逆に（日付の区切りは各まとまりの頭に置いたまま） */
export function inOrder(items: readonly ThreadItem[], order: Order): readonly ThreadItem[] {
  if (order === "asc") return items;
  const groups: ThreadItem[][] = [];
  for (const it of items) {
    if (it.kind === "day" || groups.length === 0) groups.push([it]);
    else groups[groups.length - 1]!.push(it);
  }
  return groups.reverse().flatMap((g) => {
    const [head, ...rest] = g;
    return head?.kind === "day" ? [head, ...rest.reverse()] : g.slice().reverse();
  });
}

export interface ThreadListProps {
  items: readonly ThreadItem[];
  olderCount?: number;
  /** 「前の書き込みを見る」を押したとき */
  onOlder?: () => void;
  /** 前を読んでいる間 */
  olderBusy?: boolean;
  /** 前が読めなかった（箱の上に知らせ。出ていた行とボタンはそのまま） */
  olderError?: string;
  order?: Order;
  /** 1 つの行を描く（無ければ部品の既定。行ごとの操作を足す入れ物が使う） */
  renderPost?: (post: PostView) => ReactNode;
}

export function ThreadList({
  items,
  olderCount,
  onOlder,
  olderBusy,
  olderError,
  order = "asc",
  renderPost,
}: ThreadListProps) {
  const more = olderCount ? (
    <Button variant="outlined" size="sm" className="k-talk-more" onClick={onOlder} loading={olderBusy ?? false}>
      前の書き込みを見る（あと {olderCount} 件）
    </Button>
  ) : null;
  return (
    <>
      {olderError ? <Callout tone="danger">{olderError}</Callout> : null}
      <div className="k-talk-thread" role="feed" aria-label="やり取り">
        {order === "asc" ? more : null}
        {inOrder(items, order).map((it, i) => {
          switch (it.kind) {
            case "day":
              return (
                <div key={i} className="k-talk-day">
                  {it.label}
                </div>
              );
            case "post":
              return renderPost ? (
                <Fragment key={it.post.id}>{renderPost(it.post)}</Fragment>
              ) : (
                <Post key={i} post={it.post} />
              );
            case "editing":
              return <EditingPost key={i} post={it.post} text={it.text} />;
            case "line":
              return <Line key={i} who={it.who} text={it.text} time={it.time} />;
            case "run":
              return <RunCard key={i} title={it.title} meta={it.meta} result={it.result} onOpen={it.onOpen} />;
          }
        })}
        {order === "desc" ? more : null}
      </div>
    </>
  );
}

/** やり取りが空（絞り込んで当てはまる物が無いときも同じ文） */
export function ThreadEmpty() {
  return (
    <div className="k-talk-thread">
      <div className="k-talk-center">
        <p>まだやり取りはありません。気づいたこと・聞きたいことを書いてください</p>
      </div>
    </div>
  );
}

/** 読めなかった（パネルの中だけの失敗。本文と属性はそのまま使える） */
export function ThreadFailed({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="k-talk-thread">
      <div className="k-talk-center">
        <Callout tone="danger">やり取りを読み込めませんでした</Callout>
        <Button variant="outlined" size="sm" onClick={onRetry}>
          もう一度読む
        </Button>
      </div>
    </div>
  );
}

export const STAGE_CHOICES = ["変えない", "未着手", "作業中", "保留…"] as const;
export type StageChoice = (typeof STAGE_CHOICES)[number];

export interface ComposerProps {
  text?: string;
  /** 知らせる人（最初から担当者と承認する人。自分は入れない）。名前の並びだけでも、id つきの並びでも受ける */
  notify?: readonly (string | { id: string; name: string })[];
  /** 書き込みと一緒に変える段（「状態 ▾」）。保留…を選ぶと理由と再開の条件の欄が開く */
  stage?: StageChoice;
  /** 状態 ▾ を押せない（仕組みの段の間・完了・閲覧のみ） */
  stageLocked?: boolean;
  /** 「状態 ▾」を開いておく（モック） */
  stageOpen?: boolean;
  /** @ の候補を開いておく（モック）。見られる人だけが候補に出る */
  mentions?: readonly { name: string; sub: string }[];
  /** 送っている間（二度押しで 2 通にしない） */
  sending?: boolean;
  /** 送れなかった（書いた字は残す） */
  failed?: boolean;
  /** 書いている字（あれば欄はこの値で描く。無ければ text を初めの字に） */
  value?: string;
  onText?: (s: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveNotify?: (id: string) => void;
  onAddNotify?: () => void;
  onSend?: () => void;
  sendDisabled?: boolean;
  /** あれば「送れませんでした」の既定の字の代わりに出す */
  error?: string;
  /** 打つ所の上（引用の頭など） */
  quote?: ReactNode;
  /** 選んでいる @ の候補の番号 */
  activeMention?: number;
  onPickMention?: (i: number) => void;
  /** あれば「状態 ▾」の代わりに置く */
  stageSlot?: ReactNode;
  /** あれば保留の 2 つの欄の代わりに置く */
  holdSlot?: ReactNode;
}

const STAGE_OF: Record<Exclude<StageChoice, "変えない">, StageView> = {
  未着手: STAGES.todo,
  作業中: STAGES.doing,
  "保留…": STAGES.hold,
};

export function StageSelect({
  stage,
  locked,
  open,
  onPick,
  disabledChoices,
  busy,
}: {
  stage: StageChoice;
  locked?: boolean;
  open?: boolean;
  onPick?: (c: StageChoice) => void;
  /** 選べない項目（押せない形） */
  disabledChoices?: readonly StageChoice[];
  /** 送っている間（開く手を止める） */
  busy?: boolean;
}) {
  if (locked)
    return (
      <InertButton size="sm" label="状態 変えない（変えられません）">
        状態 変えない ▾
      </InertButton>
    );
  // 選ぶ物は頭の段の札と同じ色つきの札（代表の直し 2026-11-20）。「変えない」だけは字
  return (
    <Menu defaultOpen={open ?? false}>
      <MenuTrigger className="k-talk-stage-btn" label={`状態 ${stage}`} disabled={busy ?? false}>
        状態 {stage === "変えない" ? <b>変えない</b> : <StageTag stage={STAGE_OF[stage]} />} ▾
      </MenuTrigger>
      <MenuPopup align="start" className="k-talk-menu">
        {STAGE_CHOICES.map((c) => {
          const off = disabledChoices?.includes(c) ?? false;
          return (
            <MenuItem key={c} className="k-talk-stage-item" disabled={off} onSelect={() => onPick?.(c)}>
              {c === "変えない" ? "変えない" : <StageTag stage={STAGE_OF[c]} />}
              {c === stage ? <span aria-label="選んでいる">✓</span> : null}
              {c === "保留…" && !off ? <span className="k-talk-sub">理由を書く</span> : null}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

/** 保留の 2 つの欄（理由・再開の条件） */
export function HoldFields({
  reason,
  resume,
  onReason,
  onResume,
  errors,
}: {
  reason?: string;
  resume?: string;
  onReason?: (s: string) => void;
  onResume?: (s: string) => void;
  errors?: { reason?: string; resume?: string };
}) {
  return (
    <div className="k-talk-hold">
      <TextField
        label="保留の理由"
        name="hold_reason"
        required
        error={errors?.reason}
        {...(onReason
          ? { value: reason ?? "", onChange: (e: ChangeEvent<HTMLInputElement>) => onReason(e.target.value) }
          : { defaultValue: "検収の完了を待つ" })}
      />
      <TextField
        label="再開の条件"
        name="hold_resume"
        required
        error={errors?.resume}
        {...(onResume
          ? { value: resume ?? "", onChange: (e: ChangeEvent<HTMLInputElement>) => onResume(e.target.value) }
          : { defaultValue: "検収の完了の連絡が来たら" })}
      />
    </div>
  );
}

/** 下の書く欄。@ で人を呼ぶ・知らせる人・状態 ▾・担当 ▾ と 📎 は押せない形・書き込む */
export function Composer({
  text = "",
  notify = [],
  stage = "変えない",
  stageLocked,
  stageOpen,
  mentions,
  sending,
  failed,
  value,
  onText,
  textareaRef,
  onKeyDown,
  onRemoveNotify,
  onAddNotify,
  onSend,
  sendDisabled,
  error,
  quote,
  activeMention,
  onPickMention,
  stageSlot,
  holdSlot,
}: ComposerProps) {
  const who = notify.map((n) => (typeof n === "string" ? { id: n, name: n } : n));
  const failText = error ?? (failed ? "送れませんでした。もう一度お試しください（書いた字は残っています）" : null);
  return (
    <div className="k-talk-composer">
      {failText ? <Callout tone="danger">{failText}</Callout> : null}
      {mentions?.length ? <MentionList options={mentions} active={activeMention ?? 0} onPick={onPickMention} /> : null}
      {quote}
      <div className="k-talk-box">
        <TextArea
          label={<span className="sr-only">書き込み</span>}
          name="message_body"
          placeholder="書き込む（@ で人を呼べます）"
          rows={1}
          onKeyDown={onKeyDown}
          {...(textareaRef ? ({ ref: textareaRef } as object) : {})}
          {...(value !== undefined
            ? { value, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => onText?.(e.target.value) }
            : { defaultValue: text })}
        />
        <div className="k-talk-tools">
          {stageSlot ?? (
            <StageSelect
              stage={stage}
              {...(stageLocked ? { locked: true } : {})}
              {...(stageOpen ? { open: true } : {})}
            />
          )}
          <InertButton size="sm" label="担当 変えない（まだ使えません）">
            担当 変えない ▾
          </InertButton>
          <InertButton size="sm" label="ファイルを添える（まだ使えません）">
            <Paperclip size={13} aria-hidden="true" />
          </InertButton>
        </div>
      </div>
      {stage === "保留…" ? (holdSlot ?? <HoldFields />) : holdSlot}
      <div className="k-talk-send">
        <span className="k-talk-sub">知らせる人</span>
        <ul className="k-talk-notify" aria-label="知らせる人">
          {who.map((n) => (
            <li key={n.id} className="k-talk-notify-who">
              <Avatar who={{ name: n.name, initial: n.name.slice(0, 1), tone: "teal" }} small />
              {n.name}
              <button type="button" aria-label={`${n.name} を外す`} onClick={() => onRemoveNotify?.(n.id)}>
                ×
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="k-talk-notify-add" aria-label="知らせる人を足す" onClick={onAddNotify}>
              ＋
            </button>
          </li>
        </ul>
        <Button size="sm" loading={sending ?? false} disabled={sendDisabled ?? false} onClick={onSend}>
          {sending ? "送っています…" : "書き込む"}
        </Button>
      </div>
      <p className="k-talk-sub">状態を変えると、この書き込みと一緒に残る ・ @ で呼ぶ</p>
    </div>
  );
}

/** 狭い幅（パネルが本文の下に回る 1023 以下）で、題名の下に出す「やり取り N ↓」 */
export function TalkJump({ count, onJump }: { count: number; onJump?: () => void }) {
  return (
    <a
      className="k-talk-jump"
      href="#ticket-talk"
      onClick={
        onJump
          ? (e) => {
              e.preventDefault();
              onJump();
            }
          : undefined
      }
    >
      やり取り {count} ↓
    </a>
  );
}

/** 書き込みを消す確かめ（⑪：消すと元に戻せない・「〈名前〉が書き込みを消しました」の 1 行が残る） */
export function DeleteMessageConfirm({
  open,
  name,
  text,
  onOpenChange,
  onConfirm,
  busy,
  error,
  line,
}: {
  open: boolean;
  name: string;
  text: string;
  onOpenChange?: (open: boolean) => void;
  onConfirm?: () => void;
  busy?: boolean;
  /** 小窓の中の知らせ（消せなかった） */
  error?: string;
  /** 残る 1 行の字（マネージャーが人の書き込みを消すとき。無ければ「〈名前〉 が書き込みを消しました」） */
  line?: string;
}) {
  return (
    <Confirm
      open={open}
      onOpenChange={(o) => onOpenChange?.(o)}
      onConfirm={() => onConfirm?.()}
      busy={busy ?? false}
      title="この書き込みを消しますか？"
      description={`消すと元に戻せません。「${line ?? `${name} が書き込みを消しました`}」の 1 行が残ります`}
      confirmLabel="消す"
    >
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <blockquote className="k-talk-quote">{text}</blockquote>
    </Confirm>
  );
}
