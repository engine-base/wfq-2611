// K-584 の試験（文書の木に足す節と印）：validateDoc・docToText を、番号つきの並び・区切りの線・見出しの段 4・文字の寄せ・
//   表のセルの結合・下線・取り消し線・行の中のコード・上付き・下付き・#rrggbb の色と背景に広げた形。DB は使わない。
//   行 ID は K584-DOC-NNN（11_tickets/K-584.md の表と 1 対 1）。K-561 で通る文書が全部そのまま通ること（013）を守る。
//   テストはチケットを作る人が書き、実装する人は変えない。
import { describe, expect, it } from "vitest";
import {
  DOC_ALIGNS,
  DOC_COLORS,
  DOC_COLSPAN_MAX,
  DOC_COLWIDTH_MAX,
  DOC_HEADING_LEVELS,
  DOC_HEX_COLOR,
  DOC_MAX_BYTES,
  DOC_MAX_DEPTH,
  DOC_START_MAX,
  docToText,
  validateDoc,
  type Doc,
} from "../src/doc.js";
import * as api from "../src/index.js";

const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const pt = (text: string) => p(t(text));
const doc = (...content: unknown[]) => ({ type: "doc", content }) as unknown as Doc;
const li = (...c: unknown[]) => ({ type: "listItem", content: c });
const cell = (attrs: unknown, text = "x", type = "tableCell") => ({
  type,
  ...(attrs === undefined ? {} : { attrs }),
  content: [pt(text)],
});
const table = (...rows: unknown[][]) => ({
  type: "table",
  content: rows.map((r) => ({ type: "tableRow", content: r })),
});
const reason = (v: unknown) => {
  const r = validateDoc(v);
  return r.ok ? null : r.reason;
};
const ok = (v: unknown) => validateDoc(v).ok;
const withMark = (mark: unknown) => doc(p(t("x", [mark])));
/** 同じ形の組を n 組入れ子にした木（底は段落） */
const nest = (type: "bulletList" | "orderedList", pairs: number): unknown => {
  let inner: unknown = pt("x");
  for (let i = 0; i < pairs; i++) inner = { type, content: [li(inner)] };
  return inner;
};

describe("文書の木に足す節と印（packages/contracts/src/doc.ts・K-584）", () => {
  it("K584-DOC-001 番号つきの並び：start なし・1・3・9999 と、中に箇条書き・番号つき・チェックの並びを入れた物が通り、同じ物を返す", () => {
    const task = { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [pt("済")] }] };
    const cases = [
      doc({ type: "orderedList", content: [li(pt("一"))] }),
      doc({ type: "orderedList", attrs: { start: 1 }, content: [li(pt("一"))] }),
      doc({ type: "orderedList", attrs: { start: 3 }, content: [li(pt("三"))] }),
      doc({ type: "orderedList", attrs: { start: 9999 }, content: [li(pt("末"))] }),
      doc({
        type: "orderedList",
        content: [li(pt("親"), nest("bulletList", 1), nest("orderedList", 1), task), li(pt("次"))],
      }),
    ];
    for (const d of cases) {
      const r = validateDoc(d);
      expect(r.ok && r.doc, JSON.stringify(d)).toBe(d);
    }
  });

  it.each([
    ["start 0", { start: 0 }],
    ["start 10000", { start: 10000 }],
    ["start 負", { start: -1 }],
    ["start 小数", { start: 2.5 }],
    ["start 文字", { start: "3" }],
    ["start null", { start: null }],
    ["知らない鍵 type", { start: 1, type: "a" }],
  ] as [string, unknown][])("K584-DOC-002 番号つきの並びの断り（%s）", (_n, attrs) => {
    expect(reason(doc({ type: "orderedList", attrs, content: [li(pt("x"))] }))).toContain("orderedList");
  });

  it("K584-DOC-002 番号つきの並びの断り（中身の形）：listItem 以外・content が無い・start の上限の定数", () => {
    expect(reason(doc({ type: "orderedList", content: [pt("x")] }))).toContain("orderedList");
    expect(reason(doc({ type: "orderedList" }))).toContain("orderedList");
    expect(DOC_START_MAX).toBe(9999);
  });

  it("K584-DOC-003 区切りの線：doc の直下に置け、中身も attrs も付けられず、段落・並び・引用・表のセルの中には置けない", () => {
    expect(ok(doc(pt("上"), { type: "horizontalRule" }, pt("下")))).toBe(true);
    expect(reason(doc({ type: "horizontalRule", content: [] }))).toContain("horizontalRule");
    expect(reason(doc({ type: "horizontalRule", attrs: { width: 1 } }))).toContain("horizontalRule");
    const hr = { type: "horizontalRule" };
    for (const [name, d] of [
      ["段落の中", doc(p(hr))],
      ["listItem の中", doc({ type: "bulletList", content: [li(hr)] })],
      ["引用の中", doc({ type: "blockquote", content: [hr] })],
      ["表のセルの中", doc(table([{ type: "tableCell", content: [hr] }]))],
    ] as [string, Doc][])
      expect(reason(d), name).toContain("置けない");
  });

  it("K584-DOC-004 見出しの段：level 2・3・4 が通り、1・5・0・小数・文字・null・attrs の無い物は heading として断る", () => {
    expect([...DOC_HEADING_LEVELS]).toEqual([2, 3, 4]);
    for (const level of [2, 3, 4])
      expect(ok(doc({ type: "heading", attrs: { level }, content: [t("x")] })), `${level}`).toBe(true);
    for (const level of [1, 5, 0, 2.5, "2", null])
      expect(reason(doc({ type: "heading", attrs: { level }, content: [t("x")] })), `${String(level)}`).toContain(
        "heading",
      );
    expect(reason(doc({ type: "heading", content: [t("x")] }))).toContain("heading");
  });

  it("K584-DOC-005 文字の寄せ：段落と見出しに left・center・right・justify が付き（ghost と一緒でも）、知らない値・文字以外・ほかの節への付与は断る", () => {
    expect([...DOC_ALIGNS]).toEqual(["left", "center", "right", "justify"]);
    for (const a of ["left", "center", "right", "justify"]) {
      expect(ok(doc({ type: "paragraph", attrs: { textAlign: a }, content: [t("x")] })), a).toBe(true);
      expect(ok(doc({ type: "heading", attrs: { level: 3, textAlign: a }, content: [t("x")] })), a).toBe(true);
    }
    expect(ok(doc({ type: "paragraph", attrs: { ghost: true, textAlign: "right" }, content: [t("薄い")] }))).toBe(true);
    for (const a of ["start", "end", "Center", "", "centre", null, 1, ["left"]])
      expect(
        reason(doc({ type: "paragraph", attrs: { textAlign: a }, content: [t("x")] })),
        JSON.stringify(a),
      ).toContain("paragraph");
    for (const [name, d] of [
      [
        "listItem",
        doc({
          type: "bulletList",
          content: [{ type: "listItem", attrs: { textAlign: "center" }, content: [pt("x")] }],
        }),
      ],
      ["表のセル", doc(table([cell({ textAlign: "center" })]))],
      ["引用", doc({ type: "blockquote", attrs: { textAlign: "center" }, content: [pt("x")] })],
      ["コード", doc({ type: "codeBlock", attrs: { textAlign: "center" }, content: [t("x")] })],
    ] as [string, Doc][])
      expect(reason(d), name).toContain("attrs");
  });

  it("K584-DOC-006 表のセルの結合：colspan・rowspan は 1〜50・colwidth は 1〜2000 の整数の並び（長さは colspan）。見出しのセルは行・列・セルのどこにも置ける", () => {
    expect(DOC_COLSPAN_MAX).toBe(50);
    expect(DOC_COLWIDTH_MAX).toBe(2000);
    const wide = Array.from({ length: 50 }, () => 2000);
    const cases: [string, unknown][] = [
      [
        "colspan 2 と colwidth",
        table([
          cell({ colspan: 2, colwidth: [120, 80] }, "項目", "tableHeader"),
          cell(undefined, "金額", "tableHeader"),
        ]),
      ],
      ["上限の colspan・rowspan・colwidth", table([cell({ colspan: 50, rowspan: 50, colwidth: wide })])],
      ["1 を書いた", table([cell({ colspan: 1, rowspan: 1 })])],
      ["colwidth だけ（colspan は 1）", table([cell({ colwidth: [100] })])],
      [
        "見出しのセルが行・列・セルのどこにも",
        table(
          [cell(undefined, "a"), cell(undefined, "b")],
          [cell(undefined, "c", "tableHeader"), cell(undefined, "d")],
          [cell(undefined, "e"), cell(undefined, "f", "tableHeader")],
        ),
      ],
    ];
    for (const [name, tb] of cases) {
      const d = doc(tb);
      const r = validateDoc(d);
      expect(r.ok && r.doc, name).toBe(d);
    }
  });

  it.each([
    ["colspan 0", { colspan: 0 }],
    ["colspan 51", { colspan: 51 }],
    ["colspan 小数", { colspan: 1.5 }],
    ["colspan 文字", { colspan: "2" }],
    ["colspan null", { colspan: null }],
    ["rowspan 0", { rowspan: 0 }],
    ["rowspan 51", { rowspan: 51 }],
    ["colwidth の長さが colspan より短い", { colspan: 2, colwidth: [100] }],
    ["colwidth の長さが colspan（既定 1）より長い", { colwidth: [100, 100] }],
    ["colwidth 0", { colwidth: [0] }],
    ["colwidth 2001", { colwidth: [2001] }],
    ["colwidth 小数", { colwidth: [1.5] }],
    ["colwidth 文字", { colwidth: ["100"] }],
    ["colwidth null", { colwidth: null }],
    ["colwidth 空", { colwidth: [] }],
    ["colwidth 並びでない", { colwidth: "120" }],
    ["知らない鍵 align", { align: "left" }],
  ] as [string, unknown][])("K584-DOC-007 表のセルの断り（%s）", (_n, attrs) => {
    expect(reason(doc(table([cell(attrs)])))).toContain("attrs");
    expect(reason(doc(table([cell(attrs, "x", "tableHeader")])))).toContain("attrs");
  });

  it("K584-DOC-008 印 5 つ（下線・取り消し線・行の中のコード・上付き・下付き）：1 つずつも全部重ねても通り、attrs を付けると断る", () => {
    const five = ["underline", "strike", "code", "superscript", "subscript"];
    for (const m of five) expect(ok(withMark({ type: m })), m).toBe(true);
    expect(ok(doc(p(t("x", [...five.map((type) => ({ type })), { type: "bold" }, { type: "italic" }]))))).toBe(true);
    for (const m of five) expect(reason(withMark({ type: m, attrs: { x: 1 } })), m).toContain("attrs");
  });

  it("K584-DOC-009 文字の色：前の 3 つ（red・teal・amber）と #rrggbb（小文字 16 進 6 桁）が通る", () => {
    expect([...DOC_COLORS]).toEqual(["red", "teal", "amber"]);
    for (const c of ["red", "teal", "amber", "#000000", "#ffffff", "#e11d48", "#0a0b0c"])
      expect(ok(withMark({ type: "color", attrs: { color: c } })), c).toBe(true);
  });

  it("K584-DOC-010 文字の色の断り：#rgb・大文字・# なし・8 桁・rgb()・hsl()・名前・url()・var()・空・空白・改行・後ろに続く style・文字以外・色の鍵が無い", () => {
    const badValues: unknown[] = [
      "#f00",
      "#FF0000",
      "#Ff0000",
      "ff0000",
      "#ff000080",
      "rgb(255,0,0)",
      "hsl(0,100%,50%)",
      "pink",
      "Red",
      "url(javascript:alert(1))",
      "var(--k-primary)",
      "",
      " #ff0000",
      "#ff0000 ",
      "#ff0000\n",
      "#ff0000;background:red",
      "#gggggg",
      "#ff00000",
      255,
      null,
      true,
    ];
    for (const c of badValues)
      expect(reason(withMark({ type: "color", attrs: { color: c } })), JSON.stringify(c)).toContain("color");
    expect(reason(withMark({ type: "color", attrs: {} }))).toContain("color");
    expect(reason(withMark({ type: "color" }))).toContain("color");
  });

  it("K584-DOC-011 背景の色（highlight）：attrs なし（前の黄）と attrs.color の #rrggbb が通り、名前・#rgb・大文字・旧い 3 色の名前・url()・空・null・色以外の鍵は断る", () => {
    expect(ok(withMark({ type: "highlight" }))).toBe(true);
    expect(ok(withMark({ type: "highlight", attrs: { color: "#fde68a" } }))).toBe(true);
    for (const c of ["yellow", "#fff", "#FDE68A", "red", "url(x)", "", null, 1])
      expect(reason(withMark({ type: "highlight", attrs: { color: c } })), JSON.stringify(c)).toContain("highlight");
    expect(reason(withMark({ type: "highlight", attrs: { color: "#fde68a", x: 1 } }))).toContain("highlight");
    expect(reason(withMark({ type: "highlight", attrs: { x: 1 } }))).toContain("highlight");
  });

  it("K584-DOC-012 色の値をそのまま style に入れても安全な形だけが通る：敵意のある文字列と決まった種の乱数の文字列 300 個のうち、validateDoc を通る色は全部 DOC_HEX_COLOR（^#[0-9a-f]{6}$）に完全一致する", () => {
    const hostile = [
      "#ff0000;background:url(javascript:alert(1))",
      "red;x",
      "#ff0000\n",
      "#ff0000\r\n",
      "#ff0000/*",
      "#ff0000}",
      "expression(alert(1))",
      '"onload=alert(1)',
      "'><script>",
      "#ff0000 !important",
      "\u0000#ff0000",
      "#ff０000",
      "#ｆｆ0000",
      "#ff0000 ",
      "#FF0000",
    ];
    let seed = 20261122;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = "#0123456789abcdefABCDEFxyz;:()\"' <>\n\\-";
    const random = Array.from({ length: 300 }, () =>
      Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join(""),
    );
    const accepted: string[] = [];
    for (const c of [...hostile, ...random, "#e11d48"]) {
      for (const type of ["color", "highlight"]) {
        if (ok(withMark({ type, attrs: { color: c } }))) accepted.push(c);
      }
    }
    expect(accepted).toContain("#e11d48");
    for (const c of accepted) {
      expect(DOC_HEX_COLOR.test(c), JSON.stringify(c)).toBe(true);
      expect(/^#[0-9a-f]{6}$/.test(c), JSON.stringify(c)).toBe(true);
    }
    expect(DOC_HEX_COLOR.source).toBe("^#[0-9a-f]{6}$");
  });

  it("K584-DOC-013 K-561 で通った文書は全部そのまま通り、同じ物を返し、docToText も前と同じ字になる", () => {
    const old = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("目的")] },
      p(
        t("請求を送る", [{ type: "bold" }, { type: "color", attrs: { color: "red" } }, { type: "highlight" }]),
        { type: "hardBreak" },
        t("二行目", [{ type: "link", attrs: { href: "https://example.com/a" } }]),
      ),
      { type: "paragraph", attrs: { ghost: true }, content: [t("薄い説明")] },
      {
        type: "bulletList",
        content: [
          li(pt("明細を集める"), {
            type: "taskList",
            content: [{ type: "taskItem", attrs: { checked: true }, content: [pt("済んだ")] }],
          }),
        ],
      },
      table([cell(undefined, "項目", "tableHeader"), cell(undefined, "数量")]),
      { type: "blockquote", content: [pt("引用")] },
      { type: "codeBlock", content: [t("x=1\ny=2")] },
      { type: "image", attrs: { caption: "図", attachment_id: null } },
    );
    const r = validateDoc(old);
    expect(r.ok && r.doc).toBe(old);
    expect(docToText(old)).toBe(
      "目的\n請求を送る\n二行目\n- 明細を集める\n  [x] 済んだ\n項目 | 数量\n> 引用\nx=1\ny=2\n図",
    );
  });

  it("K584-DOC-014 doc → text（番号つき）：箇条書きと同じ扱い（「- 」・入れ子の下げ幅も同じ・start の数は字に出ない）", () => {
    const body = (type: "bulletList" | "orderedList", attrs?: unknown) =>
      doc({
        type,
        ...(attrs ? { attrs } : {}),
        content: [
          li(pt("一"), nest("bulletList", 1), {
            type: "taskList",
            content: [{ type: "taskItem", attrs: { checked: false }, content: [pt("未")] }],
          }),
          li(pt("二")),
        ],
      });
    const bullet = docToText(body("bulletList"));
    expect(bullet).toBe("- 一\n  - x\n  [ ] 未\n- 二");
    expect(docToText(body("orderedList"))).toBe(bullet);
    expect(docToText(body("orderedList", { start: 7 }))).toBe(bullet);
    expect(docToText(body("orderedList", { start: 7 }))).not.toContain("7");
  });

  it("K584-DOC-015 doc → text（区切りの線）：字も空の行も出さない（前後の段落は 1 行ずつ・線だけの文書は空の文字）", () => {
    expect(docToText(doc(pt("上"), { type: "horizontalRule" }, pt("下")))).toBe("上\n下");
    expect(docToText(doc({ type: "horizontalRule" }, { type: "horizontalRule" }))).toBe("");
  });

  it("K584-DOC-016 doc → text（印・寄せ・色・結合・見出しの段は字に関わらない）：同じ字を飾った物と素の物で text が同じ", () => {
    const decorated = doc(
      { type: "heading", attrs: { level: 4, textAlign: "center" }, content: [t("小見出し")] },
      {
        type: "paragraph",
        attrs: { textAlign: "justify" },
        content: [
          t("下線", [{ type: "underline" }, { type: "color", attrs: { color: "#e11d48" } }]),
          t("消す", [{ type: "strike" }, { type: "highlight", attrs: { color: "#fde68a" } }]),
          t("x", [{ type: "code" }]),
          t("2", [{ type: "superscript" }]),
          t("i", [{ type: "subscript" }]),
        ],
      },
      table([cell({ colspan: 2, colwidth: [120, 80] }, "項目", "tableHeader"), cell(undefined, "金額", "tableHeader")]),
    );
    const plain = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("小見出し")] },
      pt("下線消すx2i"),
      table([cell(undefined, "項目", "tableHeader"), cell(undefined, "金額", "tableHeader")]),
    );
    expect(docToText(decorated)).toBe("小見出し\n下線消すx2i\n項目 | 金額");
    expect(docToText(decorated)).toBe(docToText(plain));
  });

  it("K584-DOC-017 上限は前のまま：入れ子 12（番号つきも）・大きさ 1,048,576 バイト・NUL・節の数に上限は無い（段落と区切りの線を 6,000 個ずつでも通る）", () => {
    expect(DOC_MAX_DEPTH).toBe(12);
    expect(DOC_MAX_BYTES).toBe(1_048_576);
    expect(ok(doc(nest("orderedList", 2)))).toBe(true);
    expect(reason(doc(nest("orderedList", 7)))).toContain("深い");
    expect(reason(doc(pt("あ".repeat(400_000))))).toContain("大きさ");
    expect(reason(doc(pt("a\u0000b")))).toContain("NUL");
    const many = Array.from({ length: 6000 }, (_v, i) =>
      i % 2 === 0 ? { type: "paragraph" } : { type: "horizontalRule" },
    );
    expect(ok(doc(...many, ...many))).toBe(true);
  });

  it("K584-DOC-018 リンクの守りは前のまま：http・https・mailto だけで、新しい印と重ねても同じ。javascript:・大文字・data:・vbscript:・空白つき・2,049 字は断る", () => {
    const link = (href: string) => ({ type: "link", attrs: { href } });
    for (const h of ["http://a.example/x", "https://a.example/x", "mailto:a@example.com"])
      expect(
        ok(doc(p(t("x", [{ type: "underline" }, { type: "color", attrs: { color: "#e11d48" } }, link(h)])))),
        h,
      ).toBe(true);
    for (const h of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      " https://a.example",
      `https://${"a".repeat(2048)}`,
    ])
      expect(reason(doc(p(t("x", [{ type: "underline" }, link(h)])))), h).toContain("link");
  });

  it("K584-DOC-019 薄い字（ghost）は前のまま：寄せや見出しの段 4 が付いていても text に入らず、ghost が真偽でなければ断る", () => {
    const d = doc(
      { type: "heading", attrs: { level: 4, ghost: true, textAlign: "center" }, content: [t("薄い見出し")] },
      { type: "paragraph", attrs: { ghost: true, textAlign: "right" }, content: [t("薄い説明")] },
      pt("本物"),
    );
    expect(ok(d)).toBe(true);
    expect(docToText(d)).toBe("本物");
    for (const g of ["true", null, 1])
      expect(reason(doc({ type: "paragraph", attrs: { ghost: g }, content: [t("x")] }))).toContain("paragraph");
  });

  it.each([
    ["知らない節 details", doc({ type: "details", content: [] }), "知らない節"],
    ["知らない節 mention", doc(p({ type: "mention", attrs: { id: "x" } })), "置けない"],
    ["知らない印 fontSize", withMark({ type: "fontSize" }), "印"],
    ["知らない印 textStyle", withMark({ type: "textStyle", attrs: { color: "#ff0000" } }), "印"],
    ["知らない印 comment", withMark({ type: "comment" }), "印"],
    ["段落に style", doc({ type: "paragraph", style: "x" }), "知らない鍵"],
    ["段落に class", doc({ type: "paragraph", attrs: { class: "x" } }), "attrs"],
    ["段落に colspan", doc({ type: "paragraph", attrs: { colspan: 2 } }), "attrs"],
    ["見出しに start", doc({ type: "heading", attrs: { level: 2, start: 3 }, content: [t("x")] }), "heading"],
    ["画像に余分な attrs", doc({ type: "image", attrs: { caption: "", attachment_id: null, width: 10 } }), "image"],
  ] as [string, Doc, string][])("K584-DOC-020 知らない物は前のまま断る（%s）", (_n, d, word) => {
    expect(reason(d)).toContain(word);
  });

  it("K584-DOC-021 置き場所の決まり：番号つきは listItem の中だけに入れ子にでき、段落・引用・表のセルの中には置けない。listItem の中に見出しは置けない", () => {
    expect(ok(doc({ type: "bulletList", content: [li(pt("a"), nest("orderedList", 1))] }))).toBe(true);
    const ol = nest("orderedList", 1);
    for (const [name, d] of [
      ["段落の中", doc(p(ol))],
      ["引用の中", doc({ type: "blockquote", content: [ol] })],
      ["表のセルの中", doc(table([{ type: "tableCell", content: [ol] }]))],
      [
        "listItem の中の見出し",
        doc({ type: "orderedList", content: [li({ type: "heading", attrs: { level: 2 }, content: [t("x")] })] }),
      ],
    ] as [string, Doc][])
      expect(reason(d), name).toContain("置けない");
  });

  it("K584-DOC-022 編集の部品（K-567）が書き出す形：足した節と印を全部含む文書が通り、docToText が決めた字になる（結合したセル・start が 2 以上の並び・旧い名前の色・属性の無い背景・ghost）", () => {
    const full = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("目的")] },
      { type: "heading", attrs: { level: 4, textAlign: "center" }, content: [t("小さい見出し")] },
      { type: "heading", attrs: { level: 3, ghost: true }, content: [t("薄い見出し")] },
      p(
        t("支払期日は 12/15", [
          { type: "bold" },
          { type: "underline" },
          { type: "color", attrs: { color: "#dc2626" } },
          { type: "highlight", attrs: { color: "#fde68a" } },
        ]),
      ),
      { type: "paragraph", attrs: { textAlign: "right" }, content: [t("右寄せ")] },
      { type: "paragraph", attrs: { ghost: true }, content: [t("薄い説明")] },
      p(
        t("消す", [{ type: "strike" }]),
        t("code", [{ type: "code" }]),
        t("2", [{ type: "superscript" }]),
        t("i", [{ type: "subscript" }]),
        t("青緑", [{ type: "color", attrs: { color: "teal" } }]),
        t("旧", [{ type: "highlight" }]),
      ),
      { type: "bulletList", content: [li(pt("明細を集める"))] },
      { type: "orderedList", attrs: { start: 3 }, content: [li(pt("三つ目")), li(pt("四つ目"))] },
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [pt("送った")] },
          { type: "taskItem", attrs: { checked: false }, content: [pt("控える")] },
        ],
      },
      { type: "horizontalRule" },
      table(
        [cell({ colspan: 2, colwidth: [120, 80] }, "項目", "tableHeader")],
        [cell(undefined, "見出しの行の左", "tableHeader"), cell({ rowspan: 2 }, "保守")],
        [cell(undefined, "見出しの列", "tableHeader")],
      ),
      { type: "blockquote", content: [pt("先月と同じ書式で")] },
      { type: "codeBlock", content: [t("a = 1\nb = 2")] },
      p(t("資料", [{ type: "link", attrs: { href: "https://example.com/a" } }]), { type: "hardBreak" }, t("次の行")),
      { type: "image", attrs: { caption: "先月の請求書の見本.png", attachment_id: null } },
    );
    const r = validateDoc(full);
    expect(r.ok && r.doc).toBe(full);
    expect(docToText(full)).toBe(
      [
        "目的",
        "小さい見出し",
        "支払期日は 12/15",
        "右寄せ",
        "消すcode2i青緑旧",
        "- 明細を集める",
        "- 三つ目",
        "- 四つ目",
        "[x] 送った",
        "[ ] 控える",
        "項目",
        "見出しの行の左 | 保守",
        "見出しの列",
        "> 先月と同じ書式で",
        "a = 1",
        "b = 2",
        "資料",
        "次の行",
        "先月の請求書の見本.png",
      ].join("\n"),
    );
  });

  it("K584-DOC-023 外に出す名前：足した定数と関数が @kaname/contracts の入口（index）から出ていて、docToText が同じ関数", () => {
    for (const k of [
      "validateDoc",
      "docToText",
      "DOC_COLORS",
      "DOC_ALIGNS",
      "DOC_HEX_COLOR",
      "DOC_HEADING_LEVELS",
      "DOC_COLSPAN_MAX",
      "DOC_COLWIDTH_MAX",
      "DOC_START_MAX",
    ])
      expect(Object.keys(api), k).toContain(k);
    expect(api.docToText).toBe(docToText);
    expect(api.validateDoc).toBe(validateDoc);
    expect(api.DOC_HEX_COLOR).toBe(DOC_HEX_COLOR);
  });
});
