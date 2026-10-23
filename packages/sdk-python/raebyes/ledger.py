import os
import json
import hashlib
import hmac
import datetime
from typing import List, Dict, Any, Optional

GENESIS_HASH = "0" * 64
HMAC_SECRET = os.environ.get("RAEBYES_SECRET", "RAEBYES_DETERMINISTIC_PROOF_KEY_2026")

class AntibodyLedger:
    def __init__(self, workspace_dir: str):
        raebyes_dir = os.path.join(os.path.abspath(workspace_dir), ".raebyes")
        self.ledger_path = os.path.join(raebyes_dir, "antibodies.json")
        self.runs_lock_path = os.path.join(raebyes_dir, "runs.lock")

    @staticmethod
    def compute_entry_hash(
        entry_id: str,
        timestamp: str,
        component: str,
        false_claim: str,
        underlying_flaw: str,
        rejection_pattern: str,
        prev_hash: str
    ) -> str:
        payload = f"{entry_id}{timestamp}{component}{false_claim}{underlying_flaw}{rejection_pattern}{prev_hash}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def read_entries(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.ledger_path):
            return []
        try:
            with open(self.ledger_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception as e:
            raise RuntimeError(f"Corrupted antibodies ledger at {self.ledger_path}: {e}")

    def verify_ledger_integrity(self) -> Dict[str, Any]:
        entries = self.read_entries()
        if not entries:
            return {"valid": True, "total_entries": 0}

        expected_prev = GENESIS_HASH
        for entry in entries:
            entry_id = entry.get("id", "UNKNOWN")
            prev_hash = entry.get("prev_hash", "")
            current_hash = entry.get("hash", "")

            if prev_hash != expected_prev:
                return {
                    "valid": False,
                    "total_entries": len(entries),
                    "broken_at": entry_id,
                    "reason": f"Mismatched prev_hash: expected {expected_prev[:8]}..., got {prev_hash[:8]}..."
                }

            calculated = self.compute_entry_hash(
                entry_id,
                entry.get("timestamp", ""),
                entry.get("component", "core"),
                entry.get("false_claim", ""),
                entry.get("underlying_flaw", ""),
                entry.get("rejection_pattern", entry.get("rejection_assertion", "")),
                prev_hash
            )

            if current_hash != calculated:
                return {
                    "valid": False,
                    "total_entries": len(entries),
                    "broken_at": entry_id,
                    "reason": f"Tampered entry hash at {entry_id}: calculated {calculated[:8]}..., stored {current_hash[:8]}..."
                }

            expected_prev = current_hash

        return {"valid": True, "total_entries": len(entries)}

    def append_antibody(
        self,
        component: str,
        false_claim: str,
        underlying_flaw: str,
        rejection_pattern: str
    ) -> Dict[str, Any]:
        v = self.verify_ledger_integrity()
        if not v["valid"]:
            raise RuntimeError(f"CONTAINMENT_BREACH: Cannot append to tampered ledger broken at {v.get('broken_at')}: {v.get('reason')}")

        entries = self.read_entries()
        last_hash = entries[-1]["hash"] if entries else GENESIS_HASH
        next_idx = len(entries) + 1
        next_id = f"ABY-{next_idx:04d}"
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        entry_hash = self.compute_entry_hash(
            next_id,
            timestamp,
            component,
            false_claim,
            underlying_flaw,
            rejection_pattern,
            last_hash
        )

        new_entry = {
            "id": next_id,
            "timestamp": timestamp,
            "component": component,
            "false_claim": false_claim,
            "underlying_flaw": underlying_flaw,
            "rejection_pattern": rejection_pattern,
            "prev_hash": last_hash,
            "hash": entry_hash
        }

        entries.append(new_entry)
        os.makedirs(os.path.dirname(self.ledger_path), exist_ok=True)

        temp_path = f"{self.ledger_path}.tmp.{os.getpid()}"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2)
        os.replace(temp_path, self.ledger_path)

        return new_entry

    def read_run_receipts(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.runs_lock_path):
            return []
        try:
            with open(self.runs_lock_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception:
            return []

    def append_run_receipt(
        self,
        command: str,
        tree_hash: str,
        stdout_hash: str,
        duration_ms: float,
        status: str = "VERIFIED"
    ) -> Dict[str, Any]:
        receipts = self.read_run_receipts()
        next_idx = len(receipts) + 1
        run_id = f"RUN-{next_idx:04d}"
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        payload = f"{run_id}{tree_hash}{stdout_hash}".encode("utf-8")
        proof_hmac = hmac.new(HMAC_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()

        receipt = {
            "run_id": run_id,
            "timestamp": timestamp,
            "command": command,
            "tree_hash": tree_hash,
            "stdout_hash": stdout_hash,
            "duration_ms": duration_ms,
            "proof_hmac": proof_hmac,
            "status": status
        }

        receipts.append(receipt)
        os.makedirs(os.path.dirname(self.runs_lock_path), exist_ok=True)

        temp_path = f"{self.runs_lock_path}.tmp.{os.getpid()}"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(receipts, f, indent=2)
        os.replace(temp_path, self.runs_lock_path)

        return receipt
