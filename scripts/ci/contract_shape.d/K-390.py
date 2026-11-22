# K-390 決定を足す口（createTicketDecision）。読む口は体を受けない GET なので足す行は無い
#   text は必須・空・空白・制御文字だけは入口の pattern で断る（形の決まり・K-391 と同じ式）。
#   決めた人・元の書き込みが指す物の有無は 404、取引先のルールにするのは 409（DB の中身・今の状態で決まる物は 422 にしない・代表の答え answer=f0f290e785a9：検査の例外は足さない）
REQUIRED_INPUTS = {"createTicketDecision": {"text"}}
NO_REQUIRED_INPUTS = {}
PATH_PATTERNS = {}
_NOT_BLANK = "[^\\s\\u0000-\\u001f\\u007f]"
VALUE_RANGES = {"createTicketDecision": {"text": {"pattern": _NOT_BLANK}, "promoted_to": {"enum": ["ticket", "client_rule"]}}}
UNEXPRESSIBLE_422 = {}   # 決まりは全部 VALUE_RANGES で契約に書いた（代表の答え answer=f0f290e785a9）
AGENT_ANSWERS = {}
