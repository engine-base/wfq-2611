# K-406 渡した人が取り消す・催促する口（withdrawTicketHandover・remindTicketHandover）
# 取り消す：渡した人（申し出は申し出た人・配るは配った人）が待っている渡しを取り消す。相手に受け箱の行（メールは出さない・D-148.19）。体は空の形
# 催促する：渡した人が人宛ての渡し（引き継ぎ・合意ありで人に配った物）を 1 日 1 回まで催促する。相手に受け箱の行とメール。体は空の形
SCREEN_API = {
    "tickets": [
        ("POST", "/ticket_handovers/:id/withdraw", "A51|A48|A111", "ticket_handovers", "withdrawTicketHandover", ["notifications", "audit_events"]),
        ("POST", "/ticket_handovers/:id/remind", "A51|A111", "ticket_handovers", "remindTicketHandover", ["notifications", "audit_events"]),
    ],
}

PERMS = {
    "withdrawTicketHandover": ("self", "渡した人だけ（申し出は申し出た人・配るは配った人）。行の決まり from_member_id（K-406）", False),
    "remindTicketHandover": ("self", "渡した人だけ（申し出は申し出た人・配るは配った人）。行の決まり from_member_id（K-406）", False),
}

INPUTS = {
    "withdrawTicketHandover": ("HandoverWithdrawInput", {}),
    "remindTicketHandover": ("HandoverRemindInput", {}),
}

RESPONSES = {
    "withdrawTicketHandover": ("HandoverWithdrawn", {"id": "uuid", "state": "string", "decided_at": "string"}),
    "remindTicketHandover": ("HandoverReminded", {"id": "uuid", "reminded_at": "string"}),
}

# 答えの欄が、表の null を許す列と同じ名前でも null を返さないもの（取り消すと必ず決めた時刻が入り、催促すると必ず催促した時刻が入る）
NOT_NULL_ANSWERS = {
    "withdrawTicketHandover.decided_at": "取り消した時刻（DB の関数が now() を入れた行の値）を必ず返し、null にはしない（ticket_handovers.decided_at は待っている間 null 可）",
    "remindTicketHandover.reminded_at": "催促した時刻（DB の関数が now() を入れた行の値）を必ず返し、null にはしない（ticket_handovers.reminded_at は催促前 null 可）",
}

# メールが送れたか（受け箱の行は送れなくても残る・画面は成功の小さな知らせに「メールは届きませんでした」を足すかを K-413 が決める）
META = {"remindTicketHandover": {"mail": "string"}}

# 取り消す・催促する：渡した人でない（403）・無い／別の会社（404）・もう決まった／今日もう催促した／催促できない種類（409）
ERRORS_4XX = {
    "withdrawTicketHandover": [
        {"status": 403, "code": "E-HND-002", "body": {"error": "permission", "code": "E-HND-002"}, "errors": ["E-HND-002"],
         "trigger": "渡した人でない（渡された人・関係ない人）",
         "ears_form": "UNWANTED: IF 渡した人でないなら、Kaname は 403 と E-HND-002 を返し、何も書かない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "無い・別の会社の渡し（有ることも漏らさない）",
         "ears_form": "UNWANTED: IF 無い渡しを取り消そうとしたなら、Kaname は 404 と E-PAGE-001 を返し、何も書かない"},
        {"status": 409, "code": "E-HND-005", "body": {"error": "conflict", "code": "E-HND-005"}, "errors": ["E-HND-005"],
         "trigger": "もう決まった渡し（受けた・断られた・取り消された・二度押し）",
         "ears_form": "UNWANTED: IF その渡しがもう決まっているなら、Kaname は 409 と E-HND-005 を返し、何も書かない"},
    ],
    "remindTicketHandover": [
        {"status": 403, "code": "E-HND-002", "body": {"error": "permission", "code": "E-HND-002"}, "errors": ["E-HND-002"],
         "trigger": "渡した人でない（渡された人・関係ない人）",
         "ears_form": "UNWANTED: IF 渡した人でないなら、Kaname は 403 と E-HND-002 を返し、何も書かない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "無い・別の会社の渡し（有ることも漏らさない）",
         "ears_form": "UNWANTED: IF 無い渡しを催促しようとしたなら、Kaname は 404 と E-PAGE-001 を返し、何も書かない"},
        {"status": 409, "code": "E-HND-005", "body": {"error": "conflict", "code": "E-HND-005"}, "errors": ["E-HND-005", "E-HND-080", "E-HND-081"],
         "trigger": "もう決まった渡し（E-HND-005）・今日（日本の日付）もう催促した（E-HND-080）・申し出とグループに配った渡し（E-HND-081）",
         "ears_form": "UNWANTED: IF その渡しがもう決まっているか今日もう催促したか催促できない種類なら、Kaname は 409 と E-HND-005／E-HND-080／E-HND-081 を返し、何も書かない"},
    ],
}
