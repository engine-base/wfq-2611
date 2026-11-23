# K-754 やったことと育ち具合を読む口（listCloneActivity・getCloneGrowth）の断片（K-325）
#   答えの形（RESPONSES）・使う表の欄は本体 05_flow/screen_api.py の前からある行を直した（同じ鍵を 2 つのファイルが持てない）
#   振る舞いの本体は apps/api/src/features/F5/clone-room/activity.ts（DB の関数 app.clone_activity・app.clone_growth・20261125023400）
META = {
    "listCloneActivity": {"summary": "object"},   # 期間の全部の数 { total, passed, fixed, stopped, waiting }（札・続きに関わらない）
}
LIST_DETAILS = {
    "listCloneActivity": {"limit_max": 200, "sort": False, "desc": "取得（action_runs）— 自分の分身が終えた実行を新しい順に読む（札・期間で絞る・期間の数つき）", "meta": "{ limit, cursor, summary }"},
}
# 問い合わせの値域を契約に書く（K-468 の仕組み・口が 422 にするのは契約に書ける形に合わない値だけ）
#   kind：3 つの札。from・to：日本の日付（暦に実在する日）。from が to より後・期間が 366 日を超えるのは口が 422（欄 from）
#   cursor の pattern（base64url の 1〜200 字）は作り手が KEY_CURSOR_OPS から書く
QUERY_RANGES = {
    "listCloneActivity": {
        "kind": {"enum": ["ran", "made", "stopped"]},
        "from": {"format": "date"},
        "to": {"format": "date"},
    },
}
# やったことの 1 行はチケットの実行だけ（会話の実行は出さない）なので ticket_id は必ず入る
NOT_NULL_ANSWERS = {
    "listCloneActivity.ticket_id": "チケットの実行だけを読む口。DB の関数 app.clone_activity は ticket_id を持つ実行だけを返す（action_runs.ticket_id は会話の実行のために null 可）",
}
