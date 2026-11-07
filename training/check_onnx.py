"""Checks a run's ONNX export: predicts test plans with onnxruntime, tiled exactly as model.predict_plan does (and as the browser
will), and compares the class maps with the PyTorch predictions the run saved in pred_test/ and with the true walls.

    python3 training/check_onnx.py --run data/models/<run> [--data data/cubicasa5k/cubicasa5k] [--labels data/cubicasa5k-labels] [--plans 10]

Needs numpy, OpenCV and onnxruntime, not PyTorch.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import cv2
import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cubicasa import DOOR, WALL, WINDOW, ink, plan_name  # noqa: E402


def predict_tiled(session: ort.InferenceSession, x: np.ndarray, tile: int = 1024, margin: int = 96) -> np.ndarray:
    """model.predict_plan with onnxruntime: overlapping tiles, keeping each tile's middle."""
    h, w = x.shape
    H = math.ceil(max(h, tile) / 32) * 32
    W = math.ceil(max(w, tile) / 32) * 32
    canvas = np.zeros((H, W), np.float32)
    canvas[:h, :w] = x
    out = np.zeros((H, W), np.uint8)
    step = tile - 2 * margin

    def starts(n: int) -> list[int]:
        s = list(range(0, n - tile + 1, step))
        if s[-1] != n - tile:
            s.append(n - tile)
        return s

    for y0 in starts(H):
        for x0 in starts(W):
            logits = session.run(None, {'ink': canvas[None, None, y0:y0 + tile, x0:x0 + tile]})[0]
            pred = logits[0].argmax(0).astype(np.uint8)
            top = 0 if y0 == 0 else margin
            left = 0 if x0 == 0 else margin
            bottom = tile if y0 + tile >= H else tile - margin
            right = tile if x0 + tile >= W else tile - margin
            out[y0 + top:y0 + bottom, x0 + left:x0 + right] = pred[top:bottom, left:right]
    return out[:h, :w]


def wall_iou(pred: np.ndarray, labels: np.ndarray) -> float:
    found, truth = pred == WALL, labels == WALL
    union = np.count_nonzero(found | truth)
    return np.count_nonzero(found & truth) / union if union else 1.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True, help='a run folder with floorplan3d_walls.onnx, test_results.json and pred_test/')
    ap.add_argument('--data', default='data/cubicasa5k/cubicasa5k')
    ap.add_argument('--labels', default='data/cubicasa5k-labels')
    ap.add_argument('--plans', type=int, default=10)
    args = ap.parse_args()

    session = ort.InferenceSession(os.path.join(args.run, 'floorplan3d_walls.onnx'), providers=['CPUExecutionProvider'])
    rows = json.load(open(os.path.join(args.run, 'test_results.json')))['rows'][:args.plans]
    agreements, gaps = [], []
    for row in rows:
        plan = row['plan']
        gray = cv2.imread(os.path.join(args.data, plan, 'F1_scaled.png'), cv2.IMREAD_GRAYSCALE)
        labels = cv2.imread(os.path.join(args.labels, plan_name(plan) + '.png'), cv2.IMREAD_UNCHANGED)
        torch_pred = cv2.imread(os.path.join(args.run, 'pred_test', plan_name(plan) + '.png'), cv2.IMREAD_UNCHANGED)
        t = time.time()
        onnx_pred = predict_tiled(session, ink(gray))
        ms = (time.time() - t) * 1000
        agree = float((onnx_pred == torch_pred).mean())
        iou_onnx, iou_torch = wall_iou(onnx_pred, labels), wall_iou(torch_pred, labels)
        agreements.append(agree)
        gaps.append(iou_onnx - iou_torch)
        print(f'{plan:36s} {gray.shape[1]:5d}×{gray.shape[0]:<5d} pixels agree {agree:.4%}  wall IoU onnx {iou_onnx:.4f} '
              f'torch {iou_torch:.4f}  {ms:6.0f} ms')
    print(f'{len(rows)} plans: pixels agree {np.mean(agreements):.4%} on average (lowest {min(agreements):.4%}); '
          f'wall IoU differs by {np.mean(gaps):+.4f} on average (largest {max(gaps, key=abs):+.4f})')
    _ = DOOR, WINDOW  # classes 2 and 3 are compared in the pixel agreement


if __name__ == '__main__':
    main()
