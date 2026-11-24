# K-410 グループに来たものを引き取る口（claimTicketHandover・POST /api/v1/ticket_handovers/:id/claim・人を決める）
# 答える口（answerTicketHandover）の入力には人の欄が無いので足す口にする。自分が持つは答える口の accept（K-401 の振り分け → K-410 の中身）
SCREEN_API = {
    "approvals": [
        ("POST", "/ticket_handovers/:id/claim", "A111", "ticket_handovers", "claimTicketHandover", ["tickets", "notifications", "audit_events"]),
    ],
}

PERMS = {
    "claimTicketHandover": ("recipient", "グループに配られた渡しの答える人（そのグループを管理する人・app.handover_answerer）だけ。グループの人を担当者に決める（D-125.118）", False),
}

INPUTS = {
    "claimTicketHandover": ("TicketHandoverClaimInput", {"member_id": "uuid"}),
}

REQUIRED_INPUTS = {
    "claimTicketHandover": ["member_id"],
}

RESPONSES = {
    "claimTicketHandover": ("TicketHandoverClaimed", {"id": "uuid", "state": "string", "ticket_id": "uuid", "assignee_member_id": "uuid"}),
}

# 答える人でない（403）・無い／別の会社（無い人・別の会社の人を選んだときも 404）・もう決まった（409）・グループの外／止まっている人を選んだ（409）・入力（422）
ERRORS_4XX = {
    "claimTicketHandover": [
        {"status": 403, "code": "E-HND-002", "body": {"error": "permission", "code": "E-HND-002"}, "errors": ["E-HND-002"],
         "trigger": "答える人でない（渡した人・関係ない人・閲覧のみ・グループを管理しない人）・人宛ての渡し（グループ宛てでない）",
         "ears_form": "UNWANTED: IF 答える人でないか、グループ宛てでない渡しなら、Kaname は 403 と E-HND-002 を返し、何も書かない"},
        {"status": 404, "code": "E-PAGE-001", "body": {"error": "not_found", "code": "E-PAGE-001"}, "errors": ["E-PAGE-001"],
         "trigger": "無い・別の会社・見えない渡し、または決める人に選んだ人が無い人・別の会社の人（有ることも漏らさない・欄なし）",
         "ears_form": "UNWANTED: IF 無い渡し、または無い人・別の会社の人を決める人に選んだなら、Kaname は 404 と E-PAGE-001 を返し、何も書かない"},
        {"status": 409, "code": "E-HND-005", "body": {"error": "conflict", "code": "E-HND-005"}, "errors": ["E-HND-005", "E-HND-150", "E-HND-151"],
         "trigger": "もう決まった渡し（E-HND-005）・同じ会社でグループ（と下のグループ）の外の人を選んだ（E-HND-150）・止まっている人・招待中・閲覧のみ・依頼する側の人を選んだ（E-HND-151）",
         "ears_form": "UNWANTED: IF その渡しがもう決まっているか、選んだ人が担当者にできないなら、Kaname は 409 と E-HND-005／E-HND-150／E-HND-151 を返し、何も書かない"},
    ],
}

# 人を決める口は新しい行を作らず、渡しの行の決めた人を書くだけなので 200（試験 K410-API-013・自分が持つと同じ）
SUCCESS_STATUS = {"claimTicketHandover": 200}
