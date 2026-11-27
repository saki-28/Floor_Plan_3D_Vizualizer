"""The wall model: a network that colours every pixel of a plan as background, wall, door or window.

Two architectures, picked by `build_model`:

* `unet` - a plain U-Net trained from scratch. Width 32 (7.8 M parameters) is the size timed on the Mac and on Kaggle's T4s;
  width 16 (1.9 M) is the light version.
* `resunet34` - a U-Net decoder on a ResNet-34 encoder that starts from ImageNet weights (24 M parameters), with scSE attention
  (Roy et al., 2018) after every decoder stage and a full-resolution stem so thin walls keep sharp edges. Recent floor-plan papers
  find pretrained encoders with a U-Net decoder and attention generalise better than a U-Net from scratch (MitUNet, 2025).

Input is one channel of ink (0 paper, 1 black), any size divisible by 32; output is 4 class scores per pixel.
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
    def __init__(self, width: int = 32, levels: int = 5, classes: int = 4, arch: str = 'unet'):
        super().__init__()
        widths = [width * 2 ** i for i in range(levels)]
        self.config = dict(arch='unet', width=width, levels=levels, classes=classes)
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


class _BasicBlock(nn.Module):
    """ResNet's basic block, with the attribute names torchvision uses so its ImageNet weights load as they are."""

    def __init__(self, cin: int, cout: int, stride: int = 1):
        super().__init__()
        self.conv1 = nn.Conv2d(cin, cout, 3, stride, 1, bias=False)
        self.bn1 = nn.BatchNorm2d(cout)
        self.conv2 = nn.Conv2d(cout, cout, 3, 1, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(cout)
        self.downsample = (nn.Sequential(nn.Conv2d(cin, cout, 1, stride, bias=False), nn.BatchNorm2d(cout))
                           if stride != 1 or cin != cout else None)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = F.relu(self.bn1(self.conv1(x)), inplace=True)
        out = self.bn2(self.conv2(out))
        return F.relu(out + (self.downsample(x) if self.downsample is not None else x), inplace=True)


class ResNet34Encoder(nn.Module):
    """ResNet-34 without its classifier, taking one channel. Returns the features at 1/2, 1/4, 1/8, 1/16 and 1/32 of the input."""

    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 64, 7, 2, 3, bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.maxpool = nn.MaxPool2d(3, 2, 1)
        cin = 64
        for i, (cout, blocks) in enumerate(((64, 3), (128, 4), (256, 6), (512, 3))):
            layer = [_BasicBlock(cin, cout, 1 if i == 0 else 2)] + [_BasicBlock(cout, cout) for _ in range(blocks - 1)]
            setattr(self, f'layer{i + 1}', nn.Sequential(*layer))
            cin = cout

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        f1 = F.relu(self.bn1(self.conv1(x)), inplace=True)
        f2 = self.layer1(self.maxpool(f1))
        f3 = self.layer2(f2)
        f4 = self.layer3(f3)
        return [f1, f2, f3, f4, self.layer4(f4)]


RESNET34_IMAGENET = 'https://download.pytorch.org/models/resnet34-b627a593.pth'  # torchvision's IMAGENET1K_V1 weights


def load_imagenet_weights(encoder: ResNet34Encoder, state: dict) -> None:
    """Copies torchvision's ResNet-34 weights in. The first convolution takes one channel here, so its three colour filters are
    summed (a grey image is the same in R, G and B); the classifier is left out."""
    state = {k: v for k, v in state.items() if not k.startswith('fc.')}
    state['conv1.weight'] = state['conv1.weight'].sum(1, keepdim=True)
    missing, unexpected = encoder.load_state_dict(state, strict=False)
    missing = [k for k in missing if not k.endswith('num_batches_tracked')]
    if missing or unexpected:
        raise ValueError(f'ResNet-34 weights do not fit: missing {missing[:5]}, unexpected {unexpected[:5]}')


class SCSE(nn.Module):
    """Concurrent spatial and channel squeeze-and-excitation (Roy et al., 2018): reweights channels and pixels."""

    def __init__(self, ch: int, reduction: int = 16):
        super().__init__()
        mid = max(ch // reduction, 4)
        self.channel = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Conv2d(ch, mid, 1), nn.ReLU(inplace=True), nn.Conv2d(mid, ch, 1), nn.Sigmoid())
        self.spatial = nn.Sequential(nn.Conv2d(ch, 1, 1), nn.Sigmoid())

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x * self.channel(x) + x * self.spatial(x)


class _UpBlock(nn.Module):
    def __init__(self, cin: int, skip: int, cout: int):
        super().__init__()
        self.fuse = _block(cin + skip, cout)
        self.attention = SCSE(cout)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = F.interpolate(x, scale_factor=2.0, mode='nearest')
        return self.attention(self.fuse(torch.cat([x, skip], 1)))


class ResUNet34(nn.Module):
    """U-Net decoder with scSE attention on a ResNet-34 encoder, plus a small full-resolution stem as the last skip."""

    MEAN, STD = 0.449, 0.226  # ImageNet's mean and spread, averaged over R, G and B

    def __init__(self, classes: int = 4, pretrained: bool = False):
        super().__init__()
        self.config = dict(arch='resunet34', classes=classes)
        self.stem = _block(1, 16)
        self.encoder = ResNet34Encoder()
        if pretrained:
            load_imagenet_weights(self.encoder, torch.hub.load_state_dict_from_url(RESNET34_IMAGENET, map_location='cpu', progress=False))
        self.up = nn.ModuleList([_UpBlock(512, 256, 256), _UpBlock(256, 128, 128), _UpBlock(128, 64, 64), _UpBlock(64, 64, 32), _UpBlock(32, 16, 16)])
        self.head = nn.Conv2d(16, classes, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # The encoder learnt on photographs normalised this way: give it the plan as grey (white paper), not as ink.
        features = self.encoder((1.0 - x - self.MEAN) / self.STD)
        skips = [self.stem(x)] + features[:-1]
        y = features[-1]
        for up in self.up:
            y = up(y, skips.pop())
        return self.head(y)


def build_model(config: dict, pretrained: bool = False) -> nn.Module:
    """The network a config describes (a checkpoint's `config`, or the run's settings). Pretrained weights are fetched only when asked."""
    config = dict(config)
    arch = config.pop('arch', 'unet')
    if arch == 'unet':
        return UNet(**config)
    if arch == 'resunet34':
        return ResUNet34(**config, pretrained=pretrained)
    raise ValueError(f'unknown architecture {arch!r}')


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
