import os
import json
import hashlib
from typing import List, Dict, Any, Optional

GENESIS_HASH = "0" * 64

class AntibodyLedger:
    def __init__(self, ledger_path: str):
        self.ledger_path = os.path.abspath(ledger_path)

    @staticmethod
    def compute_hash(
        entry_id: str,
        timestamp: str,
        description: str,
        assertion_type: str,
        rejection_assertion: str,
        prev_hash: str
    ) -> str:
        payload = f"{entry_id}|{timestamp}|{description}|{assertion_type}|{rejection_assertion}|{prev_hash}"
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

    def verify(self) -> Dict[str, Any]:
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

            calculated = self.compute_hash(
                entry_id,
                entry.get("timestamp", ""),
                entry.get("description", ""),
                entry.get("assertionType", entry.get("assertion_type", "PREDICATE_JS")),
                entry.get("rejection_assertion", ""),
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

    def append(
        self,
        description: str,
        assertion_type: str,
        rejection_assertion: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        v = self.verify()
        if not v["valid"]:
            raise RuntimeError(f"Cannot append to tampered ledger! Broken at {v.get('broken_at')}: {v.get('reason')}")

        entries = self.read_entries()
        last_hash = entries[-1]["hash"] if entries else GENESIS_HASH
        next_idx = len(entries) + 1
        next_id = f"ABY-{next_idx:04d}"

        import datetime
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        entry_hash = self.compute_hash(
            next_id,
            timestamp,
            description,
            assertion_type,
            rejection_assertion,
            last_hash
        )

        new_entry = {
            "id": next_id,
            "timestamp": timestamp,
            "description": description,
            "assertionType": assertion_type,
            "rejection_assertion": rejection_assertion,
            "context": context or {},
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
