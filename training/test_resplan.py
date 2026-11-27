"""Checks the ResPlan renderer on a small hand-made plan (no ResPlan file needed).

    python3 -I training/test_resplan.py
"""

import os
import sys
import time
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cubicasa import DOOR, WALL, WINDOW  # noqa: E402
from resplan import MixedCrops, compact_plan, render_plan  # noqa: E402


def box(x0, y0, x1, y1):
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], np.float32)


def sample_plan() -> dict:
    """A 6 × 4 m flat in metres: an outer wall ring 0.2 m thick, a dividing wall with a door, a window in the top wall."""
    return {
        'id': 'test',
        'wall': [[box(-0.1, -0.1, 6.1, 4.1), box(0.1, 0.1, 5.9, 3.9)], [box(2.9, 0.1, 3.1, 3.9)]],
        'door': [[box(2.9, 1.5, 3.1, 2.4)]],
        'window': [[box(1.0, -0.1, 2.2, 0.1)]],
        'rooms': [('living', [box(0.1, 0.1, 2.9, 3.9)]), ('bedroom', [box(3.1, 0.1, 5.9, 3.9)])],
        'balcony': [],
        'stair': [],
        'thickness': 0.2,
    }


class Ring:
    def __init__(self, pts):
        self.coords = pts


class FakePolygon:
    """Just enough of a Shapely Polygon for compact_plan."""
    geom_type = 'Polygon'
    is_empty = False

    def __init__(self, outline, holes=()):
        self.exterior, self.interiors = Ring(outline), [Ring(h) for h in holes]


class FakeMulti:
    is_empty = False

    def __init__(self, *parts):
        self.geoms = parts


class RenderTests(unittest.TestCase):
    def test_every_style_labels_walls_doors_and_windows(self):
        plan = sample_plan()
        for seed in range(60):
            with self.subTest(seed=seed):
                gray, labels = render_plan(plan, np.random.default_rng(seed))
                self.assertEqual(gray.shape, labels.shape)
                self.assertEqual(gray.dtype, np.uint8)
                counts = np.bincount(labels.ravel(), minlength=4)
                self.assertTrue(counts[WALL] > 0 and counts[DOOR] > 0 and counts[WINDOW] > 0, counts)
                self.assertEqual(counts[4:].sum() if len(counts) > 4 else 0, 0)

    def test_walls_come_out_4_to_18_pixels_thick(self):
        plan = sample_plan()
        for seed in range(30):
            _, labels = render_plan(plan, np.random.default_rng(seed))
            # The outer wall's thickness at mid-height of the left side.
            row = labels[labels.shape[0] // 2]
            run = np.flatnonzero(row == WALL)
            first = run[: np.argmax(np.diff(run) > 1) + 1] if np.any(np.diff(run) > 1) else run
            self.assertTrue(3 <= len(first) <= 20, (seed, len(first)))

    def test_every_wall_edge_is_drawn_in_ink(self):
        plan = sample_plan()
        for seed in range(60):
            with self.subTest(seed=seed):
                gray, labels = render_plan(plan, np.random.default_rng(seed))
                wall = (labels == WALL).astype(np.uint8)
                edge = (wall > 0) & (cv2.erode(wall, np.ones((3, 3), np.uint8)) == 0)
                ink = cv2.dilate((gray < 200).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2)
                self.assertGreater(ink[edge].mean(), 0.8)

    def test_door_and_window_gaps_are_not_solid_wall(self):
        plan = sample_plan()
        paper = []
        for seed in range(60):
            gray, labels = render_plan(plan, np.random.default_rng(seed))
            # Inside a door gap only the leaf, and now and then a room name, cross the paper.
            paper.append((gray[labels == DOOR] > 200).mean())
        self.assertGreater(np.mean(paper), 0.7)
        self.assertGreater(min(paper), 0.3)

    def test_a_shapely_plan_is_compacted(self):
        outline = [(0, 0), (6, 0), (6, 4), (0, 4), (0, 0)]
        hole = [(0.2, 0.2), (5.8, 0.2), (5.8, 3.8), (0.2, 3.8), (0.2, 0.2)]
        plan = {'id': 7, 'wall': FakeMulti(FakePolygon(outline, [hole])), 'door': FakePolygon([(1, 0), (2, 0), (2, 0.2), (1, 0.2)]),
                'window': None, 'front_door': FakeMulti(), 'bedroom': FakePolygon(hole)}
        c = compact_plan(plan)
        self.assertEqual(len(c['wall']), 1)
        self.assertEqual(len(c['wall'][0]), 2, 'outline and hole')
        self.assertEqual(len(c['door']), 1)
        self.assertEqual(c['window'], [])
        self.assertEqual([k for k, _ in c['rooms']], ['bedroom'])
        self.assertAlmostEqual(c['thickness'], 0.2, delta=0.02)
        self.assertIsNone(compact_plan({'wall': None}))


class StubCrops:
    size, per_plan = 128, 2

    def __len__(self):
        return 30

    def __getitem__(self, i):
        return np.zeros((2, 1, 128, 128), np.float32), np.zeros((2, 128, 128), np.int64)


class MixTests(unittest.TestCase):
    def test_share_of_items_are_drawn_plans(self):
        mixed = MixedCrops(StubCrops(), [sample_plan()], share=0.4)
        self.assertEqual(len(mixed), 30 + 20)
        x, y = mixed[45]
        self.assertEqual(x.shape, (2, 1, 128, 128))
        self.assertEqual(y.shape, (2, 128, 128))
        self.assertGreater(x.max(), 0.3, 'a drawn crop has ink')
        self.assertEqual(len(MixedCrops(StubCrops(), [], share=0.4)), 30)

    def test_drawing_is_quick(self):
        plan = sample_plan()
        rng = np.random.default_rng(0)
        started = time.time()
        for _ in range(20):
            render_plan(plan, rng)
        self.assertLess((time.time() - started) / 20, 0.25)


if __name__ == '__main__':
    unittest.main()
