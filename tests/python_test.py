import os
import sys
import tempfile
import unittest

# Insert python sdk into path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages", "sdk-python")))

from raebyes import AntibodyLedger, VarianceGuard, RaebyesSpasmError, enforced

class TestRaebyesPython(unittest.TestCase):
    def test_ledger_hash_chain_and_tamper(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            ledger_path = os.path.join(tmp_dir, "antibodies.json")
            ledger = AntibodyLedger(ledger_path)

            v0 = ledger.verify()
            self.assertTrue(v0["valid"])
            self.assertEqual(v0["total_entries"], 0)

            # Append entry 1
            e1 = ledger.append(
                description="Reject linear approximations",
                assertion_type="PREDICATE_JS",
                rejection_assertion="assert res.is_linear is False"
            )
            self.assertEqual(e1["id"], "ABY-0001")
            self.assertEqual(e1["prev_hash"], "0" * 64)
            self.assertEqual(len(e1["hash"]), 64)

            # Append entry 2
            e2 = ledger.append(
                description="Whistles constraint",
                assertion_type="VARIANCE_RULE",
                rejection_assertion="assert res.untreated_whistles >= 12"
            )
            self.assertEqual(e2["id"], "ABY-0002")
            self.assertEqual(e2["prev_hash"], e1["hash"])

            # Verify chain
            v1 = ledger.verify()
            self.assertTrue(v1["valid"])
            self.assertEqual(v1["total_entries"], 2)

            # Tamper test
            import json
            with open(ledger_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data[0]["description"] = "TAMPERED BY AGENT"
            with open(ledger_path, "w", encoding="utf-8") as f:
                json.dump(data, f)

            v_tamper = ledger.verify()
            self.assertFalse(v_tamper["valid"])
            self.assertEqual(v_tamper["broken_at"], "ABY-0001")

    def test_variance_guard(self):
        # Flat list variance = 0
        r_flat = VarianceGuard.verify([5.0, 5.0, 5.0, 5.0], execution_time_ms=100.0, min_variance=1e-3)
        self.assertFalse(r_flat["passed"])
        self.assertEqual(r_flat["variance"], 0.0)

        # Valid variance and execution time
        r_valid = VarianceGuard.verify([1.0, 4.0, 2.0, 8.0], execution_time_ms=500.0, min_variance=1e-4, min_execution_time_ms=100.0)
        self.assertTrue(r_valid["passed"])
        self.assertGreater(r_valid["variance"], 0.0)

    def test_enforced_decorator(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Valid solver
            @enforced(
                id="TEST-SOLVER",
                invariants=[lambda res: res["untreated_whistles"] >= 12],
                min_variance=0.01,
                mode="THROW_ERROR",
                workspace_dir=tmp_dir
            )
            def run_sim():
                return {"untreated_whistles": 15, "values": [1.0, 2.0, 3.0]}

            res = run_sim()
            self.assertEqual(res["untreated_whistles"], 15)

            # Cheating solver violating invariants
            @enforced(
                id="CHEAT-SOLVER",
                invariants=[lambda res: res["untreated_whistles"] >= 12],
                mode="THROW_ERROR",
                workspace_dir=tmp_dir
            )
            def run_cheat():
                return {"untreated_whistles": 4, "values": [0, 0, 0]}

            with self.assertRaises(RaebyesSpasmError):
                run_cheat()

if __name__ == "__main__":
    unittest.main()
