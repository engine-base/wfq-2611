# K-441 つながりの口（createTicketLink）の契約の形の表に足す分（K-325 の断片）
#   読む口・外す口は体を受けない（GET・DELETE）ので、どの表にも載せない。形の決まり（欄が無い・kind が 2 つ以外・uuid でない）は全部契約に書いた。
#   決まりは全部 REQUIRED_INPUTS と VALUE_RANGES で契約に書けるので、契約に書けない値の決まり（UNEXPRESSIBLE_422）は無い（控え帳 2026-11-20 16:51・answer=431fc50df51b）
REQUIRED_INPUTS = {
    "createTicketLink": {"other_ticket_id", "kind"},   # apps/api/src/features/F4/ticket-links/hooks.ts（無ければ 422・欄ごと）
}
NO_REQUIRED_INPUTS = {}
PATH_PATTERNS = {}
VALUE_RANGES = {
    "createTicketLink": {"kind": {"enum": ["related", "derived_from"]}},
}
UNEXPRESSIBLE_422 = {}
AGENT_ANSWERS = {}
