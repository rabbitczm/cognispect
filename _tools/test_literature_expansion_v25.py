import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LiteratureExpansionV25(unittest.TestCase):
    def test_fixed_literature_index_reaches_twenty_thousand_unique_records(self):
        path = ROOT / "data/literature-expansion-v25.json"
        self.assertTrue(path.is_file(), "the verified expansion index must be generated")
        index = json.loads(path.read_text(encoding="utf-8"))
        records = index["records"]
        self.assertGreaterEqual(len(records), 20_000)
        self.assertEqual(len({row["key"] for row in records}), len(records))
        self.assertTrue(all(row.get("source_url") and row.get("source_checked_at") for row in records))
        for identifier in ("pmid", "doi"):
            values = [row[identifier].casefold() for row in records if row.get(identifier)]
            self.assertEqual(len(values), len(set(values)))


if __name__ == "__main__":
    unittest.main()
