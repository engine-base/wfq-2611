# K-433 本文を版に戻す口（restoreTicketVersion）の契約の形の表に足す分（K-325 の断片）
#   口は apps/api/src/features/F4/versions/input.ts の checkRestore。screen_api.d/K-433.py の REQUIRED_INPUTS・VALUE_RANGES と同じ 1 つ

REQUIRED_INPUTS = {"restoreTicketVersion": {"current_version"}}
VALUE_RANGES = {
    "restoreTicketVersion": {"current_version": {"minimum": 1}},
}
UNEXPRESSIBLE_422: dict = {}   # 登録先の決まりが住所を求めるので置く
