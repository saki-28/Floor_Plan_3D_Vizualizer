"""Lines the CVC-FP labels of the Kaggle copy (asutoshprad/floor-plan-dataset) up with their scans.

    python3 scripts/align-cvcfp.py [data/cvc-fp]

That copy's label pictures (Y/<n> (2).png) are the right size but shifted against the scans
(X/<n>.png) by a different amount on every plan. The shift is found by sliding the labelled walls,
doors and windows over the scan's ink until they match best (cross-correlation), and the labels are
written as class maps on the scan's own pixel grid: labels/<n>.png with 0 background, 1 wall,
2 door, 3 window, the classes the wall model uses. shifts.json records each plan's shift and how
well it matched, so a plan that did not line up can be left out.
"""
import glob, json, os, sys
import cv2
import numpy as np

root = sys.argv[1] if len(sys.argv) > 1 else 'data/cvc-fp'
COLOURS = {1: (248, 216, 175), 2: (0, 186, 139), 3: (15, 189, 246)}  # blue, green, red order as OpenCV reads them


def classes_of(label: np.ndarray) -> np.ndarray:
    out = np.zeros(label.shape[:2], np.uint8)
    for value, colour in COLOURS.items():
        out[np.abs(label.astype(int) - np.array(colour)).sum(2) < 60] = value
    return out


def best_shift(gray: np.ndarray, structure: np.ndarray, factor: int = 4):
    small = lambda m: cv2.resize(m.astype(np.float32), None, fx=1 / factor, fy=1 / factor, interpolation=cv2.INTER_AREA)
    ink = small(255 - gray) / 255
    mask = small(structure)
    ink -= ink.mean()
    mask -= mask.mean()
    corr = np.fft.irfft2(np.fft.rfft2(ink) * np.conj(np.fft.rfft2(mask)), s=ink.shape)
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    if y > ink.shape[0] // 2:
        y -= ink.shape[0]
    if x > ink.shape[1] // 2:
        x -= ink.shape[1]
    return int(x * factor), int(y * factor), float(corr.max() / (np.linalg.norm(ink) * np.linalg.norm(mask) + 1e-9))


def moved(classes: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.zeros_like(classes)
    h, w = classes.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = classes[ys, xs]
    return out


os.makedirs(os.path.join(root, 'labels'), exist_ok=True)
shifts = {}
for path in sorted(glob.glob(os.path.join(root, 'X', '*.png')), key=lambda p: int(os.path.basename(p)[:-4])):
    name = os.path.basename(path)[:-4]
    label_path = os.path.join(root, 'Y', f'{name} (2).png')
    if not os.path.exists(label_path):
        continue
    scan = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if scan.ndim == 3 and scan.shape[2] == 4:  # transparent paper is white
        alpha = scan[:, :, 3:4].astype(np.float32) / 255
        scan = (scan[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    gray = scan if scan.ndim == 2 else cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY)
    classes = classes_of(cv2.imread(label_path))
    if classes.shape != gray.shape:
        classes = cv2.resize(classes, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_NEAREST)
    dx, dy, match = best_shift(gray, classes > 0)
    aligned = moved(classes, dx, dy)
    lost = 1 - np.count_nonzero(aligned) / max(1, np.count_nonzero(classes))  # labels pushed off the page
    cv2.imwrite(os.path.join(root, 'labels', f'{name}.png'), aligned)
    shifts[name] = {'dx': dx, 'dy': dy, 'match': round(match, 3), 'lost': round(float(lost), 3)}
    print(f'{name:>4}  shift {dx:+5d} {dy:+5d}  match {match:.3f}  labels lost {lost:.1%}')
json.dump(shifts, open(os.path.join(root, 'shifts.json'), 'w'), indent=1)
