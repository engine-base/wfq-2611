# K-441 つながりの口（listTicketLinks・createTicketLink・deleteTicketLink）
# つながりは関連（向きなし・行は 1 つ）と派生元（from＝派生した側・to＝元）の 2 つだけ（D-125.50・D-128.80・D-150.16）。
#   足す入力は other_ticket_id（uuid・相手）と kind（related か derived_from）の 2 欄だけ（strict）。道の :id が足す側
#   答えは表の写し（TicketLinks）でなく、番号・題名・段・グループの形（片方が見えないときは番号だけ・D-128.115）
INPUTS = {
    "createTicketLink": ("TicketLinkInput", {"other_ticket_id": "uuid", "kind": "string"}),
}

_LINK = {"id": "uuid", "kind": "string", "side": "string?", "other": "object", "can_remove": "boolean", "created_at": "string"}
RESPONSES = {
    "listTicketLinks": ("TicketLink", dict(_LINK)),
    "createTicketLink": ("TicketLink", dict(_LINK)),
    "deleteTicketLink": ("TicketLinkDeleted", {"id": "uuid"}),
}

# apps/api/src/features/F4/ticket-links/hooks.ts（両方の欄が無ければ 422・kind は 2 つだけ）
REQUIRED_INPUTS = {
    "createTicketLink": ["other_ticket_id", "kind"],
}
VALUE_RANGES = {
    "createTicketLink": {"kind": {"enum": ["related", "derived_from"]}},
}

# 一覧は 1 つのチケットのつながりが少ない（多くても数十）ので全部を返す（上限 200 行）。子のチケット（meta.children）も同じ答えで返す（K-452 が使う）
LIST_DETAILS = {
    "listTicketLinks": {"sort": False, "desc": "取得（ticket_links）— チケットのつながり（関連・派生元）を見る。片方が見えないときは番号だけ。子チケットは meta.children", "meta": "{ limit, children }"},
}
META = {
    "listTicketLinks": {"children": "array"},
}

# 読む：チケットが見えない・無い・消した・別の会社（入口の 404・NOT_FOUND）・Kaname の側（503）
# 足す：足す側（:id）が見えない・無い・別の会社（入口の 404・NOT_FOUND）・足す側に書けない（入口の 403・欄なし）・相手が見えない・無い・消した・別の会社（口の 404・E-PAGE-001・在るかを漏らさない）・
#       相手に書けない（口の 403・欄 other_ticket_id）・自分自身（409）・もうつながっている（409）・派生元が輪（409）・入力（422）・Kaname の側（503）
# 外す：両端のどちらにも書けない（403）・どちらも見えない・外した行・無い id（口の 404・E-PAGE-001。道の :id の行の確かめは欄で名指しして外した・scripts/ci/row_rules.mjs の ROW_EXEMPT_FIELDS）・Kaname の側（503）
ERRORS_4XX = {
    "listTicketLinks": [
        {"status": 404, "code": "NOT_FOUND", "body": {"error": "not_found", "code": "NOT_FOUND"},
         "trigger": "チケットが無い・消した・別の会社・自分に見えない（入口の行の確かめ・在るかを漏らさない）",
         "ears_form": "UNWANTED: IF チケットが見えないなら、Kaname は 404 を返し、つながりも子も返さない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "入口の確かめを通った後でチケットが消えた・見えなくなった（競合・口の答え）",
         "ears_form": "UNWANTED: IF 入口の確かめの後でチケットが見えなくなったなら、Kaname は 404 と E-PAGE-001 を返し、つながりも子も返さない"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "つながりを読む DB が落ちた・DB の関数が知らない言葉を返した",
         "ears_form": "UNWANTED: IF つながりを読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、何も返さず何も書かない"},
    ],
    "createTicketLink": [
        {"status": 403, "code": "FORBIDDEN", "body": {"error": "forbidden", "code": "FORBIDDEN"},
         "trigger": "足す側（:id）のチケットに書けない（入口の行の確かめ・欄なし）・相手のチケットに書けない（欄 other_ticket_id）・会社の人でない",
         "ears_form": "UNWANTED: IF 足す側か相手のチケットに書けないなら、Kaname は 403 を返し（相手に書けないときは欄 other_ticket_id つき）、行も証跡も書かない"},
        {"status": 404, "code": "NOT_FOUND", "body": {"error": "not_found", "code": "NOT_FOUND"},
         "trigger": "足す側（:id）のチケットが無い・消した・別の会社・自分に見えない（入口の行の確かめ・在るかを漏らさない）",
         "ears_form": "UNWANTED: IF 足す側のチケットが見えないなら、Kaname は 404 を返し、行も証跡も書かない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "相手のチケットが無い・消した・別の会社・自分に見えない（口の答え・在るかを漏らさない）",
         "ears_form": "UNWANTED: IF 相手のチケットが見えないなら、Kaname は 404 と E-PAGE-001 を返し、行も証跡も書かない"},
        {"status": 409, "code": "E-LNK-001", "body": {"error": "conflict", "code": "E-LNK-001"}, "errors": ["E-LNK-001", "E-LNK-002", "E-LNK-003"],
         "trigger": "同じチケットとつなごうとした（E-LNK-001）・もうつながっている（同じ向き・関連の逆向きを含む・E-LNK-002）・派生元が輪になる（E-LNK-003）",
         "ears_form": "UNWANTED: IF 自分自身とつなごうとしたか、もうつながっているか、派生元が輪になるなら、Kaname は 409 とその理由（E-LNK-001・002・003）を返し、行も証跡も書かない"},
        {"status": 422, "code": "VALIDATION_ERROR", "body": {"error": "validation_failed", "details": []}, "errors": [],
         "trigger": "other_ticket_id が uuid でない・無い／kind が related・derived_from でない・無い／本文に知らない欄",
         "ears_form": "UNWANTED: IF 入力が決まりに合わないなら、Kaname は 422 と欄ごとの理由を返し、行も証跡も書かない"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "つながりと証跡を書く DB が落ちた・DB の関数が知らない言葉を返した",
         "ears_form": "UNWANTED: IF つながりを書く DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、行も証跡も残さない"},
    ],
    "deleteTicketLink": [
        {"status": 403, "code": "FORBIDDEN", "body": {"error": "forbidden", "code": "FORBIDDEN"},
         "trigger": "つながりの両端のどちらにも書けない（見える人）・会社の人でない",
         "ears_form": "UNWANTED: IF つながりの両端のどちらにも書けないなら、Kaname は 403 を返し、行も証跡も変えない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "つながりが無い・外した・別の会社・両端のどちらも見えない（在るかを漏らさない）",
         "ears_form": "UNWANTED: IF つながりが見えないなら、Kaname は 404 と E-PAGE-001 を返し、行も証跡も変えない"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "行を消して証跡を書く DB が落ちた・DB の関数が知らない言葉を返した",
         "ears_form": "UNWANTED: IF つながりを外す DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、行は生きたまま・証跡も増やさない"},
    ],
}
