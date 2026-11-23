"use client";
// 作ったことを知らせる人（K-224・キャンバス Create・D-128.138）。名前で絞り込む欄と、候補のチェック。
//   欄が空のあいだは全員をチェックで出し、打った字に合う人だけに絞る。選んだ人は札（「〈名前〉 を外す」つき）で上に残す（絞っても消えない）
//   作る口に送るのは今のまま notify_member_ids（選んだ人の id）
//   label・placeholder：絞る欄の見出しと案内の字（K-393 のやり取りの小窓が渡す。無ければ作る画面の今の字）
import { useState } from "react";
import { TextField } from "@/components/k";

export interface Person {
  id: string;
  display_name: string;
}

/** 名前の比べ方：全角半角・大小をそろえ、前後の空白を除く（表記ゆらぎ） */
const fold = (s: string): string => s.normalize("NFKC").toLowerCase().trim();

const LABEL = "作ったことを知らせる人";
const PLACEHOLDER = "名前で絞り込む（担当者と承認する人には自動で届く）";

export function NotifyPicker({
  people,
  chosen,
  onChange,
  label = LABEL,
  placeholder = PLACEHOLDER,
}: {
  people: Person[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  /** 絞る欄の見出し（無ければ「作ったことを知らせる人」） */
  label?: string;
  /** 絞る欄の案内（無ければ「名前で絞り込む（担当者と承認する人には自動で届く）」） */
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const q = fold(query);
  const shown = q ? people.filter((p) => fold(p.display_name).includes(q)) : people;
  const picked = new Set(chosen);
  const set = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    onChange(people.filter((p) => next.has(p.id)).map((p) => p.id));
  };
  return (
    <div className="k-field">
      <TextField
        label={label}
        name="notify_filter"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // 絞り込む欄の Enter で作る面を送らない（名前を打って Enter でチケットができてしまう）
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      {picked.size ? (
        <ul className="k-create-chips" aria-label="知らせる人">
          {people
            .filter((p) => picked.has(p.id))
            .map((p) => (
              <li key={p.id} className="k-create-chip">
                {p.display_name}
                <button type="button" aria-label={`${p.display_name} を外す`} onClick={() => set(p.id, false)}>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
        </ul>
      ) : null}
      <div className="k-create-people" role="group" aria-label="知らせる人の候補">
        {shown.map((p) => (
          <label key={p.id} className="k-create-check">
            <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => set(p.id, e.target.checked)} />
            {p.display_name}
          </label>
        ))}
        {q && shown.length === 0 ? <span className="k-desc">合う人がいません</span> : null}
      </div>
    </div>
  );
}
