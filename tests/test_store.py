import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from pendu.store import TaskStore

MON = date(2026, 9, 28)
TUE = MON + timedelta(days=1)
WED = MON + timedelta(days=2)


class TaskStoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "notes.json"
        self.store = TaskStore(self.path)

    def tearDown(self):
        self.dir.cleanup()

    def texts(self, day):
        return [t["text"] for t in self.store.tasks_for(day)]

    def test_add_and_persist(self):
        self.store.add("  Call mom  ", TUE, color="pink")
        reloaded = TaskStore(self.path)
        self.assertEqual([t["text"] for t in reloaded.tasks], ["Call mom"])
        self.assertEqual(reloaded.tasks[0]["color"], "pink")

    def test_empty_text_rejected(self):
        with self.assertRaises(ValueError):
            self.store.add("   ", TUE)

    def test_one_off_only_on_its_day_until_done(self):
        self.store.add("Pay bill", MON)
        self.assertEqual(self.texts(MON), ["Pay bill"])
        # Not done on Monday -> carried over to Tuesday.
        self.assertEqual(self.texts(TUE), ["Pay bill"])
        task = self.store.tasks[0]
        self.assertTrue(self.store.is_carried_over(task, TUE))
        # Checked on Tuesday: still visible Tuesday, gone Wednesday.
        self.store.toggle(task["id"], TUE)
        self.assertEqual(self.texts(TUE), ["Pay bill"])
        self.assertTrue(self.store.is_done(task, TUE))
        self.assertEqual(self.texts(WED), [])

    def test_one_off_done_on_its_day_disappears_next_day(self):
        task = self.store.add("Gym", MON)
        self.store.toggle(task["id"], MON)
        self.assertEqual(self.texts(TUE), [])

    def test_future_task_not_shown_early(self):
        self.store.add("Dentist", WED)
        self.assertEqual(self.texts(TUE), [])

    def test_daily_task_resets_every_day(self):
        task = self.store.add("Drink water", MON, daily=True)
        self.store.toggle(task["id"], MON)
        self.assertTrue(self.store.is_done(task, MON))
        self.assertFalse(self.store.is_done(task, TUE))
        self.assertEqual(self.texts(TUE), ["Drink water"])
        self.store.toggle(task["id"], MON)
        self.assertFalse(self.store.is_done(task, MON))

    def test_open_tasks_sorted_before_done(self):
        a = self.store.add("A", TUE, now="2026-09-29T08:00:00")
        self.store.add("B", TUE, now="2026-09-29T09:00:00")
        self.store.toggle(a["id"], TUE)
        self.assertEqual(self.texts(TUE), ["B", "A"])
        self.assertEqual(self.store.progress(TUE), (1, 2))

    def test_clear_done_keeps_daily_and_open(self):
        a = self.store.add("A", TUE)
        self.store.add("B", TUE)
        d = self.store.add("D", TUE, daily=True)
        self.store.toggle(a["id"], TUE)
        self.store.toggle(d["id"], TUE)
        self.store.clear_done(TUE)
        self.assertEqual(sorted(self.texts(TUE)), ["B", "D"])

    def test_edit_and_delete(self):
        task = self.store.add("Old", TUE)
        self.store.edit(task["id"], text="New", color="blue", daily=True)
        self.assertEqual(self.store.get(task["id"])["text"], "New")
        self.assertTrue(self.store.get(task["id"])["daily"])
        self.store.delete(task["id"])
        self.assertEqual(self.store.tasks, [])

    def test_settings_persist(self):
        self.store.settings["autostart_offered"] = True
        self.store.save()
        self.assertTrue(TaskStore(self.path).settings["autostart_offered"])

    def test_broken_file_is_backed_up(self):
        self.path.write_text("{not json", encoding="utf-8")
        store = TaskStore(self.path)
        self.assertEqual(store.tasks, [])
        self.assertTrue(self.path.with_suffix(".broken.json").exists())

    def test_file_format(self):
        self.store.add("X", TUE)
        data = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], 1)
        self.assertEqual(len(data["tasks"]), 1)


if __name__ == "__main__":
    unittest.main()
