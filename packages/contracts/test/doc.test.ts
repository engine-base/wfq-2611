// K-561 の試験（本文 1 枚の文書の木）：形の確かめ・上限・doc → text。DB は使わない。行 ID は K561-DOC-NNN（11_tickets/K-561.md の表と 1 対 1）。
//   テストはチケットを作る人が書き、実装する人は変えない。
//   K-584（文書の木に足す節と印）が 004 の 3 つの値を替えた：前は orderedList・level 4・下線を「知らない」としていたが、K-584 が受ける形になったので、K-561 でも K-584 でも断る値（details・level 5・fontSize）にした。
import { describe, expect, it } from "vitest";
import { DOC_MAX_BYTES, DOC_MAX_DEPTH, docToText, emptyDoc, toTicketBody, validateDoc, type Doc } from "../src/doc.js";

const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const doc = (...content: unknown[]) => ({ type: "doc", content }) as unknown as Doc;
const reason = (v: unknown) => {
  const r = validateDoc(v);
  return r.ok ? null : r.reason;
};

const sample = doc(
  { type: "heading", attrs: { level: 2 }, content: [t("目的")] },
  p(
    t("請求を送る", [{ type: "bold" }, { type: "color", attrs: { color: "red" } }]),
    { type: "hardBreak" },
    t("二行目"),
  ),
  { type: "paragraph", attrs: { ghost: true }, content: [t("薄い説明")] },
  {
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          p(t("明細を集める")),
          { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("済んだ"))] }] },
        ],
      },
    ],
  },
  {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          { type: "tableHeader", content: [p(t("項目"))] },
          { type: "tableCell", content: [p(t("数量"))] },
        ],
      },
    ],
  },
  { type: "blockquote", content: [p(t("引用"))] },
  { type: "codeBlock", content: [t("x=1\ny=2")] },
  { type: "image", attrs: { caption: "図", attachment_id: null } },
);

describe("本文の文書の木（packages/contracts/src/doc.ts）", () => {
  it("K561-DOC-001 doc → text：節ごとに行・箇条書きは「- 」・チェックは「[x] 」・表は「 | 」・引用は「> 」・画像は説明・印は入れない・薄い字は入れない", () => {
    expect(docToText(sample)).toBe(
      "目的\n請求を送る\n二行目\n- 明細を集める\n  [x] 済んだ\n項目 | 数量\n> 引用\nx=1\ny=2\n図",
    );
  });

  it("K561-DOC-002 同じ doc から必ず同じ text／空の doc は空の文字／toTicketBody は doc と docToText を組にする", () => {
    expect(docToText(sample)).toBe(docToText(JSON.parse(JSON.stringify(sample)) as Doc));
    expect(docToText(emptyDoc())).toBe("");
    expect(toTicketBody(sample)).toEqual({ doc: sample, text: docToText(sample) });
  });

  it("K561-DOC-003 形が合えば通り、同じ物をそのまま返す（直さない）／空の doc も通る", () => {
    const r = validateDoc(sample);
    expect(r.ok && r.doc).toBe(sample);
    expect(validateDoc(emptyDoc()).ok).toBe(true);
  });

  it.each([
    ["doc でない", { type: "paragraph", content: [] }, "doc"],
    ["content が無い", { type: "doc" }, "content"],
    ["知らない節", doc({ type: "details", content: [] }), "知らない節"],
    ["知らない鍵", doc({ type: "paragraph", style: "x" }), "知らない鍵"],
    ["見出しの level が 5", doc({ type: "heading", attrs: { level: 5 }, content: [t("x")] }), "heading"],
    ["段落の中に表", doc(p({ type: "table", content: [] })), "置けない"],
    ["空の字", doc(p(t(""))), "text"],
    ["知らない印", doc(p(t("x", [{ type: "fontSize" }]))), "印"],
    ["知らない色", doc(p(t("x", [{ type: "color", attrs: { color: "pink" } }]))), "color"],
    ["javascript: のリンク", doc(p(t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))), "link"],
    ["字の中の NUL", doc(p(t("a\u0000b"))), "NUL"],
  ] as [string, unknown, string][])("K561-DOC-004 形が違う（%s）は止める", (_n, v, word) => {
    expect(reason(v)).toContain(word);
  });

  it("K561-DOC-005 節の数に上限は持たない：段落 6,000 個も、字 3,000 個に印を付けた段落も通る（守りは大きさと深さだけ・節の数は契約に書けないため）", () => {
    const paras = (n: number) => Array.from({ length: n }, () => ({ type: "paragraph" }));
    expect(validateDoc(doc(...paras(6000))).ok).toBe(true);
    expect(validateDoc(doc(p(...Array.from({ length: 3000 }, () => t("a", [{ type: "bold" }]))))).ok).toBe(true);
  });

  it("K561-DOC-006 上限：入れ子は 12 まで／大きさは 1,048,576 バイトまで", () => {
    const nest = (pairs: number): unknown => {
      let inner: unknown = p(t("x"));
      for (let i = 0; i < pairs; i++) inner = { type: "bulletList", content: [{ type: "listItem", content: [inner] }] };
      return inner;
    };
    expect(DOC_MAX_DEPTH).toBe(12);
    expect(validateDoc(doc(nest(2))).ok).toBe(true);
    expect(reason(doc(nest(7)))).toContain("深い");
    expect(DOC_MAX_BYTES).toBe(1_048_576);
    expect(reason(doc(p(t("あ".repeat(400_000)))))).toContain("大きさ");
  });
});
