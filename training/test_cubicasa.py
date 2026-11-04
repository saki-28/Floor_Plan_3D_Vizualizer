"""Checks that the training labels follow the scorer's rules (src/vision/cubicasaSvg.ts, maskScore.ts).

    python3 -I training/test_cubicasa.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from cubicasa import DOOR, WALL, WINDOW, fill_polygon, label_map, parse_svg  # noqa: E402


class LabelTests(unittest.TestCase):
    def test_fill_samples_pixel_centres(self):
        # x 10..20, y 10..15: centres x + 0.5 in [10, 20] are x = 10..19, rows y = 10..14.
        mask = np.zeros((30, 30), np.uint8)
        fill_polygon(mask, np.array([[10, 10], [20, 10], [20, 15], [10, 15]], float), 1)
        ys, xs = np.nonzero(mask)
        self.assertEqual(mask.sum(), 50)
        self.assertEqual((xs.min(), xs.max(), ys.min(), ys.max()), (10, 19, 10, 14))

    def test_fill_half_pixel_edges_and_clipping(self):
        mask = np.zeros((10, 10), np.uint8)
        fill_polygon(mask, np.array([[-5, 2.4], [12, 2.4], [12, 4.6], [-5, 4.6]], float), 1)
        # Rows whose centre lies in [2.4, 4.6]: 2, 3 and 4 (centres 2.5, 3.5, 4.5); every column, clipped.
        self.assertEqual(sorted(set(np.nonzero(mask)[0])), [2, 3, 4])
        self.assertEqual(mask.sum(), 30)

    def test_l_shape_even_odd(self):
        mask = np.zeros((20, 20), np.uint8)
        fill_polygon(mask, np.array([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], float), 1)
        self.assertEqual(mask.sum(), 10 * 4 + 4 * 6)

    def test_svg_takes_first_direct_polygon_of_wall_door_window_groups(self):
        svg = '''<svg width="100" height="80">
          <g id="Wall"><polygon points="0,0 50,0 50,5 0,5"/><polygon points="0,0 99,0 99,79 0,79"/></g>
          <g id="Wall"><g id="Door"><polygon points="20,0 30,0 30,5 20,5"/></g><polygon points="0,10 5,10 5,40 0,40"/></g>
          <g id="Window"><polygon points="40,0 45,0 45,5 40,5"/></g>
          <g id="Space"><polygon points="10,10 90,10 90,70 10,70"/></g>
        </svg>'''
        shapes = parse_svg(svg)
        self.assertEqual(len(shapes['Wall']), 2)  # the second polygon of the first wall is ignored
        self.assertEqual(len(shapes['Door']), 1)
        self.assertEqual(len(shapes['Window']), 1)
        labels = label_map(svg, 100, 80)
        self.assertEqual(int((labels == DOOR).sum()), 50)
        self.assertEqual(int((labels == WINDOW).sum()), 25)
        self.assertEqual(int((labels == WALL).sum()), 250 - 50 - 25 + 5 * 30)  # openings cut out of the wall
        self.assertEqual(int(labels[50, 50]), 0)  # rooms are background


if __name__ == '__main__':
    unittest.main()
