# K-488 チケットを消す口（deleteTicket・DELETE /api/v1/tickets/:id）の問い合わせ・答え・値域・断りの表（K-325 の断片）
#   振る舞いの本体は apps/api/src/features/F7/ticket-delete/delete.ts（DB の関数 app.ticket_delete）。権限の文は本体 05_flow/screen_api.py の PERMS（前からある行を直した）
#   契約の DELETE は体を受けないので、子・孫の扱いは問い合わせで受ける（children・parent_id・reason）
QUERIES = {"deleteTicket": ["children", "parent_id", "reason"]}
RESPONSES = {
    "deleteTicket": ("TicketDeleted", {"id": "uuid", "deleted_count": "integer", "withdrawn_approvals": "integer", "stopped_runs": "integer", "restorable_until": "string"}),
}
# 問い合わせの値域を契約に書く（K-468 の仕組み）。422 にするのは契約に書ける形に合わない値だけ（apps/api/src/features/F7/ticket-delete/input.ts と同じ決まり）
#   children：空（指定なし）・move・cascade・detach。reason：400 字まで（前後の空白を落とす前の字数）。parent_id は名前の _id で作り手が uuid の形にする（ここには書かない）
QUERY_RANGES = {
    "deleteTicket": {"children": {"enum": ["", "move", "cascade", "detach"]}, "reason": {"maxLength": 400}},
}
ERRORS_4XX = {
    "deleteTicket": [
        {"status": 403, "code": "E-DEL-001", "body": {"error": "permission", "code": "E-DEL-001"}, "errors": ["E-DEL-001", "E-DEL-013"],
         "trigger": "作った人でも、そのグループで tickets の edit を持つ人でもない人が消した／一緒に消す子・孫に自分が消せない物がある（E-DEL-013）",
         "ears_form": "UNWANTED: IF 作った人でも編集の権限を持つ人でもない人が消したなら、または一緒に消す子・孫に自分が消せない物があるなら、Kaname は 403 を返し、チケットを何も変えない"},
        {"status": 404, "code": "NOT_FOUND", "body": {"error": "not_found", "code": "NOT_FOUND"}, "errors": ["E-DEL-014"],
         "trigger": "見えない・別の会社・無い・もう消えたチケット／子の移し先が無い・消えている・見えない・別の会社・move なのに移し先を指していない（E-DEL-014）",
         "ears_form": "UNWANTED: IF 見えない・無い・もう消えたチケットを消したなら、または子の移し先が見つからないなら、Kaname は 404 を返し、チケットを何も変えない"},
        {"status": 409, "code": "E-DEL-010", "body": {"error": "conflict", "code": "E-DEL-010"}, "errors": ["E-DEL-010", "E-DEL-011", "E-DEL-012"],
         "trigger": "子・孫がいるのに扱いを選ばずに消した（E-DEL-010）／子の移し先が自分かその子・孫（E-DEL-011）／移すと親子が 3 段を超える（E-DEL-012）",
         "ears_form": "UNWANTED: IF 子・孫がいるのに扱いを選ばずに消したなら、または移し先が使えないなら、Kaname は 409 を返し、チケットも子も何も変えない"},
        {"status": 422, "code": "VALIDATION_ERROR", "body": {"error": "validation_failed", "code": "VALIDATION_ERROR"},
         "trigger": "children が空・move・cascade・detach の外／parent_id が uuid でない／reason が 401 字以上",
         "ears_form": "UNWANTED: IF 問い合わせの値が契約の値域の外なら、Kaname は 422 を返し、チケットを何も変えない"},
        {"status": 503, "code": "E-PAGE-003", "body": {"error": "dependency", "code": "E-PAGE-003"}, "errors": ["E-PAGE-003"],
         "trigger": "消す DB の関数・証跡の書き込みが落ちた（取引ごと戻る）",
         "ears_form": "UNWANTED: IF 消す DB の関数か証跡の書き込みが落ちたなら、Kaname は 503 と E-PAGE-003 を返し、何も消さず・取り下げず・止めない"},
    ],
}
