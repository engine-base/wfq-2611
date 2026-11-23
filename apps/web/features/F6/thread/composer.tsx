"use client";
// 書く欄の入れ物（K-392 が受ける物を広げ、中身は K-393 が作る）。口は呼ばない（書く器 use-post.ts の値と関数を部品 views.tsx の Composer に渡す）。
//   読める人は書ける（⑧）・完了したチケットにも書ける（⑭）。@ の候補と知らせる人の候補はそのチケットを見られる人だけで、自分は出さない（⑨・⑮7）。
//   知らせる人は最初は担当者と承認する人（外せる・＋ で小窓 NotifyPicker）。引用は頭の 2 行（⑮3）。書きかけは送るまで端末に残す（⑮5）。
//   状態 ▾ は composer-stage.tsx（K-396 まで押せない形）。担当 ▾ と 📎 は部品のまま押せない形（⑮6）
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/k";
import type { SlotTicket } from "@/features/F4/create-ticket/detail-slots";
import { useComposerStage } from "./composer-stage";
import { clearDraft, readDraft, writeDraft } from "./draft";
import { callNameOf } from "./mention";
import { NotifyDialog } from "./notify-dialog";
import type { PersonRow, QuoteRef, TimelineItem } from "./to-items";
import { useMention } from "./use-mention";
import { useMeId, usePost, useQuoteText } from "./use-post";
import { Composer } from "./views";

export interface TalkComposerProps {
  ticket: SlotTicket;
  /** そのチケットを見られる人（@ の候補・知らせる人の既定と候補） */
  people: PersonRow[];
  /** 引用している書き込み（無ければ null） */
  quote: QuoteRef | null;
  onClearQuote: () => void;
  /** 書けたとき、答えの 1 行を一覧に足す */
  onPosted: (item: TimelineItem) => void;
}

/** 足した行が描かれるまで待って、見える所まで動かす（何フレームか待つ） */
const FRAMES_TO_SCROLL = 5;
function scrollToPost(id: string, left = FRAMES_TO_SCROLL): void {
  const el = document.getElementById(`msg-${id}`);
  if (el) el.scrollIntoView({ block: "nearest" });
  else if (left > 0) requestAnimationFrame(() => scrollToPost(id, left - 1));
}

export function TalkComposer({ ticket, people, quote, onClearQuote, onPosted }: TalkComposerProps): ReactNode {
  const meId = useMeId();
  const stage = useComposerStage(ticket);
  const post = usePost(ticket.id, stage);
  const mention = useMention(people, meId);
  const quoteText = useQuoteText(ticket.id, quote);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const caretAfter = useRef<number | null>(null);
  const [text, setText] = useState("");
  /** 選び直した知らせる人（null なら最初の形＝担当者と承認する人） */
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [picking, setPicking] = useState(false);

  // 書きかけを戻す（端末の中の字は、描き終わってから読む）
  useEffect(() => {
    const draft = readDraft(ticket.id);
    if (draft) setText(draft);
  }, [ticket.id]);

  // 引用を付けたら打つ所に焦点
  useEffect(() => {
    if (quote) boxRef.current?.focus();
  }, [quote]);

  // @ の候補を入れた後の打つ所
  useEffect(() => {
    if (caretAfter.current === null) return;
    boxRef.current?.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [text]);

  const visible = useMemo(() => new Map(people.map((p) => [p.member_id, p])), [people]);
  const others = useMemo(() => people.filter((p) => p.member_id !== meId), [people, meId]);
  // 見られなくなった人は札から外す（読み直した meta.people に居ない人）
  const notifyIds = useMemo(
    () =>
      (chosen ?? others.filter((p) => p.is_assignee || p.is_approver).map((p) => p.member_id)).filter(
        (id) => visible.has(id) && id !== meId,
      ),
    [chosen, others, visible, meId],
  );

  const put = (next: string, caret: number) => {
    setText(next);
    writeDraft(ticket.id, next);
    mention.onInput(next, caret);
  };
  const onText = (s: string) => put(s, boxRef.current?.selectionStart ?? s.length);
  const apply = (r: { text: string; caret: number } | null) => {
    if (!r) return;
    caretAfter.current = r.caret;
    setText(r.text);
    writeDraft(ticket.id, r.text);
  };

  const empty = text.trim() === "";
  const send = async () => {
    if (empty || post.sending) return;
    const r = await post.send({
      body: text,
      mentionIds: mention.idsIn(text),
      notifyIds,
      quoteId: quote?.id ?? null,
    });
    if (!r.ok) return;
    onPosted(r.item);
    setText("");
    clearDraft(ticket.id);
    mention.onInput("", 0);
    mention.reset();
    setChosen(null);
    onClearQuote();
    requestAnimationFrame(() => scrollToPost(r.item.id));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const r = mention.onKey(e);
    if (r === null) return;
    e.preventDefault();
    if (r !== "handled") apply(r);
  };

  return (
    <>
      <Composer
        value={text}
        onText={onText}
        textareaRef={boxRef}
        onKeyDown={onKeyDown}
        notify={notifyIds.map((id) => ({ id, name: callNameOf(visible.get(id)!) }))}
        onRemoveNotify={(id) => setChosen(notifyIds.filter((x) => x !== id))}
        onAddNotify={() => setPicking(true)}
        mentions={mention.options.map((p) => ({ name: p.display_name, sub: p.label }))}
        activeMention={mention.active}
        onPickMention={(i) => apply(mention.pick(i))}
        onSend={() => void send()}
        sending={post.sending}
        sendDisabled={empty || post.sending}
        failed={post.failed}
        {...(post.error ? { error: post.error } : {})}
        quote={
          quoteText !== null ? (
            <div>
              <blockquote className="k-talk-quote">{quoteText}</blockquote>
              <Button variant="ghost" size="sm" onClick={onClearQuote}>
                引用を外す
              </Button>
            </div>
          ) : null
        }
        stageSlot={stage.slot}
        holdSlot={stage.holdSlot}
      />
      <NotifyDialog
        open={picking}
        onOpenChange={setPicking}
        people={others.map((p) => ({ id: p.member_id, display_name: p.display_name }))}
        chosen={notifyIds}
        onChange={setChosen}
      />
    </>
  );
}
