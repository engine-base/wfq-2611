#!/usr/bin/env python3
"""K-638 の契約の試験：認証の口の契約（08_api/openapi.yaml・元は 05_flow/screen_api.py と screen_api.d/K-638.py）が口の振る舞いと同じ形か。
行 ID は K638-SHAPE-NNN（11_tickets/K-638.md の表と 1 対 1）。作り手を回した後の契約を読む。口そのものの答えは apps/api/test/features/F1/pm-fuzz-auth.test.ts。
"""
from __future__ import annotations

import sys
import unittest

sys.path.insert(0, __import__("pathlib").Path(__file__).resolve().parent.as_posix())
from pm_fuzz_contract import fits, response  # noqa: E402

BAD_EMAILS = ["", "   ", "abc", "a@b", "@b.c", "a@@b.c", "0"]


class K638ContractTest(unittest.TestCase):
    def test_K638_SHAPE_001_forgot_email_is_the_shape_the_behaviour_accepts(self) -> None:
        for e in ["a@b.co", " A@B.CO ", "x.y+z@example.com"]:
            self.assertTrue(fits("requestPasswordReset", {"email": e}), e)
        for e in BAD_EMAILS:
            self.assertFalse(fits("requestPasswordReset", {"email": e}), repr(e))
        self.assertFalse(fits("requestPasswordReset", {}))

    def test_K638_SHAPE_002_sign_in_email_is_the_shape_the_behaviour_accepts(self) -> None:
        for e in ["a@b.co", " A@B.CO "]:
            self.assertTrue(fits("signInWithPassword", {"email": e, "password": "pw"}), e)
        for e in BAD_EMAILS:
            self.assertFalse(fits("signInWithPassword", {"email": e, "password": "pw"}), repr(e))

    def test_K638_SHAPE_003_pending_is_not_blank(self) -> None:
        for op, extra in (("requestAdminRecovery", {}), ("verifySignInCode", {"code": "123456"})):
            self.assertTrue(fits(op, {"pending": "p", **extra}), op)
            for p in ["", " ", "\t", "  \n "]:
                self.assertFalse(fits(op, {"pending": p, **extra}), f"{op} {p!r}")
            self.assertFalse(fits(op, extra), f"{op} pending が無い")

    def test_K638_SHAPE_004_verify_takes_exactly_one_of_code_and_backup_code_as_text(self) -> None:
        ok = [{"pending": "p", "code": "123456"}, {"pending": "p", "backup_code": "abcd-efgh"}]
        bad = [
            {"pending": "p"},
            {"pending": "p", "code": "1", "backup_code": "2"},
            {"pending": "p", "code": None},
            {"pending": "p", "backup_code": None},
            {"pending": "p", "code": "1", "backup_code": None},
            {"pending": "p", "code": None, "backup_code": "2"},
            {"pending": "p", "code": 123456},
            {"pending": "p", "code": ""},
            {"pending": "p", "code": "x" * 65},
        ]
        for b in ok:
            self.assertTrue(fits("verifySignInCode", b), b)
        for b in bad:
            self.assertFalse(fits("verifySignInCode", b), b)

    def test_K638_SHAPE_005_reset_declares_409_for_a_missing_link_and_410_only_for_a_spent_one(self) -> None:
        r409, r410 = response("resetPassword", "409"), response("resetPassword", "410")
        self.assertTrue(r409, "409 が契約に無い")
        self.assertIn("E-PAGE-006", r409.get("description", ""))
        self.assertTrue(r410, "410 が契約に無い")
        self.assertNotIn("E-PAGE-006", r410.get("description", ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)
