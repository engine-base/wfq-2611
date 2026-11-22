// 本文 1 枚の文書の木（K-561・D-150.35・D-150.48・D-150.50）。
//   チケットの本文は ticket_sections の鍵 body の 1 行で、列 body は { doc, text }。
//   doc＝見たままの文書の木（この型）、text＝機械が読む素の文字（docToText が doc から作る。口が作り、画面からは受けない）。
//   同じ形を使う物：本文を書き終える口（K-432）・作る口（K-437）・画面の本文の部品（K-567・K-568）・DB の守り（app.ticket_body_valid・0 の 20261122090100）。
//   形は ProseMirror の JSON と同じ並び（type・attrs・content・text・marks）。画面の編集の核がそのまま読み書きできる。
//   上限（DOC_MAX_*）は DB の app.ticket_body_valid と同じ数。変えるときは両方を同じ葉で直す。
//   画面に出す入力欄の「/」「#」「@」「注意の枠」は作らない（D-150.48）。画像は置き場だけ（押せない形・D-150.57）。
import { isUuid } from "./index.js";

/** 文書全体の大きさ（JSON の UTF-8 の長さ）の上限 */
export const DOC_MAX_BYTES = 1_048_576;
/** 入れ子の深さの上限（doc の直下の節を 1 とする） */
export const DOC_MAX_DEPTH = 12;
/** text（素の文字）の長さ（UTF-8）の上限 */
export const DOC_TEXT_MAX_BYTES = 1_048_576;
/** リンクの長さの上限 */
export const DOC_HREF_MAX = 2048;
/** 文字の色（下絵 doc.css の data-c と同じ名前） */
export const DOC_COLORS = ["red", "teal", "amber"] as const;
export type DocColor = (typeof DOC_COLORS)[number];
/** 文字の寄せ（K-584） */
export const DOC_ALIGNS = ["left", "center", "right", "justify"] as const;
export type DocAlign = (typeof DOC_ALIGNS)[number];
/** 色の値は style にそのまま入れても安全な形だけ：#rrggbb の小文字 6 桁（m・g の旗を付けない） */
export const DOC_HEX_COLOR = /^#[0-9a-f]{6}$/;
/** 見出しの段（頁の h1 は題名なので 1 は使わない） */
export const DOC_HEADING_LEVELS = [2, 3, 4] as const;
export const DOC_COLSPAN_MAX = 50;
export const DOC_COLWIDTH_MAX = 2000;
export const DOC_START_MAX = 9999;

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  | { type: "superscript" }
  | { type: "subscript" }
  | { type: "highlight"; attrs?: { color: string } }
  | { type: "color"; attrs: { color: DocColor | string } }
  | { type: "link"; attrs: { href: string } };
export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}
export interface HardBreakNode {
  type: "hardBreak";
}
export type Inline = TextNode | HardBreakNode;
/** ghost＝ひな形の薄い字の説明（書き始めると消える）。素の文字には入れない */
export interface ParagraphNode {
  type: "paragraph";
  attrs?: { ghost?: boolean; textAlign?: DocAlign };
  content?: Inline[];
}
export interface HeadingNode {
  type: "heading";
  attrs: { level: 2 | 3 | 4; ghost?: boolean; textAlign?: DocAlign };
  content?: Inline[];
}
export interface ListItemNode {
  type: "listItem";
  content: (ParagraphNode | BulletListNode | OrderedListNode | TaskListNode)[];
}
export interface OrderedListNode {
  type: "orderedList";
  attrs?: { start?: number };
  content: ListItemNode[];
}
export interface HorizontalRuleNode {
  type: "horizontalRule";
}
export interface BulletListNode {
  type: "bulletList";
  content: ListItemNode[];
}
export interface TaskItemNode {
  type: "taskItem";
  attrs: { checked: boolean };
  content: ParagraphNode[];
}
export interface TaskListNode {
  type: "taskList";
  content: TaskItemNode[];
}
export interface TableCellNode {
  type: "tableHeader" | "tableCell";
  attrs?: { colspan?: number; rowspan?: number; colwidth?: number[] };
  content: ParagraphNode[];
}
export interface TableRowNode {
  type: "tableRow";
  content: TableCellNode[];
}
export interface TableNode {
  type: "table";
  content: TableRowNode[];
}
export interface BlockquoteNode {
  type: "blockquote";
  content: ParagraphNode[];
}
export interface CodeBlockNode {
  type: "codeBlock";
  content?: { type: "text"; text: string }[];
}
/** 画像の置き場。attachment_id は添付の段で入る（今は null）。caption は図の説明 */
export interface ImageNode {
  type: "image";
  attrs: { caption: string; attachment_id: string | null };
}
export type Block =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | HorizontalRuleNode
  | TaskListNode
  | TableNode
  | BlockquoteNode
  | CodeBlockNode
  | ImageNode;
export interface Doc {
  type: "doc";
  content: Block[];
}
/** ticket_sections.body（鍵 body）の中身 */
export interface TicketBody {
  doc: Doc;
  text: string;
}

export const emptyDoc = (): Doc => ({ type: "doc", content: [] });

// ---------------------------------------------------------------- 形の確かめ（口の入口・画面の保存の前）
type Children = readonly string[] | "inline" | "text" | "none";
const BLOCKS = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "horizontalRule",
  "taskList",
  "table",
  "blockquote",
  "codeBlock",
  "image",
] as const;
const CHILDREN: Record<string, Children> = {
  doc: BLOCKS,
  paragraph: "inline",
  heading: "inline",
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  horizontalRule: "none",
  listItem: ["paragraph", "bulletList", "orderedList", "taskList"],
  taskList: ["taskItem"],
  taskItem: ["paragraph"],
  table: ["tableRow"],
  tableRow: ["tableHeader", "tableCell"],
  tableHeader: ["paragraph"],
  tableCell: ["paragraph"],
  blockquote: ["paragraph"],
  codeBlock: "text",
  image: "none",
};
const NODE_KEYS = new Set(["type", "attrs", "content", "text", "marks"]);
const MARK_TYPES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "superscript",
  "subscript",
  "highlight",
  "color",
  "link",
]);
const LINK_OK = /^(https?:\/\/|mailto:)/;
const NUL = "\u0000";

export type DocCheck = { ok: true; doc: Doc } | { ok: false; reason: string };
const bad = (reason: string): DocCheck => ({ ok: false, reason });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 文書の木を確かめる。形・入れ子・上限（大きさ・深さ。節の数は持たない）・NUL・リンクの形。通ったら同じ物を doc として返す（直さない） */
export function validateDoc(input: unknown): DocCheck {
  if (!isObj(input) || input["type"] !== "doc") return bad("doc の type が doc でない");
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return bad("JSON にできない");
  }
  if (bytes > DOC_MAX_BYTES) return bad(`大きさが ${DOC_MAX_BYTES} バイトを超えている`);
  const err = checkNode(input, 0);
  if (err) return bad(err);
  return { ok: true, doc: input as unknown as Doc };
}

function checkNode(n: Record<string, unknown>, depth: number): string | null {
  const type = n["type"];
  if (typeof type !== "string" || !(type in CHILDREN)) return `知らない節: ${String(type)}`;
  if (depth > DOC_MAX_DEPTH) return `入れ子が ${DOC_MAX_DEPTH} より深い`;
  for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) return `${type} に知らない鍵: ${k}`;
  const attrErr = checkAttrs(type, n["attrs"]);
  if (attrErr) return attrErr;
  const kids = CHILDREN[type]!;
  const content = n["content"];
  if (kids === "none") return content === undefined ? null : `${type} は中身を持たない`;
  if (content === undefined) return Array.isArray(kids) ? `${type} に content が無い` : null;
  if (!Array.isArray(content)) return `${type} の content が配列でない`;
  for (const c of content as unknown[]) {
    if (!isObj(c)) return `${type} の中に節でない物がある`;
    const ct = c["type"];
    if (kids === "inline") {
      if (ct !== "text" && ct !== "hardBreak") return `${type} の中に ${String(ct)} は置けない`;
      const e = checkInline(c);
      if (e) return e;
    } else if (kids === "text") {
      if (ct !== "text" || c["marks"] !== undefined) return `${type} の中は印の無い字だけ`;
      const e = checkInline(c);
      if (e) return e;
    } else {
      if (typeof ct !== "string" || !(ct in CHILDREN)) return `知らない節: ${String(ct)}`;
      if (!kids.includes(ct)) return `${type} の中に ${ct} は置けない`;
      const e = checkNode(c, depth + 1);
      if (e) return e;
    }
  }
  return null;
}

const isInt = (v: unknown, max: number): boolean => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
const ghostOk = (a: Record<string, unknown>): boolean => a["ghost"] === undefined || typeof a["ghost"] === "boolean";
const alignOk = (a: Record<string, unknown>): boolean =>
  a["textAlign"] === undefined || (DOC_ALIGNS as readonly unknown[]).includes(a["textAlign"]);
function cellAttrsOk(a: Record<string, unknown>, keys: string[]): boolean {
  if (!keys.every((k) => k === "colspan" || k === "rowspan" || k === "colwidth")) return false;
  const { colspan, rowspan, colwidth } = a;
  if (colspan !== undefined && !isInt(colspan, DOC_COLSPAN_MAX)) return false;
  if (rowspan !== undefined && !isInt(rowspan, DOC_COLSPAN_MAX)) return false;
  if (colwidth === undefined) return true;
  const span = colspan === undefined ? 1 : (colspan as number);
  return Array.isArray(colwidth) && colwidth.length === span && colwidth.every((w) => isInt(w, DOC_COLWIDTH_MAX));
}

function checkAttrs(type: string, attrs: unknown): string | null {
  if (attrs === undefined)
    return type === "heading" || type === "taskItem" || type === "image" ? `${type} に attrs が無い` : null;
  if (!isObj(attrs)) return `${type} の attrs が形違い`;
  const keys = Object.keys(attrs);
  const only = (allowed: string[]) => keys.every((k) => allowed.includes(k));
  switch (type) {
    case "paragraph":
      return only(["ghost", "textAlign"]) && ghostOk(attrs) && alignOk(attrs) ? null : "paragraph の attrs が形違い";
    case "heading":
      return only(["level", "ghost", "textAlign"]) &&
        (DOC_HEADING_LEVELS as readonly unknown[]).includes(attrs["level"]) &&
        ghostOk(attrs) &&
        alignOk(attrs)
        ? null
        : "heading の attrs（level は 2・3・4）が形違い";
    case "orderedList":
      return only(["start"]) && (attrs["start"] === undefined || isInt(attrs["start"], DOC_START_MAX))
        ? null
        : `orderedList の attrs（start は 1〜${DOC_START_MAX}）が形違い`;
    case "tableCell":
    case "tableHeader":
      return cellAttrsOk(attrs, keys) ? null : `${type} の attrs（colspan・rowspan・colwidth）が形違い`;
    case "taskItem":
      return only(["checked"]) && typeof attrs["checked"] === "boolean" ? null : "taskItem の attrs（checked）が形違い";
    case "image": {
      const cap = attrs["caption"];
      const id = attrs["attachment_id"];
      const idOk = id === null || (typeof id === "string" && isUuid(id)); // 入口と同じ確かめ（index.ts の isUuid）
      return only(["caption", "attachment_id"]) &&
        typeof cap === "string" &&
        !cap.includes(NUL) &&
        cap.length <= 500 &&
        idOk
        ? null
        : "image の attrs が形違い";
    }
    default:
      return keys.length === 0 ? null : `${type} に attrs は付けられない`;
  }
}

function checkInline(n: Record<string, unknown>): string | null {
  for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) return `${String(n["type"])} に知らない鍵: ${k}`;
  if (n["type"] === "hardBreak")
    return n["text"] === undefined && n["marks"] === undefined && n["content"] === undefined && n["attrs"] === undefined
      ? null
      : "hardBreak に中身は付けられない";
  const t = n["text"];
  if (typeof t !== "string" || t.length === 0) return "text の字が空か文字でない";
  if (t.includes(NUL)) return "NUL の字は入れられない";
  if (n["content"] !== undefined || n["attrs"] !== undefined) return "text に content・attrs は付けられない";
  const marks = n["marks"];
  if (marks === undefined) return null;
  if (!Array.isArray(marks)) return "marks が配列でない";
  for (const m of marks as unknown[]) {
    if (!isObj(m) || typeof m["type"] !== "string" || !MARK_TYPES.has(m["type"])) return "知らない印";
    const a = m["attrs"];
    if (m["type"] === "color") {
      const c = isObj(a) ? a["color"] : undefined;
      const colorOk = typeof c === "string" && ((DOC_COLORS as readonly string[]).includes(c) || DOC_HEX_COLOR.test(c));
      if (!isObj(a) || Object.keys(a).length !== 1 || !colorOk) return "color の色が形違い（名前 3 つか #rrggbb）";
    } else if (m["type"] === "highlight") {
      if (a !== undefined) {
        const c = isObj(a) ? a["color"] : undefined;
        if (!isObj(a) || Object.keys(a).length !== 1 || typeof c !== "string" || !DOC_HEX_COLOR.test(c))
          return "highlight の attrs（color は #rrggbb）が形違い";
      }
    } else if (m["type"] === "link") {
      const h = isObj(a) ? a["href"] : undefined;
      if (typeof h !== "string" || h.length > DOC_HREF_MAX || !LINK_OK.test(h) || h.includes(NUL))
        return "link の href が形違い（http・https・mailto だけ）";
    } else if (a !== undefined) return `${m["type"]} に attrs は付けられない`;
  }
  return null;
}

// ---------------------------------------------------------------- doc → text（素の文字）
const inlineText = (c?: readonly Inline[]): string =>
  (c ?? []).map((n) => (n.type === "text" ? n.text : "\n")).join("");
const marker = (m: string, lines: string[]): string[] => lines.map((l, i) => (i === 0 ? m : " ".repeat(m.length)) + l);

function blockLines(b: Block | ListItemNode["content"][number]): string[] {
  switch (b.type) {
    case "paragraph":
    case "heading":
      return b.attrs?.ghost ? [] : inlineText(b.content).split("\n");
    case "horizontalRule":
      return [];
    case "orderedList":
    case "bulletList":
      return b.content.flatMap((li) => marker("- ", li.content.flatMap(blockLines)));
    case "taskList":
      return b.content.flatMap((it) => marker(it.attrs.checked ? "[x] " : "[ ] ", it.content.flatMap(blockLines)));
    case "table":
      return b.content.map((row) => row.content.map((cell) => cell.content.flatMap(blockLines).join(" ")).join(" | "));
    case "blockquote":
      return b.content.flatMap(blockLines).map((l) => `> ${l}`);
    case "codeBlock":
      return (b.content ?? [])
        .map((t) => t.text)
        .join("")
        .split("\n");
    case "image":
      return [b.attrs.caption];
  }
}

/**
 * 機械が読む素の文字を doc から作る。薄い字の説明（ghost）は入れない。
 * 規則：節ごとに行を作る／箇条書きは「- 」・チェックは「[x] 」「[ ] 」・入れ子は 2〜4 字ぶん下げる／表は行ごとに " | " でつなぐ／引用は「> 」／
 * 画像は説明の字／印・色・リンク先は入れない／行の終わりの空白と空行は落とす。同じ doc から必ず同じ text（口が作り、画面からは受けない）。
 */
export function docToText(doc: Doc): string {
  return doc.content
    .flatMap(blockLines)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l !== "")
    .join("\n");
}

/** 口が DB に渡す本文（text は doc から作る） */
export const toTicketBody = (doc: Doc): TicketBody => ({ doc, text: docToText(doc) });
