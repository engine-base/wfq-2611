# K-434 確認項目を読む・足す口（listTestSpecs・createTestSpec）
# 足す入力は title の 1 欄だけ（strict）：前後の空白を落として 1〜200 字（D-150.28）。種類・判定の型・設定値・出どころ・チェック・version・off_reason・id などは受けない
#   （ticket_id は道（:id）から決め、体に入れさせない＝知らない欄は 422）。確かめは DB の関数 app.test_spec_title_check が 1 か所で持つ
INPUTS = {
    "createTestSpec": ("TestSpecCreateInput", {"title": "string"}),
}

REQUIRED_INPUTS = {
    "createTestSpec": ["title"],
}

# 題名は空白だけでない 200 字まで（落とす前の長さ。保存するのは前後の空白を落とした値）
VALUE_RANGES = {
    "createTestSpec": {
        "title": {"pattern": "\\S", "maxLength": 200},
    },
}

UNEXPRESSIBLE_422 = {}   # 決まりは全部 VALUE_RANGES で契約に書いた（検査の例外は足さない）

# 答えの行は文とチェックと並びと出どころ（鍵ちょうど 6）。version は行の版（画面が updateTestSpec に送る）。source_ref_id は答えに出さない
_ITEM = {"id": "uuid", "title": "string", "checked": "boolean", "position": "integer", "source": "string", "version": "integer"}
RESPONSES = {
    "listTestSpecs": ("TestSpecItem", dict(_ITEM)),
    "createTestSpec": ("TestSpecItem", dict(_ITEM)),
}

# 一覧は並べ替え・絞り込みを受けない（作った順に全部・上限 500）。答えの meta：件数 count・limit・書けて完了していないかの can_edit
QUERIES = {
    "listTestSpecs": [],
}
LIST_DETAILS = {
    "listTestSpecs": {"sort": False, "desc": "取得（test_specs）— チケットの確認項目を作った順に見る（文・チェック・出どころ）", "meta": "{ count, limit, can_edit }"},
}
META = {
    "listTestSpecs": {"count": {"type": "integer"}, "limit": {"type": "integer"}, "can_edit": "boolean"},
}

# 足す（K-434）：書けない人（入口の 403）・見えない／無い／別の会社／消された（404・欄も details も付けない）・完了した（409・E-SPEC-001・欄も details も付けない）・
#   題名の形の誤り（422・欄は title）・DB の関数が落ちた（503）。外は呼ばないので 502 は無い
ERRORS_4XX = {
    "createTestSpec": [
        {"status": 403, "code": "FORBIDDEN", "body": {"error": "forbidden", "code": "FORBIDDEN"}, "errors": [],
         "trigger": "チケットは見えるが書けない人（読むだけの人。入口の行の守り）",
         "ears_form": "UNWANTED: IF チケットを書けない人なら、Kaname は 403 を返し、項目も証跡も作らない"},
        {"status": 404, "code": "NOT_FOUND", "body": {"error": "not_found", "code": "NOT_FOUND"}, "errors": [],
         "trigger": "チケットが無い・見えない・ほかの会社の物・消された（欄も details も付けない＝在るかを漏らさない）",
         "ears_form": "UNWANTED: IF チケットが無いか見えないなら、Kaname は 404 を返し、在るかを漏らさず項目も証跡も作らない"},
        {"status": 409, "code": "E-SPEC-001", "body": {"error": "conflict", "code": "E-SPEC-001"}, "errors": ["E-SPEC-001"],
         "trigger": "チケットが完了した（完了の確定と同時に来たときも、完了の後に来た方）",
         "ears_form": "UNWANTED: IF チケットが完了しているなら、Kaname は 409 と E-SPEC-001 を返し、項目も証跡も作らない"},
        {"status": 422, "code": "VALIDATION_ERROR", "body": {"error": "validation_failed", "details": []}, "errors": [],
         "trigger": "題名が空白だけか 200 字を超える・体に知らない欄（strict）",
         "ears_form": "UNWANTED: IF 入力が決まりに合わないなら、Kaname は 422 と欄ごとの理由を返し、項目も証跡も作らない"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "項目と証跡を書く DB の関数（app.test_spec_create）が使えない・書けない",
         "ears_form": "UNWANTED: IF 書けないなら、Kaname は 503 と E-PAGE-003 を返し、項目も証跡も残さない"},
    ],
}
