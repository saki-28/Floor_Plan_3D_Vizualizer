"""Plans the model never trains on: CVC-FP (de las Heras et al., 2015; CC BY-NC 4.0), 121 scanned plans in four styles.

The Kaggle copy (asutoshprad/floor-plan-dataset) keeps each scan as X/<n>.png and its labels as a colour picture "Y/<n> (2).png",
shifted against the scan by a different amount on every plan. `cvcfp_truth` lines the labels up with the scan's ink
(cross-correlation) and turns them into our classes. 25 plans are left out, the same as in the app's baseline
(data/heldout-eval/baseline-run2.json): 18 whose labels cover only part of the page in this copy, 3 whose walls are unlabelled or
do not line up, and 4 that the app's own image reader cannot open. Scoring matches the browser: the scan is shrunk to a longest
side of 1,600 px and predicted in 512 px tiles.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

from cubicasa import DOOR, WALL, WINDOW, ink
from model import predict_plan

CVCFP_COLOURS = {WALL: (248, 216, 175), DOOR: (0, 186, 139), WINDOW: (15, 189, 246)}  # as OpenCV reads them: blue, green, red
CVCFP_EXCLUDED = {str(n) for n in range(100, 122)} | {'70', '72', '74'}


def cvcfp_plans(root: str) -> list[str]:
    """The plan numbers that are scored, in order."""
    names = [f[:-4] for f in os.listdir(os.path.join(root, 'X')) if f.endswith('.png')]
    return sorted((n for n in names if n not in CVCFP_EXCLUDED and os.path.exists(os.path.join(root, 'Y', f'{n} (2).png'))), key=int)


def _best_shift(gray: np.ndarray, structure: np.ndarray, factor: int = 4) -> tuple[int, int]:
    small = lambda m: cv2.resize(m.astype(np.float32), None, fx=1 / factor, fy=1 / factor, interpolation=cv2.INTER_AREA)
    a, b = small(255 - gray) / 255, small(structure)
    a -= a.mean()
    b -= b.mean()
    corr = np.fft.irfft2(np.fft.rfft2(a) * np.conj(np.fft.rfft2(b)), s=a.shape)
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    y = y - a.shape[0] if y > a.shape[0] // 2 else y
    x = x - a.shape[1] if x > a.shape[1] // 2 else x
    return int(x * factor), int(y * factor)


def _shifted(classes: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.zeros_like(classes)
    h, w = classes.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = classes[ys, xs]
    return out


def cvcfp_truth(root: str, plan: str, max_side: int = 1600) -> tuple[np.ndarray, np.ndarray]:
    """A plan's scan (grey, white paper) and its lined-up class map, both shrunk to a longest side of max_side."""
    scan = cv2.imread(os.path.join(root, 'X', f'{plan}.png'), cv2.IMREAD_UNCHANGED)
    if scan.ndim == 3 and scan.shape[2] == 4:  # transparent paper is white
        alpha = scan[:, :, 3:4].astype(np.float32) / 255
        scan = np.rint(scan[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    gray = scan if scan.ndim == 2 else cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY)
    picture = cv2.imread(os.path.join(root, 'Y', f'{plan} (2).png'))
    classes = np.zeros(picture.shape[:2], np.uint8)
    for value, colour in CVCFP_COLOURS.items():
        classes[np.abs(picture.astype(int) - np.array(colour)).sum(2) < 60] = value
    if classes.shape != gray.shape:
        classes = cv2.resize(classes, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_NEAREST)
    truth = _shifted(classes, *_best_shift(gray, classes > 0))
    scale = min(1.0, max_side / max(gray.shape))
    if scale < 1:
        size = (round(gray.shape[1] * scale), round(gray.shape[0] * scale))
        gray = cv2.resize(gray, size, interpolation=cv2.INTER_AREA)
        truth = cv2.resize(truth, size, interpolation=cv2.INTER_NEAREST)
    return gray, truth


def score_cvcfp(net, root: str, device, plans: list[str]) -> list[dict]:
    """Wall IoU, precision and recall, and door + window IoU, of each plan, predicted as the browser does."""
    rows = []
    for plan in plans:
        gray, truth = cvcfp_truth(root, plan)
        pred = predict_plan(net, ink(gray), device, tile=512, margin=96)
        found, real = pred == WALL, truth == WALL
        both, nf, nt = np.count_nonzero(found & real), np.count_nonzero(found), np.count_nonzero(real)
        o_found, o_real = pred >= DOOR, truth >= DOOR
        o_union = np.count_nonzero(o_found | o_real)
        rows.append({'plan': plan, 'iou': both / (nf + nt - both) if nf + nt - both else 1.0, 'precision': both / nf if nf else 0.0,
                     'recall': both / nt if nt else 0.0, 'openings_iou': np.count_nonzero(o_found & o_real) / o_union if o_union else None})
    return rows
