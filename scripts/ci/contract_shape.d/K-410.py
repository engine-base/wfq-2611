# K-410 人を決める口（claimTicketHandover）の契約の形の表に足す分（K-325 の断片）
# apps/api/src/features/F8/handovers/claim.ts（member_id は必須の uuid・知らない欄は 422）
REQUIRED_INPUTS = {
    "claimTicketHandover": {"member_id"},
}
