# K-387 段・実績・保留を変える口（updateTicket の段と実績の分）。ほかの欄は段 8（K-67 から切る葉）が足すまで 422 E-VAL-018
#   振る舞い：apps/api/src/features/ticket-update/（欄ごとの処理の表）と F6/progress/（段・実績・保留の組）・DB の関数 app.ticket_progress_set（20261120130400）
#   段は stage_key（todo・doing・hold）か stage_id（会社が足した段・鍵が空）のどちらか 1 つ。送った欄だけを変える
#   断る番号は役割で分ける（代表の答え answer=f0f290e785a9）：422＝形の誤り（契約に書ける物だけ）／404＝指した物が無い・見えない／409＝今の状態ではできない
INPUTS = {
    "updateTicket": ("TicketUpdateInput", {"stage_id": "uuid", "stage_key": "string", "actual_minutes": "integer?", "hold_reason": "string", "resume_condition": "string"}),
}

RESPONSES = {
    "updateTicket": ("TicketUpdated", {"ticket": "object", "stage": "object", "changed": "boolean", "message_id": "uuid?"}),
}

# 保留の理由と再開の条件は、空白（\s）と制御文字だけでない字で、NUL（U+0000）を含まない（空・空白だけ・NUL を含むは 422 E-VAL-041・047・NUL はどの口でも入口で 422 の決め answer=c8b3f4c3aef8・字数の上限は置かない D-130.1）
_NOT_BLANK = "^[^\\u0000]*[^\\s\\u0000-\\u001f\\u007f][^\\u0000]*$"
VALUE_RANGES = {
    "updateTicket": {"actual_minutes": {"minimum": 0, "maximum": 100000}, "stage_key": {"enum": ["todo", "doing", "hold"]},
                     "hold_reason": {"pattern": _NOT_BLANK}, "resume_condition": {"pattern": _NOT_BLANK}},
}

ERRORS_4XX = {
    "updateTicket": [
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "チケットが無い・別の会社・消した（入口の行の守り）か、段の id（stage_id）が指す段が無い・別の会社の段・消した段（欄 stage_id）",
         "ears_form": "UNWANTED: IF チケットか指した段が無いか見えないなら、Kaname は 404 を返し、在るかを漏らさず何も書かない"},
        {"status": 409, "code": "E-CONF-030", "body": {"error": "conflict", "code": "E-CONF-030"}, "errors": ["E-CONF-030"],
         "trigger": "今の段が仕組みの段（確認中・承認待ち・実行中）か、走っている実行（待ち・実行中・聞いている）・決まっていない承認待ちがあるのに段を変えた（busy）。実績と保留の理由だけならこの間も変えられる",
         "ears_form": "UNWANTED: IF AI が動いている間か承認待ちの間に段を変えようとしたら、Kaname は 409 と E-CONF-030 を返し、何も書かない"},
        {"status": 409, "code": "E-CONF-032", "body": {"error": "conflict", "code": "E-CONF-032"}, "errors": ["E-CONF-032"],
         "trigger": "今の段が完了なのに、作業中（開き直す）以外の段（未着手・保留・会社が足した段）に変えた（done）。完了 → 作業中は開き直す（K-388）",
         "ears_form": "UNWANTED: IF 完了したチケットの段を、作業中への開き直し以外に変えようとしたら、Kaname は 409 と E-CONF-032 を返し、何も書かない"},
        {"status": 409, "code": "E-CONF-034", "body": {"error": "conflict", "code": "E-CONF-034", "details": []}, "errors": ["E-CONF-034"],
         "trigger": "段の id（stage_id）で、仕組みの段（確認中・承認待ち・実行中）か完了の段を行き先にした（段の口では移せない・欄 stage_id）",
         "ears_form": "UNWANTED: IF 段の口で移せない段を行き先にしたなら、Kaname は 409 と E-CONF-034 を返し、何も書かない"},
        {"status": 409, "code": "E-CONF-035", "body": {"error": "conflict", "code": "E-CONF-035", "details": []}, "errors": ["E-CONF-035"],
         "trigger": "段の id（stage_id）で保留の段を選んだのに、保留の理由か再開の条件を送っていない（足りない欄ごとの明細）",
         "ears_form": "UNWANTED: IF 段の id で保留の段を選んで理由か条件が無いなら、Kaname は 409 と E-CONF-035 と足りない欄を返し、何も書かない"},
        {"status": 409, "code": "E-CONF-036", "body": {"error": "conflict", "code": "E-CONF-036", "details": []}, "errors": ["E-CONF-036"],
         "trigger": "保留でないチケットで段を送らずに保留の理由か再開の条件を送った、または段の id で保留でない段を選んで理由か条件を付けた（欄ごとの明細）",
         "ears_form": "UNWANTED: IF 保留でないのに保留の理由か条件を書こうとしたら、Kaname は 409 と E-CONF-036 を返し、何も書かない"},
        {"status": 422, "code": "E-VAL-018", "body": {"error": "validation", "code": "E-VAL-018", "details": []}, "errors": ["E-VAL-018"],
         "trigger": "まだ変えられない欄（題名・期限・担当者・優先度・見込み・知らない欄）を送った（前処理・欄ごとに「この欄はまだ変えられません」・段を一緒に送っても何も書かない）",
         "ears_form": "UNWANTED: IF まだ変えられない欄を送ったなら、Kaname は 422 と E-VAL-018 と欄ごとの理由を返し、何も書かない"},
        {"status": 422, "code": "VALIDATION_ERROR", "body": {"error": "validation_failed", "details": []}, "errors": ["E-VAL-041", "E-VAL-047"],
         "trigger": "形の誤り：保留の理由（E-VAL-041）か再開の条件（E-VAL-047）が空・空白だけ・制御文字だけ、stage_key hold で理由か条件が無い。ほかに stage_id と stage_key の両方・stage_key が todo・doing・hold でない・stage_key todo・doing に理由か条件を付けた・実績が 0〜100000 の整数でない・空の体・本文の形違い（欄ごとの理由）",
         "ears_form": "UNWANTED: IF 入力の形が決まりに合わないなら、Kaname は 422 と欄ごとの理由（E-VAL-041・E-VAL-047 を含む）を返し、何も書かない"},
        {"status": 500, "code": "E-PAGE-003", "body": {"error": "internal", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "書く所（段・保留の列・変更の 1 行・担当者の受け箱の行・証跡）で DB が落ちた（1 つの処理なので何も残らない・ログは場所と例外の種類だけ）",
         "ears_form": "UNWANTED: IF 書く所の DB が落ちたなら、Kaname は 500 と E-PAGE-003 を返し、段・保留の列・変更の 1 行・知らせを前のまま残す"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "unavailable", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "守りの判定（今のメンバーか・書けるか）の所で例外になった・DB の関数が知らない言葉を返した",
         "ears_form": "UNWANTED: IF 守りの判定ができなかったなら、Kaname は 503 を返し、止める側に倒して何も書かない（守りの判定の例外）"},
    ],
}

# 形全体の決まり（欄をまたぐ決まり・K-355 の INPUT_RULES の書き方・代表の答え answer=f0f290e785a9：検査の例外は足さない）。口の振る舞いと同じ 422
#   1 段は stage_id か stage_key の片方だけ／空の体は断る（どれか 1 欄は要る）／stage_key hold は理由と条件が要る／stage_key todo・doing は理由と条件を付けない
#   「ほかの欄（題名・期限など）」は入力の形に無い欄＝知らない欄なので、形が断る（E-VAL-018 の前処理と同じ 422）
_FIELDS = ["stage_id", "stage_key", "actual_minutes", "hold_reason", "resume_condition"]
INPUT_RULES = {
    "updateTicket": {"allOf": [
        {"not": {"required": ["stage_id", "stage_key"]}},
        {"anyOf": [{"required": [f]} for f in _FIELDS]},
        {"anyOf": [{"not": {"required": ["stage_key"]}}, {"properties": {"stage_key": {"enum": ["todo", "doing"]}}},
                   {"required": ["hold_reason", "resume_condition"]}]},
        {"anyOf": [{"not": {"required": ["stage_key"]}}, {"properties": {"stage_key": {"enum": ["hold"]}}},
                   {"not": {"anyOf": [{"required": ["hold_reason"]}, {"required": ["resume_condition"]}]}}]},
    ]},
}
