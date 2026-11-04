"""CubiCasa5k for training the wall model: labels, plan lists and random training crops.

Labels are read from each plan's model.svg exactly as src/vision/cubicasaSvg.ts reads them (the
first direct <polygon> of every <g id="Wall|Door|Window">, points used as pixels of F1_scaled.png
with no scaling) and drawn as one class map per plan:

    0 background · 1 wall · 2 door · 3 window

Doors and windows are drawn over walls, so class 1 is "wall minus openings", the same truth the
TypeScript scorer (scripts/evaluate-cubicasa.ts) uses.
"""

from __future__ import annotations

import os
import re
import struct
from multiprocessing import Pool

import cv2
import numpy as np

BACKGROUND, WALL, DOOR, WINDOW = 0, 1, 2, 3
CLASSES = ('background', 'wall', 'door', 'window')

_TAG = re.compile(r'<(/?)(g|polygon)\b([^>]*?)(/?)>')


def _attribute(name: str, text: str) -> str | None:
    m = re.search(rf'\b{name}\s*=\s*"([^"]*)"', text)
    return m.group(1) if m else None


def _points(text: str) -> np.ndarray:
    pts = []
    for pair in text.split():
        xy = pair.split(',')
        if len(xy) != 2:
            continue
        try:
            x, y = float(xy[0]), float(xy[1])
        except ValueError:
            continue
        if np.isfinite(x) and np.isfinite(y):
            pts.append((x, y))
    return np.array(pts, dtype=np.float64).reshape(-1, 2)


def parse_svg(svg: str) -> dict[str, list[np.ndarray]]:
    """Wall, Door and Window polygons of a CubiCasa5k model.svg (see cubicasaSvg.ts)."""
    found: dict[str, list[np.ndarray]] = {'Wall': [], 'Door': [], 'Window': []}
    stack: list[list] = []  # [id, first polygon taken]
    for m in _TAG.finditer(svg):
        closing, tag, attributes, self_closing = m.groups()
        if tag == 'g':
            if closing:
                if stack:
                    stack.pop()
            elif not self_closing:
                stack.append([_attribute('id', attributes) or '', False])
            continue
        if closing or not stack or stack[-1][1]:
            continue
        parent = stack[-1]
        if parent[0] not in found:
            continue
        pts = _points(_attribute('points', attributes) or '')
        if len(pts) >= 3:
            found[parent[0]].append(pts)
        parent[1] = True
    return found


def png_size(path: str) -> tuple[int, int]:
    """(width, height) from a PNG's header, without decoding the image."""
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        return img.shape[1], img.shape[0]
    return struct.unpack('>II', head[16:24])


def fill_polygon(mask: np.ndarray, pts: np.ndarray, value: int) -> None:
    """Fills a polygon exactly as fillPolygon in src/vision/maskScore.ts does: scanlines through pixel
    centres, even-odd rule, a pixel filled when its centre lies between a pair of crossings."""
    h, w = mask.shape
    if len(pts) < 3:
        return
    y0, y1 = max(0, int(np.floor(pts[:, 1].min()))), min(h - 1, int(np.ceil(pts[:, 1].max())))
    bx0, bx1 = max(0, int(np.floor(pts[:, 0].min()))), min(w - 1, int(np.ceil(pts[:, 0].max())))
    if y1 < y0 or bx1 < bx0:
        return
    cy = np.arange(y0, y1 + 1, dtype=np.float64)[:, None] + 0.5
    xi, yi = pts[:, 0][None], pts[:, 1][None]
    xj, yj = np.roll(pts[:, 0], 1)[None], np.roll(pts[:, 1], 1)[None]  # the previous point, as in the TS loop
    crosses = (yi > cy) != (yj > cy)
    with np.errstate(divide='ignore', invalid='ignore'):
        xc = np.where(crosses, xi + (cy - yi) * (xj - xi) / (yj - yi), np.inf)
    xc.sort(axis=1)
    pairs = xc.shape[1] // 2
    a, b = xc[:, 0:2 * pairs:2], xc[:, 1:2 * pairs:2]
    ok = np.isfinite(a) & np.isfinite(b)
    xa = np.clip(np.ceil(np.where(ok, a, 0) - 0.5), 0, w).astype(np.int64)
    xb = np.clip(np.floor(np.where(ok, b, 0) - 0.5), -1, w - 1).astype(np.int64)
    ok &= xb >= xa
    if not ok.any():
        return
    rows = np.broadcast_to(np.arange(cy.shape[0])[:, None], a.shape)[ok]
    span = bx1 - bx0 + 1
    diff = np.zeros((cy.shape[0], span + 1), np.int32)
    np.add.at(diff, (rows, xa[ok] - bx0), 1)
    np.add.at(diff, (rows, xb[ok] - bx0 + 1), -1)
    inside = np.cumsum(diff, axis=1)[:, :span] > 0
    mask[y0:y1 + 1, bx0:bx1 + 1][inside] = value


def label_map(svg: str, width: int, height: int) -> np.ndarray:
    """The class map of one plan, on the pixel grid of its F1_scaled.png."""
    shapes = parse_svg(svg)
    labels = np.zeros((height, width), np.uint8)
    for name, value in (('Wall', WALL), ('Door', DOOR), ('Window', WINDOW)):
        for pts in shapes[name]:
            fill_polygon(labels, pts, value)
    return labels


def read_split(root: str, split: str) -> list[str]:
    """Plan folders (relative to root, like 'high_quality_architectural/1191') of a split list."""
    with open(os.path.join(root, f'{split}.txt')) as f:
        return [line.strip().strip('/') for line in f if line.strip()]


def plan_name(plan: str) -> str:
    return plan.replace('/', '_')


def _prepare_one(job: tuple[str, str, str]) -> int:
    root, plan, out_dir = job
    target = os.path.join(out_dir, plan_name(plan) + '.png')
    if os.path.exists(target):
        return 0
    folder = os.path.join(root, plan)
    width, height = png_size(os.path.join(folder, 'F1_scaled.png'))
    with open(os.path.join(folder, 'model.svg'), encoding='utf-8') as f:
        labels = label_map(f.read(), width, height)
    cv2.imwrite(target, labels)
    return 1


def prepare_labels(root: str, out_dir: str, splits=('train', 'val', 'test'), workers: int | None = None) -> int:
    """Draws every plan's class map once into out_dir/<plan_name>.png. Returns how many were made."""
    os.makedirs(out_dir, exist_ok=True)
    jobs = [(root, plan, out_dir) for split in splits for plan in read_split(root, split)]
    with Pool(workers or os.cpu_count()) as pool:
        return sum(pool.imap_unordered(_prepare_one, jobs, chunksize=16))


def ink(gray: np.ndarray) -> np.ndarray:
    """Model input: 0 for white paper, 1 for black ink (so zero padding reads as paper)."""
    return 1.0 - gray.astype(np.float32) / 255.0


class TrainCrops:
    """Random training crops from whole plans: a few per plan load, with scale, rotation and scan-noise augmentation.

    Used as a torch Dataset (it has __len__ and __getitem__); returns (x [K,1,S,S] float32, y [K,S,S] int64).
    """

    def __init__(self, root: str, labels_dir: str, plans: list[str], size: int = 512, per_plan: int = 4, augment: bool = True):
        self.items = [(os.path.join(root, p, 'F1_scaled.png'), os.path.join(labels_dir, plan_name(p) + '.png')) for p in plans]
        self.size, self.per_plan, self.augment = size, per_plan, augment

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, i: int):
        image_path, label_path = self.items[i]
        gray = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        labels = cv2.imread(label_path, cv2.IMREAD_UNCHANGED)
        rng = np.random.default_rng()
        xs, ys = zip(*(self._crop(gray, labels, rng) for _ in range(self.per_plan)))
        return np.stack(xs)[:, None], np.stack(ys).astype(np.int64)

    def _crop(self, gray: np.ndarray, labels: np.ndarray, rng: np.random.Generator):
        h, w = gray.shape
        s = self.size
        scale = float(np.exp(rng.uniform(np.log(0.7), np.log(1.4)))) if self.augment else 1.0
        r = max(32, int(round(s / scale)))  # side of the region taken from the plan

        # Centre: most of the time on a wall, door or window pixel, so crops are not mostly paper.
        cy, cx = rng.integers(0, h), rng.integers(0, w)
        if rng.random() < 0.7:
            py, px = rng.integers(0, h, 96), rng.integers(0, w, 96)
            hit = np.flatnonzero(labels[py, px] > 0)
            if hit.size:
                cy, cx = py[hit[0]], px[hit[0]]
        y0 = int(cy - r // 2 + rng.integers(-r // 4, r // 4 + 1))
        x0 = int(cx - r // 2 + rng.integers(-r // 4, r // 4 + 1))
        y0 = min(max(y0, 0), max(h - r, 0)) if h >= r else -int(rng.integers(0, r - h + 1))
        x0 = min(max(x0, 0), max(w - r, 0)) if w >= r else -int(rng.integers(0, r - w + 1))

        img = np.full((r, r), 255, np.uint8)
        lab = np.zeros((r, r), np.uint8)
        sy0, sx0 = max(y0, 0), max(x0, 0)
        sy1, sx1 = min(y0 + r, h), min(x0 + r, w)
        img[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = gray[sy0:sy1, sx0:sx1]
        lab[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = labels[sy0:sy1, sx0:sx1]
        if r != s:
            img = cv2.resize(img, (s, s), interpolation=cv2.INTER_AREA if r > s else cv2.INTER_LINEAR)
            lab = cv2.resize(lab, (s, s), interpolation=cv2.INTER_NEAREST)

        if self.augment:
            k = int(rng.integers(0, 4))
            img, lab = np.rot90(img, k), np.rot90(lab, k)
            if rng.random() < 0.5:
                img, lab = img[:, ::-1], lab[:, ::-1]
            x = ink(np.ascontiguousarray(img))
            # Scan-like variation: contrast, faded or heavy ink, blur, grain, a grey background.
            x = x * rng.uniform(0.6, 1.15) + rng.uniform(-0.05, 0.12) * (rng.random() < 0.3)
            if rng.random() < 0.25:
                x = cv2.GaussianBlur(x, (0, 0), rng.uniform(0.4, 1.2))
            if rng.random() < 0.3:
                x = x + rng.normal(0, rng.uniform(0.01, 0.06), x.shape).astype(np.float32)
            x = np.clip(x, 0, 1).astype(np.float32)
            return x, np.ascontiguousarray(lab)
        return ink(img), lab
