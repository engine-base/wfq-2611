# K-487 消す前の下見の口（previewTicketDelete）の断りの表
# 答えの形と権限の文は本体 05_flow/screen_api.py（前からある行を直した・RESPONSES・PERMS）。ここは上限と断りだけ（K-325 の断片）。
#   消せる人（作った人か、そのグループで tickets の edit を持つ人・D-125.62・P14）の判定は口のこの葉が持つ（入口の行の決まりは「見える」だけ）
# 1 分に 60 回まで（K487-API-012・チケットの行の表）。確認の小窓を開いたときだけ読む口で、既定の GET の 120 回より絞る（押しすぎを早く止める）
RATES = {
    "previewTicketDelete": "60/min/user",
}
ERRORS_4XX = {
    "previewTicketDelete": [
        {"status": 403, "code": "E-DEL-001", "body": {"error": "permission", "code": "E-DEL-001"}, "errors": ["E-DEL-001"],
         "trigger": "作った人でも、そのグループで tickets の edit を持つ人でもない人が、消す前の下見を開いた",
         "ears_form": "UNWANTED: IF 作った人でも、そのグループで編集の権限を持つ人でもない人が下見を開いたなら、Kaname は 403 と E-DEL-001 を返し、チケットも何も変えない"},
        {"status": 404, "code": "NOT_FOUND", "body": {"error": "not_found", "code": "NOT_FOUND"},
         "trigger": "見えない・別の会社・無い・もう消えたチケット（有ることも漏らさない）",
         "ears_form": "UNWANTED: IF 見えない・別の会社・無い・もう消えたチケットの下見を開いたなら、Kaname は 404 を返し、チケットも何も変えない"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "件数を数える DB が落ちた",
         "ears_form": "UNWANTED: IF 件数を数える DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、一部だけの件数を返さない"},
    ],
}
