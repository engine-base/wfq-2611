# K-488 チケットを消す口（deleteTicket）：6 つの表に足す行は無い（DELETE は体を受けない）。
#   問い合わせの値域（children の enum・reason の maxLength・parent_id の uuid）は screen_api.d/K-488.py の QUERY_RANGES に書く（K-468 の仕組み）。
#   登録先の決まり（touch_rules）が住所を求めるので、空の 6 つの表を置く（K-352 と同じ形）
REQUIRED_INPUTS = {}
NO_REQUIRED_INPUTS = {}
PATH_PATTERNS = {}
VALUE_RANGES = {}
UNEXPRESSIBLE_422 = {}
AGENT_ANSWERS = {}
