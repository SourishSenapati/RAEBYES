import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages", "sdk-python")))

from raebyes import AntibodyLedger, VarianceGuard, RaebyesSpasmError, enforced

class TestRaebyesPython(unittest.TestCase):
    def test_ledger_hash_chain_and_receipts(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            ledger = AntibodyLedger(tmp_dir)

            v0 = ledger.verify_ledger_integrity()
            self.assertTrue(v0["valid"])
            self.assertEqual(v0["total_entries"], 0)

            e1 = ledger.append_antibody(
                component="solver",
                false_claim="Simulated convergence",
                underlying_flaw="Linear approximation shortcut",
                rejection_pattern="is_linear"
            )
            self.assertEqual(e1["id"], "ABY-0001")
            self.assertEqual(len(e1["hash"]), 64)

            # Mint execution receipt
            receipt = ledger.append_run_receipt(
                command="pytest test_solver.py",
                tree_hash="a" * 64,
                stdout_hash="b" * 64,
                duration_ms=2500.0
            )
            self.assertEqual(receipt["run_id"], "RUN-0001")
            self.assertEqual(receipt["status"], "VERIFIED")
            self.assertEqual(len(receipt["proof_hmac"]), 64)

    def test_variance_guard(self):
        r_flat = VarianceGuard.verify([5.0, 5.0, 5.0, 5.0], execution_time_ms=100.0, min_variance=1e-3)
        self.assertFalse(r_flat["passed"])
        self.assertEqual(r_flat["variance"], 0.0)

        r_valid = VarianceGuard.verify([1.0, 4.0, 2.0, 8.0], execution_time_ms=500.0, min_variance=1e-4)
        self.assertTrue(r_valid["passed"])

    def test_enforced_decorator(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
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
