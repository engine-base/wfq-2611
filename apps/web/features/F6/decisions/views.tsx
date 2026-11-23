"use client";
// 段 7 の決定ログの見た目の部品：本文の中の区画（一覧・空・読めない）と、決定にする／足す／改める小窓・取り消す確かめ。下絵（K-66 の切る段・/dev/mock/f6）で並べる。
//   口はまだつながない（読む・足す・改める・取り消す口は K-390・K-391、画面の結線は K-397・K-398）。ここは値を受け取って描くだけ。
//   代表の答え（2026-11-20）：⑯ 段 7 は人が書く所まで（AI の案の欄と本文を直す案はグレーで出す）／⑰ 取り消しは印と理由を付けて残す（消さない）／
//   ⑱ 決めた人は既定が本人・ほかの人とひとことを選べる／⑲ 担当者と承認する人に知らせ、やり取りにも 1 行／⑳ 作るときに書いた字は上に残し、下に一覧
//   「どこまで効かせる」の欄は持たない：取引先を持たず（answer=4961f0280e9a）、選び肢が「このチケットだけ」1 つになったため外した（PM の決め 2026-11-23）
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Button, Callout, Confirm, Dialog, Select, TextArea, TextField } from "@/components/k";
import "./decisions.css";

export interface DecisionView {
  id: string;
  text: string;
  /** 「11/01 鈴木 一郎（先方と合意）」 */
  by: string;
  reason?: string;
  /** 元の書き込み（「やり取り 11/01 10:20」） */
  source?: string;
  /** 元の書き込みへの住所（#msg-<id>）。あれば「元：〈字〉 →」をリンクにする */
  sourceHref?: string;
  /** 元の書き込みが消された（「元の書き込みは消されました」・決定の字は残る） */
  sourceGone?: boolean;
  status: "live" | "revised" | "cancelled";
  /** 改められた・取り消した・改めた元の注（「新しい決定：…」「取り消し 10/22 佐藤：…」「10/28 の決定を改めた」） */
  note?: string;
  /** 「改めた」の札（この決定が前の決定を改めた） */
  revises?: boolean;
}

export interface DecisionLogProps {
  /** 作るときに「決定ログ」の欄に書いた字（⑳：上に残す） */
  intro?: string;
  items: readonly DecisionView[];
  canWrite: boolean;
  failed?: boolean;
  /** 区画の名前（既定「決定ログ」） */
  label?: string;
  /** 読んでいる間（一覧も空の文も出さない） */
  loading?: boolean;
  /** 区画の頭の知らせ（書けなくなった・消されたなど） */
  notice?: string;
  /** 「＋ 決定を足す」を押した */
  onAdd?: () => void;
  /** 「もう一度読む」を押した */
  onRetry?: () => void;
  /** 「＋ 決定を足す」の ref（小窓を閉じたら焦点を戻す） */
  addRef?: Ref<HTMLButtonElement>;
}

/** 本文の中の決定ログの区画。見出しの数は生きている決定の数 */
export function DecisionLog({
  intro,
  items,
  canWrite,
  failed,
  label = "決定ログ",
  loading,
  notice,
  onAdd,
  onRetry,
  addRef,
}: DecisionLogProps) {
  const live = items.filter((d) => d.status === "live").length;
  return (
    <section className="k-section" aria-labelledby="sec-decisions">
      <div className="k-dec-head">
        <h2 id="sec-decisions">{live ? `${label}（${live}）` : label}</h2>
        {canWrite && !failed && !loading ? (
          <Button variant="outlined" size="sm" ref={addRef} onClick={onAdd}>
            ＋ 決定を足す
          </Button>
        ) : null}
      </div>
      {notice ? <Callout tone="danger">{notice}</Callout> : null}
      {intro ? <p className="k-dec-intro">作るときに書いた字：{intro}</p> : null}
      {loading ? null : failed ? (
        <Callout tone="danger">
          決定を読み込めませんでした{" "}
          <Button variant="outlined" size="sm" onClick={onRetry}>
            もう一度読む
          </Button>
        </Callout>
      ) : items.length === 0 ? (
        <p className="k-dec-empty">まだ決定はありません。決めたことと理由を残すと、あとから根拠として引けます</p>
      ) : (
        <ol className="k-dec-list">
          {items.map((d) => (
            <li key={d.id} className="k-dec-item" data-status={d.status}>
              <span className="k-dec-text">{d.text}</span>
              {d.status === "revised" ? <span className="k-dec-tag">改められた</span> : null}
              {d.status === "cancelled" ? <span className="k-dec-tag">取り消した</span> : null}
              {d.revises ? <span className="k-dec-tag">改めた</span> : null}
              <div className="k-dec-sub">
                {d.by}
                {d.reason ? ` ・ 理由：${d.reason}` : ""}
                {d.source ? (
                  d.sourceHref ? (
                    <>
                      {" ・ "}
                      <a href={d.sourceHref}>元：{d.source} →</a>
                    </>
                  ) : (
                    ` ・ 元：${d.source} →`
                  )
                ) : d.sourceGone ? (
                  " ・ 元の書き込みは消されました"
                ) : (
                  ""
                )}
                {d.note ? ` ・ ${d.note}` : ""}
              </div>
              {canWrite && d.status === "live" ? (
                <div className="k-dec-acts">
                  <Button variant="ghost" size="sm">
                    改める
                  </Button>
                  <Button variant="ghost" size="sm">
                    取り消す
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export interface PersonOption {
  value: string;
  label: string;
}

export interface DecisionFormValues {
  text: string;
  by: string;
  note: string;
  reason: string;
}

export interface DecisionDialogProps {
  open: boolean;
  /** 書き込みから決定にする（元の書き込みの箱を出す）か、直接書くか */
  from?: { who: string; time: string; text: string };
  text?: string;
  by?: string;
  byNote?: string;
  reason?: string;
  /** 欄の下の断り（text＝決めたこと・by＝決めた人）。書き換えると消える */
  errors?: { text?: string; by?: string };
  /** 決めた人に選べる人（無ければ空） */
  people?: readonly PersonOption[];
  /** 決めた人の候補を読めなかった（欄の下に文を出す） */
  peopleFailed?: string;
  /** 小窓の上の知らせ（書けなかったとき） */
  notice?: string;
  /** 送っている間（ボタンを押せなくする） */
  busy?: boolean;
  onCancel?: () => void;
  onSubmit?: (values: DecisionFormValues) => void;
}

/** 決定にする（書き込みから）／決定を足す（直接書く）小窓。AI の案の欄・本文を直す案はグレー */
export function DecisionDialog({
  open,
  from,
  text = "",
  by = "me",
  byNote = "",
  reason = "",
  errors,
  people = [],
  peopleFailed,
  notice,
  busy,
  onCancel,
  onSubmit,
}: DecisionDialogProps) {
  const title = from ? "決定にする" : "決定を足す";
  const [v, setV] = useState<DecisionFormValues>({ text, by, note: byNote, reason });
  // 断りは書き換えたら消える。同じ断りがもう一度出たら（errors が新しい物なら）また出す
  const [edited, setEdited] = useState({ text: false, by: false });
  useEffect(() => setEdited({ text: false, by: false }), [errors]);
  // 開くたびに最初の値から（書きかけを残さない）
  useEffect(() => {
    if (open) setV({ text, by, note: byNote, reason });
  }, [open, text, by, byNote, reason]);
  const set = (k: keyof DecisionFormValues) => (x: string) => {
    setV((o) => ({ ...o, [k]: x }));
    if (k === "text" || k === "by") setEdited((o) => ({ ...o, [k]: true }));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel?.();
      }}
      title={title}
      {...(from ? { subtitle: "書き込みを決定ログに残す。あとから根拠として引ける" } : {})}
      actions={
        <>
          <Button variant="outlined" onClick={onCancel} disabled={busy}>
            やめる
          </Button>
          <Button onClick={() => onSubmit?.(v)} loading={busy}>
            {title}
          </Button>
        </>
      }
    >
      {notice ? <Callout tone="danger">{notice}</Callout> : null}
      {from ? (
        <blockquote className="k-dec-source">
          <b>{from.who}</b> <span className="k-dec-sub">{from.time}</span>
          <br />
          {from.text}
        </blockquote>
      ) : null}
      <TextArea
        label="決めたこと"
        name="decision_text"
        required
        value={v.text}
        onChange={(e) => set("text")(e.target.value)}
        rows={2}
        error={edited.text ? undefined : errors?.text}
      />
      <div className="k-dec-inert" aria-disabled="true">
        AI が一文にまとめた案 ── AI の案は、自分の AI と話す画面ができてから使えます
      </div>
      <Select
        label="決めた人"
        name="decided_by"
        options={[...people]}
        value={v.by}
        onValueChange={(x) => set("by")(x ?? "")}
        description={peopleFailed}
        error={edited.by ? undefined : errors?.by}
      />
      <TextField
        label="ひとこと"
        name="decided_note"
        value={v.note}
        onChange={(e) => set("note")(e.target.value)}
        placeholder="例：先方と合意"
      />
      <TextField label="理由" name="decision_reason" value={v.reason} onChange={(e) => set("reason")(e.target.value)} />
      {from ? (
        <div className="k-dec-inert" aria-disabled="true">
          本文と食い違う所を AI が見つけて、直す案を出す（まだ使えません）
        </div>
      ) : null}
    </Dialog>
  );
}

export interface ReviseDialogProps {
  open: boolean;
  prev: { by: string; text: string };
  text?: string;
  reason?: string;
  /** 同時にほかの人が改めていた（書いた字は閉じるまで残す） */
  conflict?: boolean;
}

/** 決定を改める小窓（前の決定は消えず「改められた」の印） */
export function ReviseDialog({ open, prev, text = "", reason = "", conflict }: ReviseDialogProps) {
  const foot: ReactNode = conflict ? (
    <Button variant="outlined">閉じて読み直す</Button>
  ) : (
    <>
      <Button variant="outlined">やめる</Button>
      <Button>改める</Button>
    </>
  );
  return (
    <Dialog open={open} title="決定を改める" subtitle="前の決定は消えず、「改められた」の印が付きます" actions={foot}>
      {conflict ? (
        <Callout tone="danger">この決定は、いま別の人が改めました。読み直してから、もう一度お試しください</Callout>
      ) : null}
      <blockquote className="k-dec-source">
        <span className="k-dec-sub">前の決定（{prev.by}）</span>
        <br />
        {prev.text}
      </blockquote>
      <TextArea label="新しい決定" name="decision_text" required defaultValue={text} rows={2} />
      <TextField label="改める理由" name="decision_reason" defaultValue={reason} />
    </Dialog>
  );
}

/** 決定を取り消す確かめ（⑰：取り消した印と理由を残す・消さない） */
export function CancelDecisionConfirm({ open, text, error }: { open: boolean; text: string; error?: string }) {
  return (
    <Confirm
      open={open}
      onOpenChange={() => undefined}
      onConfirm={() => undefined}
      title="この決定を取り消しますか？"
      description="取り消した印と理由が残ります（消えません）"
      confirmLabel="取り消す"
    >
      <blockquote className="k-dec-source">{text}</blockquote>
      <TextArea label="取り消す理由" name="cancel_reason" required rows={2} error={error} />
    </Confirm>
  );
}
