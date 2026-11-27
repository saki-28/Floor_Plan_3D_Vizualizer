"""Scores a trained wall model on CVC-FP, plans it never saw in training, on Kaggle's processors.

Pushed by training/kaggle/push_heldout.sh with two inputs attached: the Kaggle copy of CVC-FP
(asutoshprad/floor-plan-dataset) and the output of the training notebook, which holds
floorplan3d_walls.onnx. It does what scripts/align-cvcfp.py and scripts/evaluate-heldout.ts do on
a laptop, for the model only: lines each label picture up with its scan, shrinks the scan so its
long side is at most 1600 pixels (the size the app works at), predicts it in 512-pixel tiles with
a 96-pixel margin (as src/vision/wallModel.ts does), and scores walls, and doors plus windows, by
pixel IoU. Writes heldout_cvcfp.json: one row per plan and the means.
"""
import glob, json, math, os, subprocess, sys, time
import cv2
import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', 'onnxruntime'])
    import onnxruntime as ort

WALL, DOOR, WINDOW = 1, 2, 3
COLOURS = {WALL: (248, 216, 175), DOOR: (0, 186, 139), WINDOW: (15, 189, 246)}  # as OpenCV reads the label pictures (blue, green, red)
MAX_SIDE, TILE, MARGIN = 1600, 512, 96


def find(pattern: str) -> str:
    hits = sorted(glob.glob(os.path.join('/kaggle/input', '**', pattern), recursive=True))
    if not hits:
        raise SystemExit(f'Nothing matching {pattern} under /kaggle/input')
    return hits[0]


def classes_of(label: np.ndarray) -> np.ndarray:
    out = np.zeros(label.shape[:2], np.uint8)
    for value, colour in COLOURS.items():
        out[np.abs(label.astype(int) - np.array(colour)).sum(2) < 60] = value
    return out


def best_shift(gray: np.ndarray, structure: np.ndarray, factor: int = 4):
    """How far the labels have to move to sit on the scan's ink (cross-correlation at quarter size)."""
    small = lambda m: cv2.resize(m.astype(np.float32), None, fx=1 / factor, fy=1 / factor, interpolation=cv2.INTER_AREA)
    ink, mask = small(255 - gray) / 255, small(structure)
    ink -= ink.mean()
    mask -= mask.mean()
    corr = np.fft.irfft2(np.fft.rfft2(ink) * np.conj(np.fft.rfft2(mask)), s=ink.shape)
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    y = y - ink.shape[0] if y > ink.shape[0] // 2 else y
    x = x - ink.shape[1] if x > ink.shape[1] // 2 else x
    return int(x * factor), int(y * factor)


def moved(classes: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.zeros_like(classes)
    h, w = classes.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = classes[ys, xs]
    return out


def predict(session, ink: np.ndarray) -> np.ndarray:
    h, w = ink.shape
    H, W = math.ceil(max(h, TILE) / 32) * 32, math.ceil(max(w, TILE) / 32) * 32
    canvas = np.zeros((H, W), np.float32)
    canvas[:h, :w] = ink
    out = np.zeros((H, W), np.uint8)
    step = TILE - 2 * MARGIN

    def starts(n):
        s = list(range(0, n - TILE + 1, step))
        return s if s[-1] == n - TILE else s + [n - TILE]

    name = session.get_inputs()[0].name
    for y0 in starts(H):
        for x0 in starts(W):
            pred = session.run(None, {name: canvas[None, None, y0:y0 + TILE, x0:x0 + TILE]})[0][0].argmax(0).astype(np.uint8)
            top, left = (0 if y0 == 0 else MARGIN), (0 if x0 == 0 else MARGIN)
            bottom, right = (TILE if y0 + TILE >= H else TILE - MARGIN), (TILE if x0 + TILE >= W else TILE - MARGIN)
            out[y0 + top:y0 + bottom, x0 + left:x0 + right] = pred[top:bottom, left:right]
    return out[:h, :w]


def score(truth: np.ndarray, found: np.ndarray) -> dict:
    both, t, f = np.count_nonzero(truth & found), np.count_nonzero(truth), np.count_nonzero(found)
    union = t + f - both
    return {'iou': both / union if union else 1.0, 'precision': both / f if f else 0.0, 'recall': both / t if t else 0.0}


scans = os.path.dirname(find(os.path.join('X', '1.png')))
labels_dir = os.path.join(os.path.dirname(scans), 'Y')
session = ort.InferenceSession(find('floorplan3d_walls.onnx'), providers=['CPUExecutionProvider'])
rows = []
started = time.time()
for path in sorted(glob.glob(os.path.join(scans, '*.png')), key=lambda p: int(os.path.basename(p)[:-4])):
    plan = os.path.basename(path)[:-4]
    label_path = os.path.join(labels_dir, f'{plan} (2).png')
    if not os.path.exists(label_path):
        continue
    scan = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if scan.ndim == 3 and scan.shape[2] == 4:  # transparent paper is white
        alpha = scan[:, :, 3:4].astype(np.float32) / 255
        scan = np.rint(scan[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    gray = scan if scan.ndim == 2 else cv2.cvtColor(scan, cv2.COLOR_BGR2GRAY)
    classes = classes_of(cv2.imread(label_path))
    if classes.shape != gray.shape:
        classes = cv2.resize(classes, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_NEAREST)
    dx, dy = best_shift(gray, classes > 0)
    truth = moved(classes, dx, dy)
    scale = min(1.0, MAX_SIDE / max(gray.shape))
    if scale < 1:
        size = (round(gray.shape[1] * scale), round(gray.shape[0] * scale))
        gray = cv2.resize(gray, size, interpolation=cv2.INTER_AREA)
        truth = cv2.resize(truth, size, interpolation=cv2.INTER_NEAREST)
    pred = predict(session, 1.0 - gray.astype(np.float32) / 255.0)
    walls = score(truth == WALL, pred == WALL)
    openings = score(truth >= DOOR, pred >= DOOR)
    rows.append({'plan': plan, 'width': gray.shape[1], 'height': gray.shape[0], 'shift': [dx, dy], 'model': walls['iou'],
                 'modelPrecision': walls['precision'], 'modelRecall': walls['recall'], 'openings': openings['iou']})
    print(f"{plan:>4}  {gray.shape[1]}x{gray.shape[0]}  wall IoU {walls['iou']:.3f} (p {walls['precision']:.3f}, r {walls['recall']:.3f})  openings {openings['iou']:.3f}", flush=True)

mean = lambda key: float(np.mean([r[key] for r in rows]))
summary = {'plans': len(rows), 'meanIoU': mean('model'), 'medianIoU': float(np.median([r['model'] for r in rows])), 'precision': mean('modelPrecision'),
           'recall': mean('modelRecall'), 'openingsIoU': mean('openings'), 'minutes': (time.time() - started) / 60}
json.dump({'summary': summary, 'rows': rows}, open('heldout_cvcfp.json', 'w'), indent=1)
print(json.dumps(summary, indent=1))
