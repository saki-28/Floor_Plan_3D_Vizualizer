"""The wall model: a plain U-Net that colours every pixel of a plan as background, wall, door or window.

Width 32 (7.8 M parameters) is the size timed on the Mac and on Kaggle's T4s; width 16 (1.9 M) is
the light version. Input is one channel of ink (0 paper, 1 black), any size divisible by 16.
"""

from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


def _block(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
    )


class UNet(nn.Module):
    def __init__(self, width: int = 32, levels: int = 5, classes: int = 4):
        super().__init__()
        widths = [width * 2 ** i for i in range(levels)]
        self.config = dict(width=width, levels=levels, classes=classes)
        self.down = nn.ModuleList()
        cin = 1
        for w in widths:
            self.down.append(_block(cin, w))
            cin = w
        self.up = nn.ModuleList()
        self.fuse = nn.ModuleList()
        for w in reversed(widths[:-1]):
            self.up.append(nn.ConvTranspose2d(cin, w, 2, stride=2))
            self.fuse.append(_block(2 * w, w))
            cin = w
        self.head = nn.Conv2d(cin, classes, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        skips = []
        for i, down in enumerate(self.down):
            x = down(x)
            if i < len(self.down) - 1:
                skips.append(x)
                x = F.max_pool2d(x, 2)
        for up, fuse in zip(self.up, self.fuse):
            x = fuse(torch.cat([up(x), skips.pop()], 1))
        return self.head(x)


@torch.no_grad()
def predict_plan(model: nn.Module, x: np.ndarray, device: torch.device, tile: int = 1024, margin: int = 96) -> np.ndarray:
    """Class map of a whole plan (x = ink, H×W float32), predicted in overlapping tiles so any size fits in memory."""
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

    amp = device.type == 'cuda'
    for y0 in starts(H):
        for x0 in starts(W):
            t = torch.from_numpy(canvas[y0:y0 + tile, x0:x0 + tile])[None, None].to(device)
            with torch.autocast(device.type, dtype=torch.float16, enabled=amp):
                pred = model(t).argmax(1)[0].to('cpu', torch.uint8).numpy()
            top = 0 if y0 == 0 else margin
            left = 0 if x0 == 0 else margin
            bottom = tile if y0 + tile >= H else tile - margin
            right = tile if x0 + tile >= W else tile - margin
            out[y0 + top:y0 + bottom, x0 + left:x0 + right] = pred[top:bottom, left:right]
    return out[:h, :w]
