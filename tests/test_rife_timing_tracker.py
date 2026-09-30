"""Exercise the graph's timing tracker without loading Python/VS/GPU DLLs."""
import ast
from fractions import Fraction
from pathlib import Path
from threading import Event, RLock, Thread, local
import unittest


class TimingTrackerTests(unittest.TestCase):
    def test_concurrent_duplicate_source_duration_is_counted_once(self):
        path = Path(__file__).resolve().parents[1] / 'resources/mpv/rife/trt_pipeline.py'
        source = ast.parse(path.read_text(encoding='utf-8'))
        tracker = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'CfrTiming')
        namespace = {'RLock': RLock}
        exec(compile(ast.Module(body=[tracker], type_ignores=[]), str(path), 'exec'), namespace)
        timing = namespace['CfrTiming'](Fraction(30))
        entered, release = Event(), Event()
        calls = local()
        results = []
        class PausedDuration(Fraction):
            def __sub__(self, value):
                calls.n = getattr(calls, 'n', 0) + 1
                if calls.n == 2:
                    entered.set()
                    release.wait(3)
                return super().__sub__(value)
        duration = PausedDuration(34, 1000)
        first = Thread(target=lambda: results.append(timing.accept(0, duration)))
        second = Thread(target=lambda: results.append(timing.accept(0, duration)))
        first.start()
        try:
            self.assertTrue(entered.wait(2))
            second.start()
            # The first callback is paused after taking the pending item.
            # A second callback must wait until that complete update finishes.
            second.join(.1)
        finally:
            release.set()
            first.join(3)
            if second.ident:
                second.join(3)
        self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual(results, [True, True])
        self.assertEqual(timing.next, 1)
        self.assertEqual(timing.count, 1)
        self.assertAlmostEqual(timing.error, float(duration - Fraction(1, 30)))


if __name__ == '__main__':
    unittest.main()
