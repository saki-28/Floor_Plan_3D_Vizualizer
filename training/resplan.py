"""ResPlan as extra training data: 13,000 residential plans as polygons, drawn as images in many drawing styles.

CubiCasa5k is one country's drawings, and on plans it never saw (CVC-FP) the model misses walls drawn in styles CubiCasa5k rarely
uses: hollow double-line walls, hatching, other door and window symbols. ResPlan (2025; Kaggle resplan/resplan) gives the walls,
doors, windows and rooms of 17,000 plans as Shapely polygons but no images, so every time a plan is used it is drawn here in a
randomly chosen style, with its class map drawn from the same polygons. The labels are exact, and the model never sees the same
picture twice.

`load_resplan` reads ResPlan.pkl once per process. A pickle can run code when it is opened, so it is only opened on Kaggle, from
the dataset itself, and turned straight into plain arrays (`compact_plan`); nothing here needs Shapely after that.
"""

from __future__ import annotations

import json
import math
import os
import pickle
import time

import cv2
import numpy as np

from cubicasa import DOOR, WALL, WINDOW, random_crop

ROOM_NAMES = {
    'living': ('LIVING', 'LOUNGE', 'Living Room', 'SEJOUR', 'DINING', 'HALL', 'Family'),
    'bedroom': ('BEDROOM', 'BED ROOM', 'Bedroom 2', 'MASTER BED', 'CHAMBRE', 'BR 3'),
    'kitchen': ('KITCHEN', 'KIT.', 'Kitchen', 'CUISINE'),
    'bathroom': ('BATH', 'WC', 'TOILET', 'W.C.', 'BAINS', 'Bath'),
    'storage': ('STORE', 'STORAGE', 'PLACARD', 'CL.'),
    'balcony': ('BALCONY', 'TERRACE', 'Balcony'),
}
ROOM_KEYS = ('living', 'bedroom', 'kitchen', 'bathroom', 'storage')


def _polygons(geom) -> list[list[np.ndarray]]:
    """A Shapely geometry's polygons, each as its rings (outline first, then holes) in float32 N×2. Lines and points are left out."""
    if geom is None or getattr(geom, 'is_empty', True):
        return []
    parts = getattr(geom, 'geoms', None)
    if parts is not None:
        return [polygon for part in parts for polygon in _polygons(part)]
    if getattr(geom, 'geom_type', '') != 'Polygon':
        return []
    rings = [np.asarray(geom.exterior.coords, np.float32)[:, :2]]
    rings += [np.asarray(hole.coords, np.float32)[:, :2] for hole in geom.interiors]
    return [rings]


def _area_and_length(polygons: list[list[np.ndarray]]) -> tuple[float, float]:
    area = sum(cv2.contourArea(rings[0]) - sum(cv2.contourArea(h) for h in rings[1:]) for rings in polygons)
    length = sum(cv2.arcLength(r, True) for rings in polygons for r in rings)
    return float(area), float(length)


def compact_plan(plan: dict) -> dict | None:
    """One ResPlan plan (a dict of Shapely geometries) as plain arrays, with its typical wall thickness. None if it has no walls."""
    walls = _polygons(plan.get('wall'))
    if not walls:
        return None
    area, length = _area_and_length(walls)
    thickness = 2 * area / length if length else 0.0  # a long thin strip has area ≈ length × thickness and outline ≈ 2 × length
    if not thickness > 0:
        return None
    return {
        'id': plan.get('id'),
        'wall': walls,
        'door': _polygons(plan.get('door')) + _polygons(plan.get('front_door')),
        'window': _polygons(plan.get('window')),
        'rooms': [(key, rings) for key in ROOM_KEYS for rings in _polygons(plan.get(key))],
        'balcony': _polygons(plan.get('balcony', plan.get('balacony'))),
        'stair': _polygons(plan.get('stair')),
        'thickness': thickness,
    }


_LOADED = {}  # path|split|limit -> compacted plans


def load_resplan(path: str, split: str = 'train', limit: int = 0) -> list[dict]:
    """ResPlan's plans of one split (split.json beside the pickle), compacted. Cached, so forked training processes share it."""
    key = f'{path}|{split}|{limit}'
    if key not in _LOADED:
        started = time.time()
        with open(path, 'rb') as f:
            raw = pickle.load(f)  # noqa: S301 - the ResPlan dataset itself, opened on Kaggle only
        split_path = os.path.join(os.path.dirname(path), 'split.json')
        if split and os.path.exists(split_path):
            keep = set(json.load(open(split_path))[split])
            raw = [p for p in raw if p.get('id') in keep]
        if limit:
            raw = raw[:limit]
        plans = [c for c in (compact_plan(p) for p in raw) if c is not None]
        del raw
        _LOADED[key] = plans
        print(f'ResPlan {split}: {len(plans)} plans read and compacted in {time.time() - started:.0f} s')
    return _LOADED[key]


def _px(rings: list[np.ndarray], origin: np.ndarray, scale: float) -> list[np.ndarray]:
    return [np.round((r - origin) * scale).astype(np.int32) for r in rings]


def _fill(canvas: np.ndarray, polygons: list[list[np.ndarray]], value: int) -> None:
    """Fills each polygon with its holes left open (OpenCV fills several rings in one call by the even-odd rule)."""
    for rings in polygons:
        cv2.fillPoly(canvas, rings, value)


def _rect(rings: list[np.ndarray]):
    """The opening a door or window polygon covers: centre, unit vector along the wall, opening length, wall thickness."""
    (cx, cy), (w, h), angle = cv2.minAreaRect(rings[0].astype(np.float32))
    a = math.radians(angle)
    u = np.array([math.cos(a), math.sin(a)])
    if h > w:
        u = np.array([-u[1], u[0]])
        w, h = h, w
    return np.array([cx, cy]), u, w, h


def _box(c: np.ndarray, u: np.ndarray, length: float, depth: float) -> np.ndarray:
    n = np.array([-u[1], u[0]])
    corners = [c - u * length / 2 - n * depth / 2, c + u * length / 2 - n * depth / 2, c + u * length / 2 + n * depth / 2, c - u * length / 2 + n * depth / 2]
    return np.round(corners).astype(np.int32)


def _style(rng: np.random.Generator) -> dict:
    pick = lambda options, weights: options[int(rng.choice(len(options), p=np.array(weights) / sum(weights)))]
    return {
        'walls': pick(['solid', 'outline', 'hatch', 'grey', 'outline_thick'], [0.3, 0.25, 0.2, 0.15, 0.1]),
        'doors': pick(['arc', 'leaf', 'gap'], [0.65, 0.15, 0.2]),
        'windows': pick(['two', 'three', 'box', 'filled'], [0.35, 0.3, 0.2, 0.15]),
        'rooms': pick(['plain', 'tint', 'tiles'], [0.55, 0.3, 0.15]),
        'ink': int(rng.integers(0, 70)),
        'paper': int(rng.integers(236, 256)),
        'line': cv2.LINE_AA if rng.random() < 0.6 else cv2.LINE_8,
        'text': rng.random() < 0.75,
        'furniture': rng.random() < 0.5,
        'dimensions': rng.random() < 0.5,
    }


def render_plan(plan: dict, rng: np.random.Generator, max_side: int = 2400) -> tuple[np.ndarray, np.ndarray]:
    """Draws a compacted plan in a random style. Returns the grey image (uint8, white paper) and its class map
    (0 background, 1 wall, 2 door, 3 window), the same classes and conventions as the CubiCasa5k labels: doors and windows cover
    the gap they fill in the wall, and walls are wall with those gaps cut out. Room names, furniture, stairs, railings and
    dimension lines are drawn but are background."""
    style = _style(rng)
    # Scale: walls end up 4-18 px thick, the range plans have at the size the app works at (longest side 1,600 px).
    wall_px = float(np.exp(rng.uniform(math.log(4), math.log(18))))
    scale = wall_px / plan['thickness']
    points = np.concatenate([r for rings in plan['wall'] for r in rings])
    low, high = points.min(0), points.max(0)
    margin = float(rng.uniform(0.04, 0.14)) * float((high - low).max()) * scale + 3 * wall_px
    if max((high - low) * scale) + 2 * margin > max_side:
        shrink = max_side / (max((high - low) * scale) + 2 * margin)
        scale, wall_px, margin = scale * shrink, wall_px * shrink, margin * shrink
    origin = low - margin / scale
    w, h = (np.ceil((high - low) * scale + 2 * margin)).astype(int)
    px = lambda polygons: [_px(rings, origin, scale) for rings in polygons]
    walls, doors, windows = px(plan['wall']), px(plan['door']), px(plan['window'])
    rooms = [(key, _px(rings, origin, scale)) for key, rings in plan['rooms']]
    ink, line = style['ink'], style['line']
    thin = max(1, int(round(wall_px / 9)))

    gray = np.full((h, w), style['paper'], np.uint8)
    labels = np.zeros((h, w), np.uint8)

    # Rooms first, under everything: a tint, or floor tiles.
    if style['rooms'] != 'plain':
        for _, rings in rooms:
            if style['rooms'] == 'tint':
                cv2.fillPoly(gray, rings, int(rng.integers(205, 248)))
            else:
                mask = np.zeros((h, w), np.uint8)
                cv2.fillPoly(mask, rings, 255)
                tile = max(6, int(wall_px * rng.uniform(1.5, 3.5)))
                grid = np.zeros((h, w), np.uint8)
                grid[::tile, :] = 1
                grid[:, ::tile] = 1
                gray[(grid > 0) & (mask > 0)] = int(rng.integers(170, 225))

    # Stairs and balcony railings (background).
    for rings in px(plan['stair']):
        cv2.polylines(gray, rings, True, ink, thin, line)
        x0, y0, bw, bh = cv2.boundingRect(rings[0])
        step = max(4, int(wall_px * 1.5))
        mask = np.zeros((h, w), np.uint8)
        cv2.fillPoly(mask, rings, 255)
        lines = np.zeros((h, w), np.uint8)
        for k in range(1, max(bw, bh) // step):
            if bw >= bh:
                cv2.line(lines, (x0 + k * step, y0), (x0 + k * step, y0 + bh), 255, thin)
            else:
                cv2.line(lines, (x0, y0 + k * step), (x0 + bw, y0 + k * step), 255, thin)
        gray[(lines > 0) & (mask > 0)] = ink
    for rings in px(plan['balcony']):
        cv2.polylines(gray, rings, True, ink, thin, line)

    # Walls, with the door and window gaps kept clear.
    wall_mask = np.zeros((h, w), np.uint8)
    _fill(wall_mask, walls, 255)
    openings = np.zeros((h, w), np.uint8)
    _fill(openings, doors, 255)
    _fill(openings, windows, 255)
    solid = (wall_mask > 0) & (openings == 0)
    kind = style['walls']
    if kind == 'solid':
        gray[solid] = ink
    elif kind == 'grey':
        gray[solid] = int(rng.integers(100, 190))
    elif kind == 'hatch':
        spacing = max(3, int(round(wall_px * rng.uniform(0.35, 0.8))))
        yy, xx = np.mgrid[0:h, 0:w]
        stripes = ((xx + (yy if rng.random() < 0.5 else -yy)) % spacing) < max(1, spacing // 4)
        gray[solid & stripes] = ink
    if kind != 'solid':
        outline = np.zeros((h, w), np.uint8)
        contours, _ = cv2.findContours(solid.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(outline, contours, -1, 255, max(thin, int(round(wall_px / 4))) if kind == 'outline_thick' else thin, line)
        gray[outline > 0] = ink
    labels[solid] = WALL

    # Windows: the gap's outline with glass lines along the wall.
    for rings in windows:
        c, u, length, depth = _rect(rings)
        if length < 2:
            continue
        box = _box(c, u, length, depth)
        if style['windows'] == 'filled':
            cv2.fillPoly(gray, [box], int(rng.integers(150, 220)))
        cv2.polylines(gray, [box], True, ink, thin, line)
        n = np.array([-u[1], u[0]])
        offsets = {'two': [0.0], 'three': [-1 / 6, 1 / 6], 'box': [], 'filled': []}[style['windows']]
        for o in offsets:
            a, b = c - u * length / 2 + n * depth * o, c + u * length / 2 + n * depth * o
            cv2.line(gray, tuple(np.round(a).astype(int)), tuple(np.round(b).astype(int)), ink, thin, line)
    for rings in windows:
        cv2.fillPoly(labels, rings, WINDOW)

    # Doors: a leaf at a right angle to the wall from one jamb, and its swing as a quarter circle.
    for rings in doors:
        c, u, length, depth = _rect(rings)
        if length < 3 or style['doors'] == 'gap':
            continue
        n = np.array([-u[1], u[0]]) * (1 if rng.random() < 0.5 else -1)
        end = 1 if rng.random() < 0.5 else -1
        hinge = c + u * end * length / 2 + n * depth / 2
        tip = hinge + n * length
        cv2.line(gray, tuple(np.round(hinge).astype(int)), tuple(np.round(tip).astype(int)), ink, thin + (1 if rng.random() < 0.3 else 0), line)
        if style['doors'] == 'arc':
            a1 = math.degrees(math.atan2(n[1], n[0]))
            a2 = math.degrees(math.atan2(-u[1] * end, -u[0] * end))
            sweep = (a2 - a1 + 180) % 360 - 180
            r = int(round(length))
            cv2.ellipse(gray, tuple(np.round(hinge).astype(int)), (r, r), 0, a1, a1 + sweep, ink, thin, line)
    for rings in doors:
        cv2.fillPoly(labels, rings, DOOR)

    room_masks = None
    # Furniture: a few outlined boxes and circles inside rooms (background).
    if style['furniture'] and rooms:
        room_masks = np.zeros((h, w), np.uint8)
        for _, rings in rooms:
            cv2.fillPoly(room_masks, rings, 255)
        room_masks[wall_mask > 0] = 0
        room_masks = cv2.erode(room_masks, np.ones((3, 3), np.uint8), iterations=max(1, int(wall_px)))
        layer = np.zeros((h, w), np.uint8)
        for _, rings in rooms:
            x0, y0, bw, bh = cv2.boundingRect(rings[0])
            for _ in range(int(rng.integers(0, 3))):
                fw, fh = int(bw * rng.uniform(0.15, 0.45)), int(bh * rng.uniform(0.15, 0.45))
                if fw < 4 or fh < 4:
                    continue
                fx, fy = x0 + int(rng.integers(0, max(1, bw - fw))), y0 + int(rng.integers(0, max(1, bh - fh)))
                if rng.random() < 0.7:
                    cv2.rectangle(layer, (fx, fy), (fx + fw, fy + fh), 255, thin)
                else:
                    cv2.ellipse(layer, (fx + fw // 2, fy + fh // 2), (fw // 2, fh // 2), 0, 0, 360, 255, thin)
        gray[(layer > 0) & (room_masks > 0)] = ink

    # Room names and areas, at each room's middle.
    if style['text']:
        font = int(rng.choice([cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_PLAIN, cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_COMPLEX,
                               cv2.FONT_HERSHEY_TRIPLEX, cv2.FONT_HERSHEY_SCRIPT_SIMPLEX]))
        size = float(rng.uniform(0.18, 0.4)) * scale / 22  # letters 0.18-0.4 m tall (a font scale of 1 is about 22 px)
        weight = max(1, int(round(size * rng.uniform(1.2, 2.2))))
        for key, rings in rooms:
            m = cv2.moments(rings[0])
            if m['m00'] <= 0:
                continue
            x, y = int(m['m10'] / m['m00']), int(m['m01'] / m['m00'])
            name = str(rng.choice(ROOM_NAMES[key]))
            (tw, th), _ = cv2.getTextSize(name, font, size, weight)
            cv2.putText(gray, name, (x - tw // 2, y), font, size, ink, weight, line)
            if rng.random() < 0.5:
                text = f'{abs(m["m00"]) / scale ** 2:.1f} m2' if rng.random() < 0.6 else f'{abs(m["m00"]) / scale ** 2 * 10.764:.0f} sq ft'
                cv2.putText(gray, text, (x - tw // 2, y + int(th * 1.8)), font, size * 0.8, ink, max(1, weight - 1), line)

    # Dimension lines outside the plan: a line with ticks at wall positions and the lengths between them.
    if style['dimensions']:
        xs = sorted({int(v) for rings in walls for r in rings for v in r[:, 0]})
        ys = sorted({int(v) for rings in walls for r in rings for v in r[:, 1]})
        top, left = int(min(ys)), int(min(xs))
        gap = int(margin * rng.uniform(0.35, 0.7))
        font_size = 0.15 * scale / 22
        for axis, ticks, at in ((0, xs, top - gap), (1, ys, left - gap)):
            if at < 4 or len(ticks) < 2:
                continue
            chosen = sorted({ticks[0], ticks[-1], *[int(t) for t in rng.choice(ticks, size=min(len(ticks), int(rng.integers(1, 6))), replace=False)]})
            a, b = chosen[0], chosen[-1]
            p, q = ((a, at), (b, at)) if axis == 0 else ((at, a), (at, b))
            cv2.line(gray, p, q, ink, 1, line)
            for i, t in enumerate(chosen):
                tick = ((t, at - 5), (t, at + 5)) if axis == 0 else ((at - 5, t), (at + 5, t))
                cv2.line(gray, tick[0], tick[1], ink, 1, line)
                if i:
                    text = f'{(t - chosen[i - 1]) / scale:.2f}'
                    mid = (chosen[i - 1] + t) // 2
                    org = (mid - 12, at - 6) if axis == 0 else (max(0, at - 40), mid)
                    cv2.putText(gray, text, org, cv2.FONT_HERSHEY_SIMPLEX, max(0.3, font_size), ink, 1, line)

    # Now and then a slightly turned page, as a scan would be.
    if rng.random() < 0.15:
        turn = float(rng.uniform(-2.5, 2.5))
        matrix = cv2.getRotationMatrix2D((w / 2, h / 2), turn, 1.0)
        gray = cv2.warpAffine(gray, matrix, (w, h), flags=cv2.INTER_LINEAR, borderValue=style['paper'])
        labels = cv2.warpAffine(labels, matrix, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    return gray, labels


class MixedCrops:
    """CubiCasa5k crops (a TrainCrops) with drawn ResPlan crops mixed in: `share` of the items are ResPlan plans, each drawn in
    a fresh style and cut into crops exactly as CubiCasa5k plans are. Used as a torch Dataset, like TrainCrops."""

    def __init__(self, base, plans: list[dict], share: float = 0.4):
        self.base, self.plans = base, plans
        self.extra = int(round(len(base) * share / (1 - share))) if plans and 0 < share < 1 else 0

    def __len__(self) -> int:
        return len(self.base) + self.extra

    def __getitem__(self, i: int):
        if i < len(self.base):
            return self.base[i]
        rng = np.random.default_rng()
        gray, labels = render_plan(self.plans[int(rng.integers(len(self.plans)))], rng)
        xs, ys = zip(*(random_crop(gray, labels, rng, self.base.size, True) for _ in range(self.base.per_plan)))
        return np.stack(xs)[:, None], np.stack(ys).astype(np.int64)
