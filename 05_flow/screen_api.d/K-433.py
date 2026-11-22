# K-433 版を読む口（listTicketVersions）・本文を版に戻す口（restoreTicketVersion）・項目の変更を比べる口（listTicketItemChanges・この葉が足す新しい口）
# 戻す入力は current_version（今見ている本文の版）だけ。strict（知らない欄は 422）。道の :v・問い合わせの from・to は 404・E-PAGE-001（形で 422 にしない）
# 404・409 の体は error と code（409 は message）だけで field・details・detail を付けない（控え帳 2026-11-20 20:50・2026-11-21 01:15）
INPUTS = {
    "restoreTicketVersion": ("BodyRestoreInput", {"current_version": "integer"}),
}
REQUIRED_INPUTS = {"restoreTicketVersion": ["current_version"]}
VALUE_RANGES = {
    "restoreTicketVersion": {"current_version": {"minimum": 1}},
}
QUERIES = {
    "listTicketVersions": ["from", "to"],
    "listTicketItemChanges": ["from", "to"],
}
LIST_DETAILS = {
    "listTicketVersions": {"sort": False, "limit_max": 200, "desc": "取得（ticket_section_versions）— 本文の版を新しい順に見て、比べる 2 つの版の text を受ける（差分は作らない）", "meta": "{ limit, truncated, can_restore }"},
    "listTicketItemChanges": {"sort": False, "limit_max": 200, "desc": "取得（ticket_messages）— 項目の変更の点と、比べる 2 つの点の正味の変わりを見る", "meta": "{ limit, truncated }"},
}
META = {
    "listTicketVersions": {"limit": {"type": "integer"}, "truncated": "boolean", "can_restore": "boolean"},
}
# K-432 の BodySaved と同じ名前の型は同じ鍵が 2 つになって止まるので、名前を BodyRestored にして同じ 3 欄を書く
RESPONSES = {
    "listTicketVersions": ("TicketVersionsView", {"versions": "array", "from": "object?", "to": "object?"}),
    "restoreTicketVersion": ("BodyRestored", {"version": "integer", "changed": "boolean", "edited_at": "string"}),
    "listTicketItemChanges": ("TicketItemChangesView", {"points": "array", "from": "integer?", "to": "integer", "diff": "array"}),
}
UNEXPRESSIBLE_422: dict = {}

_NF = {"status": 404, "code": "NOT_FOUND", "body": {"error": "not_found", "code": "NOT_FOUND"}}
_PG = {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"]}
_DEP = {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"]}
ERRORS_4XX = {
    "listTicketVersions": [
        {**_NF, "trigger": "別の会社・見えない・無い id（有ることも漏らさない）",
         "ears_form": "UNWANTED: IF チケットが別の会社・見えない・無い id なら、Kaname は 404 と NOT_FOUND を返し、何も返さない"},
        {**_PG, "trigger": "消したチケット・無い版・形の違う from・to（0・負・小数・文字）",
         "ears_form": "UNWANTED: IF 消したチケット・無い版・形の違う from・to を指したなら、Kaname は 404 と E-PAGE-001 を返し、何も返さない"},
        {**_DEP, "trigger": "版を読む DB が落ちた",
         "ears_form": "UNWANTED: IF 版を読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返す"},
    ],
    "listTicketItemChanges": [
        {**_NF, "trigger": "別の会社・見えない・無い id（有ることも漏らさない）",
         "ears_form": "UNWANTED: IF チケットが別の会社・見えない・無い id なら、Kaname は 404 と NOT_FOUND を返し、何も返さない"},
        {**_PG, "trigger": "消したチケット・無い点・形の違う from・to（0・負・小数・文字）",
         "ears_form": "UNWANTED: IF 消したチケット・無い点・形の違う from・to を指したなら、Kaname は 404 と E-PAGE-001 を返し、何も返さない"},
        {**_DEP, "trigger": "項目の変更を読む DB が落ちた",
         "ears_form": "UNWANTED: IF 項目の変更を読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返す"},
    ],
    "restoreTicketVersion": [
        {"status": 403, "code": "FORBIDDEN", "body": {"error": "forbidden", "code": "FORBIDDEN"},
         "trigger": "そのチケットは見えるが、書く権限（グループの tickets の edit か担当者）が無い",
         "ears_form": "UNWANTED: IF チケットは見えるが書く権限が無いなら、Kaname は 403 と FORBIDDEN を返し、本文も版も変えない"},
        {**_NF, "trigger": "別の会社・見えない・無い id（有ることも漏らさない）",
         "ears_form": "UNWANTED: IF チケットが別の会社・見えない・無い id なら、Kaname は 404 と NOT_FOUND を返し、何も書かない"},
        {**_PG, "trigger": "消したチケット・無い版・数字でない道の :v・本文の行が無いチケット",
         "ears_form": "UNWANTED: IF 消したチケット・無い版・数字でない :v・本文の行が無いチケットを戻そうとしたなら、Kaname は 404 と E-PAGE-001 を返し、何も書かない"},
        {"status": 409, "code": "E-SEC-004", "body": {"error": "conflict", "code": "E-SEC-004"}, "errors": ["E-SEC-004"],
         "trigger": "送った current_version が今の版と違う（先に別の人が直した・同じ版を持った 2 つの画面の後の方）",
         "ears_form": "UNWANTED: IF 送った current_version が今の版と違うなら、Kaname は 409 と E-SEC-004 を返し、本文も版も変えない"},
        {"status": 409, "code": "E-SEC-020", "body": {"error": "conflict", "code": "E-SEC-020"}, "errors": ["E-SEC-020"],
         "trigger": "戻す先の版の中身が今の本文と同じ",
         "ears_form": "UNWANTED: IF 戻す先の版の中身が今の本文と同じなら、Kaname は 409 と E-SEC-020 を返し、版を増やさない"},
        {"status": 409, "code": "E-SEC-005", "body": {"error": "conflict", "code": "E-SEC-005"}, "errors": ["E-SEC-005"],
         "trigger": "完了したチケット（完了の時刻が入っているか段が done）",
         "ears_form": "UNWANTED: IF 完了したチケットの本文を版に戻そうとしたなら、Kaname は 409 と E-SEC-005 を返し、本文も版も変えない"},
        {"status": 422, "code": "VALIDATION_ERROR", "body": {"error": "validation_failed", "details": []},
         "trigger": "current_version が無い・0・整数でない／知らない欄",
         "ears_form": "UNWANTED: IF 入力が決まりに合わないなら、Kaname は 422 と欄ごとの理由を返し、本文も版も変えない"},
        {**_DEP, "trigger": "本文の行・版の行・やり取りの 1 行・証跡のどれかを書く DB が落ちた（1 つの取引で戻す）",
         "ears_form": "UNWANTED: IF 戻す DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、本文・版・やり取り・証跡のどれも残さない"},
    ],
}
