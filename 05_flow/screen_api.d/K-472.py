# K-472 チケットの一覧（listTickets・GET /api/v1/tickets）の絞り込みの受け皿
#   本体 05_flow/screen_api.py にあった listTickets の 3 行（QUERIES・META・LIST_DETAILS）をここへ移した（同じ鍵を 2 つの断片が持てないので、前からの行を直す葉はこの葉だけ）。
#   この断片の行を K-473（QUERIES・LIST_DETAILS の sort・QUERY_RANGES の行）・K-474（META と meta）が直す。
#   絞り込みの欄は apps/api/src/features/F4/ticket-list/query.ts の FILTERS（kind_id・stage_id・assignee_id・done）。*_id は契約で uuid（入口が uuid でない値を口の前に断る）
QUERIES = {
    "listTickets": ["view", "q", "scope_id", "kind_id", "stage_id", "assignee_id", "done"],
}
META = {
    "listTickets": {"next_cursor": {"type": "string", "nullable": True}},   # 次の分の鍵（keyset・最後の分は null）。総数も数も返さない（D-144.3・K-92）
}
LIST_DETAILS = {
    "listTickets": {"limit_max": 100, "sort": False, "desc": "取得（tickets）— チケットの一覧を見る（自分に関わるもの・すべて・グループ・題名か番号・担当者・段・種別・完了で絞る・期限切れの印）", "meta": "{ next_cursor }"},
}
# 問い合わせの値域を契約に書く（K-468 の仕組み・口が 422 にするのは契約に書ける形に合わない値だけ）
#   view：mine か all。done：true か false。q：送られたままの文字で 100 文字まで（query.ts の Q_MAX）。
#   cursor の pattern（base64url の 1〜200 字）は作り手が KEY_CURSOR_OPS から書く
QUERY_RANGES = {
    "listTickets": {
        "view": {"enum": ["mine", "all"]},
        "done": {"enum": ["true", "false"]},
        "q": {"maxLength": 100},
    },
}
# 続きの鍵が形には合うが今の状態では読めないとき 409・E-LST-001（欄なし）。画面は鍵なしで最初から読み直す（汎用の 401・403・422・429 は作り手が足す）
ERRORS_4XX = {
    "listTickets": [
        {"status": 409, "code": "CONFLICT", "body": {"error": "conflict", "code": "E-LST-001"}, "errors": ["E-LST-001"],
         "trigger": "続きの鍵が形（base64url の 1〜200 字）には合うが、今の状態では読めない（JSON でない・中身が合わない・古い形・別の view や並びの鍵）",
         "ears_form": "UNWANTED: IF 続きの鍵が形に合うのに今の状態では読めないなら、Kaname は 409 と E-LST-001 を返し、最初から読み直すよう促す"},
    ],
}
