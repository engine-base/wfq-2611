# K-390 決定を読む口（listTicketDecisions）・足す口（createTicketDecision）
#   体（createTicketDecision）：text（必須・字数の上限なし）・reason・decided_by_member_id（同じ会社の今のメンバー・既定は本人）・decided_note（ひとこと）・
#   source_message_id（やり取りの書き込みから決定にする）・promoted_to（ticket か client_rule。client_rule は段 12 まで 409 E-CONF-037）。
#   書いた人・決めた時刻・改めた先は入れさせない（知らない欄は 422）。
#   答えの 1 件 TicketDecision は 12 の鍵（K-391 の改める・取り消す口も同じ形で答える・画面 K-397 が読む）
INPUTS = {
    "createTicketDecision": ("TicketDecisionInput", {"text": "string", "reason": "string?", "decided_by_member_id": "uuid?", "decided_note": "string?", "source_message_id": "uuid?", "promoted_to": "string?"}),
}

REQUIRED_INPUTS = {
    "createTicketDecision": ["text"],
}

# text は空・空白・制御文字だけを形で断る（K-391 と同じ式・代表の答え answer=f0f290e785a9：検査の例外は足さない）。
#   決めた人・元の書き込みが指す物の有無（404）と取引先のルール（409）は DB の中身・今の状態で決まるので 422 にしない
_NOT_BLANK = "[^\\s\\u0000-\\u001f\\u007f]"
VALUE_RANGES = {
    "createTicketDecision": {"text": {"pattern": _NOT_BLANK}, "promoted_to": {"enum": ["ticket", "client_rule"]}},
}

RESPONSES = {
    "listTicketDecisions": ("TicketDecision", {"id": "uuid", "ticket_id": "uuid", "text": "string", "reason": "string?", "decided_by": "object?", "decided_note": "string?", "decided_at": "string", "source": "object?", "revises_id": "uuid?", "superseded_by_id": "uuid?", "cancelled": "object?", "promoted_to": "string"}),
    "createTicketDecision": ("TicketDecisionCreated", {"decision": "object", "message_id": "uuid"}),
}

META = {
    "listTicketDecisions": {"can_write": "boolean"},   # 呼んだ人が今のメンバーで書けるか（画面が「＋ 決定を足す」を出すかに使う）
}

# 一覧の細目：絞り込みも並べ替えも受けない（生きている決定 → 改められた → 取り消した の順に全部・上限 500）
LIST_DETAILS = {
    "listTicketDecisions": {"sort": False, "desc": "取得（ticket_decisions）— チケットの決定を見る（生きている決定・改められた・取り消した）", "meta": "{ can_write }"},
}

ERRORS_4XX = {
    "createTicketDecision": [
        {"status": 422, "code": "E-VAL-042", "body": {"error": "validation_failed", "code": "E-VAL-042"}, "errors": ["E-VAL-042"],
         "trigger": "決めたことが無い・空・空白だけ・制御文字だけ（E-VAL-042・欄 text）。書いた人・決めた時刻・改めた先など知らない欄を送ると 422 VALIDATION_ERROR",
         "ears_form": "UNWANTED: IF 決めたことが空（空白だけ・制御文字だけを含む）なら、Kaname は 422 E-VAL-042 を返し、何も書かない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "チケットが無い・別の会社・消した・見えない／決めた人が同じ会社の今のメンバーでない（別の会社・外された・止められた・無い id・欄 decided_by_member_id）／元の書き込みがこのチケットの消していない書き込みでない（別のチケット・変更の 1 行・仕組みの行・消した物・無い id・欄 source_message_id）。在るかを漏らさない",
         "ears_form": "UNWANTED: IF チケットか決めた人か元の書き込みが無いか見えないなら、Kaname は 404 を返し、在るかを漏らさず何も書かない"},
        {"status": 409, "code": "E-CONF-037", "body": {"error": "conflict", "code": "E-CONF-037"}, "errors": ["E-CONF-037"],
         "trigger": "取引先のルールにした（promoted_to が client_rule・段 12 の取引先の画面ができるまで今の状態ではできない・details の文は「取引先の画面ができてから使えます」）",
         "ears_form": "UNWANTED: IF 取引先のルールにしたなら、Kaname は 409 と E-CONF-037 を返し、何も書かない（取引先の画面ができるまで）"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "unavailable", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "守りの判定（今のメンバーか・書けるか）の所で例外になった・DB の関数が知らない言葉を返した",
         "ears_form": "UNWANTED: IF 守りの判定ができなかったなら、Kaname は 503 を返し、止める側に倒して何も書かない（守りの判定の例外）"},
    ],
}
