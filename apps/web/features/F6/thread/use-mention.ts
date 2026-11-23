"use client";
// @ の候補の器（K-393。K-394 の直す欄も使う）。打つ所の字と位置から候補と選んでいる位置を持ち、
//   ↑↓ で移り、Enter（かな漢字の変換中は除く）か押して選ぶと「@〈名前〉 」を入れる。Esc で閉じる（字を打ち直すとまた開く）。選んだ人を持つ
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { filterPeople, insertMention, mentionIds, mentionQuery, type Inserted } from "./mention";
import type { PersonRow } from "./to-items";

export interface MentionState {
  /** 出している候補（閉じていれば空） */
  options: PersonRow[];
  active: number;
  /** 打った字と打つ所を知らせる */
  onInput: (text: string, caret: number) => void;
  /** 候補が開いている間のキー。扱ったら true（打つ欄の既定の動きを止める） */
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => Inserted | "handled" | null;
  /** 押して選ぶ。新しい字と打つ所を返す */
  pick: (i: number) => Inserted | null;
  /** 字に残っている選んだ人の id */
  idsIn: (text: string) => string[];
  /** 選んだ人を忘れる（書けた後） */
  reset: () => void;
}

export function useMention(people: readonly PersonRow[], me: string | null): MentionState {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  /** Esc で閉じたときの字（字が変わるまで開かない） */
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<PersonRow[]>([]);

  const query = mentionQuery(text, caret);
  const options = useMemo(
    () => (query && closedFor !== text ? filterPeople(people, query.q, me) : []),
    [query, closedFor, text, people, me],
  );
  const at = Math.min(active, Math.max(0, options.length - 1));

  const onInput = useCallback((t: string, c: number) => {
    setText(t);
    setCaret(c);
    setActive(0);
  }, []);

  const pick = (i: number): Inserted | null => {
    const who = options[i];
    if (!who) return null;
    const next = insertMention(text, caret, who);
    setPicked((p) => (p.some((x) => x.member_id === who.member_id) ? p : [...p, who]));
    setText(next.text);
    setCaret(next.caret);
    setActive(0);
    return next;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): Inserted | "handled" | null => {
    if (!options.length) return null;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return null;
    if (e.key === "ArrowDown") {
      setActive((at + 1) % options.length);
      return "handled";
    }
    if (e.key === "ArrowUp") {
      setActive((at - 1 + options.length) % options.length);
      return "handled";
    }
    if (e.key === "Escape") {
      setClosedFor(text);
      return "handled";
    }
    if (e.key === "Enter" && !e.shiftKey) return pick(at) ?? "handled";
    return null;
  };

  return {
    options,
    active: at,
    onInput,
    onKey,
    pick,
    idsIn: (t) => mentionIds(t, picked, people),
    reset: () => {
      setPicked([]);
      setClosedFor(null);
      setActive(0);
    },
  };
}
