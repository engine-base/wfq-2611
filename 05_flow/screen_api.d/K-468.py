# K-468 探す口（search・GET /api/v1/search）
#   種類ごとに上位の分だけ（limit 1〜5）・総数と続きは返さない（答えは data だけ・meta なし）。sort を受けない。QUERIES の search は ["q", "kinds"] のまま（本体の行）。
LIST_DETAILS = {
    "search": {"limit_max": 5, "sort": False, "desc": "取得（search）— 探す（チケット・決定・自分の会話・ナレッジのページ）。種類ごとに上位の分だけ。総数・続きは返さない"},
}
# 問い合わせの値域を契約に書く（K-468・口が 422 にするのは契約に書ける形に合わない値だけ）
#   q：送られたままの文字で 100 文字まで（apps/api/src/features/F7/search/query.ts の Q_MAX）
#   kinds：小文字の 4 つの名前を空白なしでコンマでつないだ形（同じ名前の重なりは可。空は指定なし）
QUERY_RANGES = {
    "search": {
        "q": {"maxLength": 100},
        "kinds": {"pattern": "^(?:ticket|decision|conversation|knowledge)(?:,(?:ticket|decision|conversation|knowledge))*$"},
    },
}
