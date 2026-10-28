import unittest
from unittest.mock import Mock, patch

from capture.sources import WgcSource


class WindowResizeTest(unittest.TestCase):
    def source(self, follow=False):
        source = WgcSource({'follow_active_window': True} if follow else {'window_id': 42}, 100)
        source._hwnd = 42
        source._window_size = (800, 600)
        source.restart = Mock()
        return source

    @patch('capture.sources.win32.window_frame', return_value=(200, 100, 900, 700))
    def test_fixed_window_resize_reopens_frame_pool(self, frame):
        source = self.source()
        source._check_window()
        source.restart.assert_called_once()

    @patch('capture.sources.win32.window_frame', return_value=(200, 100, 800, 600))
    def test_moving_window_keeps_capture(self, frame):
        source = self.source()
        source._check_window()
        source.restart.assert_not_called()

    @patch('capture.sources.win32.window_frame', return_value=(0, 0, 800, 600))
    def test_switching_target_with_same_size_reopens(self, frame):
        source = self.source(follow=True)
        source._pick_foreground = Mock(return_value=77)
        source._check_window()
        self.assertEqual(source._hwnd, 77)
        source.restart.assert_called_once()

    @patch('capture.sources.win32.window_frame', return_value=(0, 0, 900, 700))
    def test_stopped_source_does_not_restart(self, frame):
        source = self.source()
        source._stopping = True
        source._check_window()
        source.restart.assert_not_called()
        frame.assert_not_called()

    @patch('capture.sources.win32.window_frame', return_value=None)
    def test_missing_window_is_left_to_close_handler(self, frame):
        source = self.source()
        source._check_window()
        source.restart.assert_not_called()
