// @ で人を呼ぶ字の扱い（K-393・純粋な関数）。書く欄と、K-394 の直す欄が使う。
//   候補はそのチケットを見られる人（読む口の meta.people）だけ。自分は出さない（⑮7）。
//   名前は NFKC と大小をそろえて比べる（全角の「＠」・半角カナでも同じに扱う・表記ゆらぎ）
import type { PersonRow } from "./to-items";

const AT = /[@＠]/;
const SPACE = /\s/;
/** 「@〈名前〉」の後ろに来てよい字（部分一致にしない：「@鈴木」が「@鈴木 健」の頭に当たらないように、長い名前から当てる） */
const AFTER = /[\s、。，．！？!?]/;
/** 引用の頭に出す行の数 */
const QUOTE_LINES = 2;

/** 名前の比べ方：全角半角・大小をそろえ、前後の空白を除く */
export const fold = (s: string): string => s.normalize("NFKC").toLowerCase().trim();

/** 書く欄で呼ぶときの名前（呼ばれ方が無ければ正式な名前） */
export const callNameOf = (p: Pick<PersonRow, "call_name" | "display_name">): string => p.call_name ?? p.display_name;

export interface MentionQuery {
  /** 「@」の位置 */
  at: number;
  /** 「@」の後ろから打つ所までの字（空なら全員） */
  q: string;
}

/** 打つ所の左にある最後の「@」か「＠」から打つ所までに空白が無ければ、その間の字を返す。無ければ null */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const left = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  for (let i = left.length - 1; i >= 0; i--) {
    const ch = left[i]!;
    if (SPACE.test(ch)) return null;
    if (AT.test(ch)) return { at: i, q: left.slice(i + 1) };
  }
  return null;
}

/** 自分を除き、呼ばれ方か正式な名前に q を含む人（q が空なら全員）。並びは people の順 */
export function filterPeople(people: readonly PersonRow[], q: string, me: string | null): PersonRow[] {
  const f = fold(q);
  return people.filter(
    (p) => p.member_id !== me && (!f || fold(p.display_name).includes(f) || fold(p.call_name ?? "").includes(f)),
  );
}

export interface Inserted {
  text: string;
  caret: number;
}

/** 「@〈q〉」を「@〈呼ばれ方か正式な名前〉 」に置き換え、新しい字と打つ所を返す */
export function insertMention(text: string, caret: number, who: PersonRow): Inserted {
  const m = mentionQuery(text, caret);
  if (!m) return { text, caret };
  const put = `@${callNameOf(who)} `;
  return { text: text.slice(0, m.at) + put + text.slice(caret), caret: m.at + put.length };
}

/** 選んだ人のうち、字に「@〈名前〉」が残っている人の id（重ねない・選んだ順）。
 *  同じ所に当たる名前は、見られる人（people）全員の名前のうち長い方を取る（「@鈴木 健」を鈴木 一郎の「@鈴木」と数えない） */
export function mentionIds(
  text: string,
  picked: readonly PersonRow[],
  people: readonly PersonRow[] = picked,
): string[] {
  const names = [...people, ...picked]
    .flatMap((p) => [...new Set([callNameOf(p), p.display_name])].map((name) => ({ id: p.member_id, name })))
    .sort((a, b) => b.name.length - a.name.length);
  const hit = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    if (!AT.test(text[i]!)) continue;
    const found = names.find(({ name }) => {
      if (!text.startsWith(name, i + 1)) return false;
      const next = text[i + 1 + name.length];
      return next === undefined || AFTER.test(next);
    });
    if (found) hit.add(found.id);
  }
  return [...new Set(picked.map((p) => p.member_id))].filter((id) => hit.has(id));
}

/** 引用の頭（2 行。3 行目からは「…」を付ける） */
export function excerpt(body: string): string {
  const lines = body.split("\n");
  const head = lines.slice(0, QUOTE_LINES).join("\n");
  return lines.length > QUOTE_LINES ? `${head}…` : head;
}
