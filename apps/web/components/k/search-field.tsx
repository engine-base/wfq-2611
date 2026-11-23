// 探す欄の型（段 9・代表の直し 2026-11-20）。虫眼鏡と入力を 1 つの枠に入れ、焦点が中に入ったら枠全体に輪を出す（:focus-within）。
//   入力だけに輪が付く形（全体の :focus-visible）を中の入力では消し、枠の輪 1 つにする。見た目は search-field.css
//   使う側は入力の値・変える時の処理・読み上げの名前（label）を渡す。外枠の上の帯の探す欄（shell の .k-search）は別の形（丸い・帯の幅）
import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import "./search-field.css";

/** 虫眼鏡の大きさ（外枠の帯の探す欄と同じ） */
const ICON_SIZE = 14;

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label"> & {
  /** 読み上げの名前（目に見える字は placeholder で出す） */
  label: string;
};

export function SearchField({ label, className, placeholder, ...rest }: SearchFieldProps) {
  return (
    <label className={className ? `k-search-field ${className}` : "k-search-field"}>
      <Search size={ICON_SIZE} aria-hidden="true" />
      <input
        className="k-search-field-input"
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        {...rest}
      />
    </label>
  );
}
