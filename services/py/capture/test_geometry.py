import asyncio
import unittest
import numpy as np
from capture.session import CaptureSession

class GeometryTest(unittest.IsolatedAsyncioTestCase):
    async def test_identical_windows_still_change_capture_target(self):
        session = CaptureSession(8, 16, asyncio.get_running_loop())
        pixels = np.zeros((32, 32, 4), dtype=np.uint8)
        first = {'kind': 'window', 'window_id': 1, 'width': 32, 'height': 32}
        session.on_frame(pixels, first, 'first')
        self.assertEqual((await session.take_batch(10)).geometry['window_id'], 1)
        session.on_frame(pixels.copy(), {**first, 'window_id': 2}, 'second')
        batch = await session.take_batch(10)
        self.assertIsNotNone(batch)
        self.assertEqual(batch.geometry['window_id'], 2)
