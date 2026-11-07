"""Checks that the training notebook builds from the modules and that every code cell is valid Python.

    python3 -I training/test_notebook.py
"""

import ast
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'kaggle'))

from build_notebook import NOTEBOOK, build, extract  # noqa: E402


class NotebookTests(unittest.TestCase):
    def test_every_code_cell_parses(self):
        notebook = build(180, 60000, 400)
        cells = [c for c in notebook['cells'] if c['cell_type'] == 'code']
        self.assertGreater(len(cells), 15)
        for i, cell in enumerate(cells):
            with self.subTest(cell=i):
                ast.parse(cell['source'])

    def test_cells_carry_the_modules_code(self):
        source = '\n'.join(c['source'] for c in build(180, 60000, 400)['cells'])
        for name in ('def fill_polygon', 'class TrainCrops', 'class UNet', 'def predict_plan', 'def dice_loss', 'def train_worker'):
            self.assertIn(name, source)

    def test_extract_names_what_is_missing(self):
        with self.assertRaises(KeyError):
            extract('model.py', 'NoSuchThing')

    def test_committed_notebook_is_up_to_date(self):
        # Rebuild after changing training/*.py or the builder: python3 -I training/kaggle/build_notebook.py
        with open(NOTEBOOK) as f:
            committed = json.load(f)
        built = build(180, 60000, 400)
        self.assertEqual([c['source'] for c in committed['cells']], [c['source'] for c in built['cells']])


if __name__ == '__main__':
    unittest.main()
