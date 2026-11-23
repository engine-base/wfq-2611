# K-472 チケットの一覧（listTickets・GET /api/v1/tickets）の絞り込みの受け皿
#   本体 05_flow/screen_api.py にあった listTickets の 3 行（QUERIES・META・LIST_DETAILS）をここへ移した（同じ鍵を 2 つの断片が持てないので、前からの行を直す葉はこの葉だけ）。
#   この断片の行を K-473（QUERIES・LIST_DETAILS の sort・QUERY_RANGES の行）・K-474（META と meta）が直す。
#   絞り込みの欄は apps/api/src/features/F4/ticket-list/query.ts の FILTERS（K-472：kind_id・stage_id・assignee_id・done／K-473：due_from・due_to・start_from・start_to・overdue・fire・parent・fields・due・delegated・approving と並び sort）。*_id は契約で uuid（入口が uuid でない値を口の前に断る）
QUERIES = {
    "listTickets": ["view", "q", "scope_id", "kind_id", "stage_id", "assignee_id", "done",
                    "due", "delegated", "approving", "due_from", "due_to", "start_from", "start_to", "overdue", "fire", "parent", "fields"],
}
META = {
    "listTickets": {"next_cursor": {"type": "string", "nullable": True}},   # 次の分の鍵（keyset・最後の分は null）。総数も数も返さない（D-144.3・K-92）
}
LIST_DETAILS = {
    "listTickets": {"limit_max": 100, "desc": "取得（tickets）— チケットの一覧を見る（自分に関わるもの・すべて・グループ・題名か番号・担当者・段・種別・取引先・完了・期限と開始の範囲・期限切れ・炎・親・期限なし・AI に任せている・自分が承認で絞る・並べる・見せる欄を足す・期限切れの印）", "meta": "{ next_cursor }"},
}
# 問い合わせの値域を契約に書く（K-468 の仕組み・口が 422 にするのは契約に書ける形に合わない値だけ）
#   view：mine か all。done：true か false。q：送られたままの文字で 100 文字まで（query.ts の Q_MAX）。
#   K-473：日付 4 欄は format: date（暦に実在する日）＋年 0000 を外す pattern・overdue／fire／delegated／approving は true か false・due は none・
#   parent は none／any／uuid の形（format: uuid を使うと生成器が入口の uuid の確かめに回し none・any を断る）・sort は 4 つの enum（一覧の共通の enum を置き換える）・fields は 5 つの名前を空白なしでコンマでつないだ形。
#   cursor の pattern（base64url の 1〜200 字）は作り手が KEY_CURSOR_OPS から書く
QUERY_RANGES = {
    "listTickets": {
        "view": {"enum": ["mine", "all"]},
        "done": {"enum": ["true", "false"]},
        "q": {"maxLength": 100},
        "due_from": {"format": "date", "pattern": "^(?!0000-)[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
        "due_to": {"format": "date", "pattern": "^(?!0000-)[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
        "start_from": {"format": "date", "pattern": "^(?!0000-)[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
        "start_to": {"format": "date", "pattern": "^(?!0000-)[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
        "overdue": {"enum": ["true", "false"]},
        "fire": {"enum": ["true", "false"]},
        "delegated": {"enum": ["true", "false"]},
        "approving": {"enum": ["true", "false"]},
        "due": {"enum": ["none"]},
        "parent": {"pattern": "^(?:none|any|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},
        "sort": {"enum": ["due_on", "start_on", "updated_at", "created_at"]},
        "fields": {"pattern": "^(?:start_on|priority|estimate_minutes|actual_minutes|scope)(?:,(?:start_on|priority|estimate_minutes|actual_minutes|scope))*$"},
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
