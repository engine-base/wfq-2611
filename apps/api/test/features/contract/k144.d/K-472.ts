// 葉 K-472「一覧の絞り込みの受け皿と、人・段・種別・完了で絞る」が、共有の試験 ../k144-contract.test.ts に足す分（置き方は README.md・K-378）。
//   足す欄は listTickets（GET /tickets）の問い合わせ kind_id・stage_id・assignee_id と、前からの scope_id（口が作った口に数えられるので行が要る・どれも *_id なので契約で uuid・入口の共通の形の確かめ・K-144）。
//   uuid でない値は 422・欄 <名前>・理由 uuid、正しい uuid・空の値は 422 にしない。口は作り済み（ticketHooks）なので準備（setup）は要らない。
//   行の番号 K144-API-871〜874 は段 8 の使っていない番号を 4 つの欄で借りた（876 は K-476 が使う。精査で重なりが見つかり 876 から 871 に付け替えた）。
//   テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
import type { K144Leaf } from "./_base.js";

export const leaf: K144Leaf = {
  UUID_PARAM_CASES: [
    ["K144-API-872", "listTickets", "query", "kind_id"], // K-472
    ["K144-API-873", "listTickets", "query", "stage_id"], // K-472
    ["K144-API-874", "listTickets", "query", "assignee_id"], // K-472
    ["K144-API-871", "listTickets", "query", "scope_id"], // K-472（一覧の口が作った口に数えられ、前からの scope_id の入口の行も要る・K144_SHAPE_017）
  ],
};
