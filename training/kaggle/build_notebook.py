"""Builds the FloorPlan3D training notebook and its Kaggle settings.

    python3 -I training/kaggle/build_notebook.py [--minutes 180] [--steps 60000] [--test-limit 400] [--kaggle-dir DIR]
    kaggle kernels push -p training/kaggle/build/notebook -t 21600

The notebook (training/floorplan3d_walls.ipynb) tells the whole story of the wall model, cell by
cell: the data, the labels, the training crops, the U-Net, the loss, training on every GPU, the
test-set scores against the rule pipeline, where it goes wrong, and the export for the browser.

Its code cells are not written here: each one is cut out of the tested modules (cubicasa.py,
model.py, train.py) by name, so the notebook always runs exactly the code the tests check. Only
the glue (settings, plots, tables) lives in this file. Edit the modules, then rebuild.
"""

from __future__ import annotations

import argparse
import ast
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TRAINING = os.path.dirname(HERE)
REPO = os.path.dirname(TRAINING)
NOTEBOOK = os.path.join(TRAINING, 'floorplan3d_walls.ipynb')


def extract(module: str, *names: str) -> str:
    """The source of top-level functions, classes and assignments of training/<module>, in the order asked."""
    path = os.path.join(TRAINING, module)
    with open(path) as f:
        source = f.read()
    lines = source.splitlines()
    found: dict[str, str] = {}
    for node in ast.parse(source).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            name = node.name
        elif isinstance(node, ast.Assign):
            targets = [t for t in node.targets if isinstance(t, (ast.Name, ast.Tuple))]
            name = ','.join(n.id for t in targets for n in (t.elts if isinstance(t, ast.Tuple) else [t]) if isinstance(n, ast.Name))
        else:
            continue
        start = min([node.lineno] + [d.lineno for d in getattr(node, 'decorator_list', [])])
        found[name] = '\n'.join(lines[start - 1:node.end_lineno])
    missing = [n for n in names if n not in found]
    if missing:
        raise KeyError(f'{module} has no top-level {missing}; it has {sorted(found)}')
    return '\n\n\n'.join(found[n] for n in names)


def md(text: str) -> dict:
    return {'cell_type': 'markdown', 'metadata': {}, 'source': text.strip('\n')}


def code(text: str) -> dict:
    return {'cell_type': 'code', 'metadata': {}, 'execution_count': None, 'outputs': [], 'source': text.strip('\n')}


def rules_scores() -> dict[str, float]:
    """The rule pipeline's wall IoU on each test plan (scripts/evaluate-cubicasa.ts, via src/data/evaluationResults.json)."""
    with open(os.path.join(REPO, 'src', 'data', 'evaluationResults.json')) as f:
        rows = json.load(f)['rows']
    return {plan: rules for plan, rules, _model, _openings in rows}


def cvcfp_baseline() -> dict:
    """Run 2's and the rules' wall IoU on the scored CVC-FP plans (training/kaggle/cvcfp_baseline.json, scores only)."""
    with open(os.path.join(HERE, 'cvcfp_baseline.json')) as f:
        return json.load(f)


LEARNING_RATES = {'unet': 2e-3, 'resunet34': 6e-4}  # a pretrained encoder wants a gentler start


def build(minutes: float, steps: int, test_limit: int, arch: str = 'unet', resplan_share: float = 0.4) -> dict:
    rules = rules_scores()
    baseline = cvcfp_baseline()
    baseline_lines = ',\n'.join(
        '    ' + ', '.join(f"{r['plan']!r}: ({r['rules']}, {r['run2']})" for r in baseline['rows'][i:i + 4]) for i in range(0, len(baseline['rows']), 4)
    )
    rule_lines = ',\n'.join(
        '    ' + ', '.join(f'{plan!r}: {score}' for plan, score in list(rules.items())[i:i + 3]) for i in range(0, len(rules), 3)
    )
    cells = [
        md('''
# FloorPlan3D: walls, doors and windows from floor plan images

This notebook trains the model behind FloorPlan3D's **Image to plan**: a network that labels every pixel of a floor plan image as
*background*, *wall*, *door* or *window*. It runs top to bottom on Kaggle's two T4 GPUs and leaves the trained model, its scores
on the 400 CubiCasa5k test plans and on 96 plans from another dataset it never trains on, and an ONNX copy for the browser.

| Section | What it shows |
|---|---|
| 0. Settings | the run's settings and the machine |
| 1. The data | CubiCasa5k: 5,000 plans in three kinds, split 4,200 / 400 / 400 |
| 2. Labels | the hand-traced polygons drawn as one class map per plan, exactly as the app's scorer draws them |
| 3. Training crops | 512 px crops with scale, rotation and scan-like noise |
| 3b. More drawing styles | ResPlan's 13,000 plans, drawn in a random style each time, mixed in |
| 4. The model | a plain U-Net (7.8 M parameters) or a U-Net on a pretrained ResNet-34 (24 M) |
| 5. The loss | cross-entropy plus soft Dice |
| 6. Training | one process per GPU, half precision, a time-budgeted schedule |
| 7. How training went | loss and validation scores over time |
| 8. The test plans | wall IoU on all 400 test plans, against the hand-written rules of the app |
| 8b. Plans it never saw | CVC-FP: another country's plans, against run 2 and the rules |
| 9. Where it goes wrong | the best, a typical and the worst test plan, pixel by pixel |
| 10. Export for the browser | the model as ONNX, checked against PyTorch |

Every code cell below is cut from the FloorPlan3D repository's `training/` modules by `training/kaggle/build_notebook.py`, so this
notebook runs exactly the code its tests check.

**Data and licence.** CubiCasa5k (Kalervo et al., *CubiCasa5K: A Dataset and an Improved Multi-Task Model for Floorplan Image
Analysis*, SCIA 2019) is licensed CC BY-NC-SA 4.0. It, this notebook's outputs and the model trained here are for non-commercial
use only. ResPlan (2025) is CC BY 4.0 by its README (Kaggle lists CC BY-NC-SA 4.0); CVC-FP (de las Heras et al., IJDAR 2015) is
CC BY-NC 4.0 and is only scored, never trained on.
'''),
        md('''
## 0. Settings

`RUN` holds everything that shapes the run. On Kaggle the defaults train for the time budget in `minutes`; the learning-rate
schedule stretches to fit it. Set the environment variable `FP3D_QUICK=1` to check the notebook end to end in a couple of minutes
on any machine, with a tiny model and a handful of plans.
'''),
        code(f'''
import os

ON_KAGGLE = os.path.isdir('/kaggle/input')
QUICK = os.environ.get('FP3D_QUICK') == '1'

RUN = dict(
    {f'arch={arch!r},':<19}# 'unet' (trained from scratch) or 'resunet34' (U-Net on an ImageNet-pretrained ResNet-34)
    width=32,          # U-Net width: 32 channels at full resolution, 7.8 M parameters (unet only)
    crop=512,          # training crops are 512 × 512 px
    batch=8,           # crops per GPU per step
    per_plan=4,        # crops cut from each plan that is loaded
    minutes={minutes!r},       # training time budget; the schedule fits itself to it
    steps={steps!r},       # step budget; whichever runs out first ends training
    {f'lr={LEARNING_RATES[arch]!r},':<19}# peak learning rate (AdamW), after a 300-step warm-up, then cosine down to 2%
    val_plans=60,      # validation plans scored every val_every steps; the best checkpoint is kept
    val_every=3000,
    test_limit={test_limit!r},   # test plans scored at the end
    train_limit=0,     # 0 = all 4,200 training plans
    workers=2,         # data-loading processes per GPU
    log_every=200,
    resplan_share={resplan_share!r},  # share of training items that are ResPlan plans drawn in a random style (0 = CubiCasa5k only)
)
if QUICK:
    RUN.update(width=8, crop=128, minutes=1, steps=30, val_plans=2, val_every=15, test_limit=3, train_limit=12, workers=0, log_every=10, device='cpu',
               resplan_limit=40, heldout_limit=2, pretrained=int(ON_KAGGLE))  # off Kaggle, skip downloading ImageNet weights
RUN
'''),
        code('''
from __future__ import annotations

import json
import math
import pickle
import re
import struct
import subprocess
import sys
import time
import warnings
from dataclasses import MISSING, asdict, dataclass, fields
from multiprocessing import Pool

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
import torch.distributed as dist
import torch.nn as nn
import torch.nn.functional as F
from IPython.display import Markdown, display
from torch.utils.data import DataLoader, DistributedSampler, RandomSampler

if ON_KAGGLE:
    DATA = next(d for d, _, files in os.walk('/kaggle/input') if 'train.txt' in files)
    LABELS = '/tmp/labels'          # drawn class maps (not part of the output)
    OUT = '/kaggle/working'         # everything kept: model, scores, history, ONNX
else:
    DATA = os.environ.get('FP3D_DATA', 'data/cubicasa5k/cubicasa5k')
    LABELS = os.environ.get('FP3D_LABELS', 'data/cubicasa5k-labels')
    OUT = os.environ.get('FP3D_OUT', 'data/models/notebook-run')
os.makedirs(OUT, exist_ok=True)
if ON_KAGGLE:
    RESPLAN = next((os.path.join(d, 'ResPlan.pkl') for d, _, files in os.walk('/kaggle/input') if 'ResPlan.pkl' in files), '')
    CVCFP = next((os.path.dirname(d) for d, _, files in os.walk('/kaggle/input') if os.path.basename(d) == 'X' and '1.png' in files), '')
else:
    RESPLAN = os.environ.get('FP3D_RESPLAN', '')
    CVCFP = os.environ.get('FP3D_CVCFP', 'data/cvc-fp' if os.path.isdir('data/cvc-fp/X') else '')
if not RUN['resplan_share']:
    RESPLAN = ''


def gpu_names() -> list[str]:
    """The GPUs, from nvidia-smi. CUDA itself is not touched in this process before training: the training processes are forked
    from it, and a forked process cannot use a CUDA context its parent has already opened."""
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'], capture_output=True, text=True, timeout=30)
        return [line.strip() for line in out.stdout.splitlines() if line.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


GPUS = gpu_names()
WORLD = len(GPUS) or int(os.environ.get('FP3D_WORLD', 1))  # one training process per GPU
print(f'Python {sys.version.split()[0]}, PyTorch {torch.__version__}, OpenCV {cv2.__version__}')
print(f'GPUs: {GPUS or "none"}; {os.cpu_count()} CPU cores; {WORLD} training process(es)')
print(f'data {DATA}\\nlabels {LABELS}\\noutput {OUT}\\nResPlan {RESPLAN or "not used"}\\nCVC-FP {CVCFP or "not used"}')
'''),
        md('''
## 1. The data

CubiCasa5k holds 5,000 Finnish floor plans, each a raster image (`F1_scaled.png`) with every wall, door, window and room traced
by hand as polygons in `model.svg`. They come in three kinds: *high-quality architectural* drawings (thin, outlined walls, hatching,
dense labels), *high-quality* and *colorful* (solid, often coloured walls). The dataset fixes the split: 4,200 plans to train on,
400 to choose the checkpoint with (validation) and 400 to report on (test), which are used once, at the end.
'''),
        code(extract('cubicasa.py', 'BACKGROUND,WALL,DOOR,WINDOW', 'CLASSES', 'read_split', 'plan_name', 'png_size')),
        code('''
splits = {split: read_split(DATA, split) for split in ('train', 'val', 'test')}
kind = lambda plan: plan.split('/')[0]
counts = pd.DataFrame({split: pd.Series([kind(p) for p in plans]).value_counts() for split, plans in splits.items()}).fillna(0).astype(int)
counts.loc['total'] = counts.sum()
display(counts)

sizes = np.array([png_size(os.path.join(DATA, p, 'F1_scaled.png')) for plans in splits.values() for p in plans])
fig, ax = plt.subplots(figsize=(8, 2.8))
ax.hist(sizes.max(1), bins=50, color='#2f70bb')
ax.set_xlabel('longest side of the plan image (px)')
ax.set_ylabel('plans')
ax.spines[['top', 'right']].set_visible(False)
plt.show()
print(f'median size {int(np.median(sizes[:, 0]))} × {int(np.median(sizes[:, 1]))} px; largest side up to {sizes.max()} px')
'''),
        md('''
## 2. Labels: from polygons to pixels

Each plan's walls, doors and windows are read from `model.svg` and drawn as one **class map** on the pixel grid of its image:
0 background, 1 wall, 2 door, 3 window. Doors and windows are drawn over the walls, so *wall* means wall with its openings cut out,
the same truth the app's TypeScript scorer (`scripts/evaluate-cubicasa.ts`) uses for the rules.

Two details matter for a fair comparison. Only the first polygon directly inside each `Wall`, `Door` or `Window` group is the shape
(the others are decorations), and polygons are filled by scanlines through pixel centres with the even–odd rule. `fill_polygon` is a
vectorised port of the app's `fillPolygon`; on all 5,000 plans the two draw identical maps (0 pixels differ).
'''),
        code(extract('cubicasa.py', '_TAG', '_attribute', '_points', 'parse_svg', 'fill_polygon', 'label_map', '_prepare_one', 'prepare_labels')),
        code('''
t = time.time()
made = prepare_labels(DATA, LABELS)
open(os.path.join(LABELS, '.done'), 'w').close()
print(f'{made} class maps drawn in {time.time() - t:.0f} s ({len(os.listdir(LABELS)) - 1} in {LABELS})')
'''),
        code('''
# Background, wall, door, window: white, teal, amber, magenta.
COLOURS = np.array([[255, 255, 255], [27, 108, 128], [201, 133, 0], [213, 81, 129]], np.uint8)


def load(plan: str) -> tuple[np.ndarray, np.ndarray]:
    gray = cv2.imread(os.path.join(DATA, plan, 'F1_scaled.png'), cv2.IMREAD_GRAYSCALE)
    labels = cv2.imread(os.path.join(LABELS, plan_name(plan) + '.png'), cv2.IMREAD_UNCHANGED)
    return gray, labels


def overlay(gray: np.ndarray, labels: np.ndarray, alpha: float = 0.75) -> np.ndarray:
    """The plan in light grey with each labelled class painted over it."""
    base = np.repeat((155 + gray[..., None] * 0.39).astype(np.uint8), 3, axis=2)
    painted = COLOURS[labels]
    out = base.copy()
    mask = labels > 0
    out[mask] = (alpha * painted[mask] + (1 - alpha) * base[mask]).astype(np.uint8)
    return out


def around(mask: np.ndarray, *images: np.ndarray, margin: float = 0.06) -> list[np.ndarray]:
    """The images cut to where the mask is set, plus a margin: many plans are a small drawing on a large sheet."""
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return list(images)
    h, w = mask.shape
    my, mx = int(margin * (ys.max() - ys.min())) + 10, int(margin * (xs.max() - xs.min())) + 10
    y0, y1, x0, x1 = max(0, ys.min() - my), min(h, ys.max() + my), max(0, xs.min() - mx), min(w, xs.max() + mx)
    return [image[y0:y1, x0:x1] for image in images]


examples = [next(p for p in splits['train'] if kind(p) == k) for k in ('high_quality_architectural', 'high_quality', 'colorful')]
fig, axes = plt.subplots(2, 3, figsize=(16, 10))
for col, plan in enumerate(examples):
    gray, labels = around(load(plan)[1] > 0, *load(plan))
    axes[0, col].imshow(gray, cmap='gray')
    axes[0, col].set_title(plan)
    axes[1, col].imshow(overlay(gray, labels))
    axes[1, col].set_title('wall (teal), door (amber), window (magenta)')
for ax in axes.ravel():
    ax.axis('off')
plt.tight_layout()
plt.show()
'''),
        code('''
# How much of a plan each class covers, over 300 training plans.
pixels = np.zeros(4)
for plan in splits['train'][:300]:
    pixels += np.bincount(load(plan)[1].ravel(), minlength=4)
shares = pd.DataFrame({'class': CLASSES, 'share of pixels': (pixels / pixels.sum()).round(4)}).set_index('class')
display(shares)
'''),
        md('''
Walls cover only a few percent of a plan and doors and windows well under one percent. A loss that scores every pixel the same can
do well by saying "background" almost everywhere, which is why the loss in section 5 adds a Dice term per class.

## 3. Training crops

Plans are large and their sizes vary, so the model trains on 512 × 512 px crops. Each plan that is loaded gives four crops, most of
them centred on a wall, door or window pixel so they are not mostly empty paper. Every crop is scaled by 0.7–1.4×, turned by a
multiple of 90°, maybe mirrored, then made to look like another scan: contrast, faded or heavy ink, blur, grain and a grey
background. The input is *ink*: 0 for paper and 1 for black, so the zero padding at the edges reads as paper.
'''),
        code(extract('cubicasa.py', 'ink', 'random_crop', 'TrainCrops')),
        code('''
preview = TrainCrops(DATA, LABELS, splits['train'][:200], size=RUN['crop'], per_plan=4)
crops = [preview[i] for i in (0, 1)]
xs = np.concatenate([c[0] for c in crops])[:, 0]
ys = np.concatenate([c[1] for c in crops])
fig, axes = plt.subplots(2, 8, figsize=(20, 5.4))
for i in range(8):
    axes[0, i].imshow(1 - xs[i], cmap='gray', vmin=0, vmax=1)
    axes[1, i].imshow(COLOURS[ys[i]])
for ax in axes.ravel():
    ax.axis('off')
axes[0, 0].set_title('input (ink shown dark)', loc='left')
axes[1, 0].set_title('target classes', loc='left')
plt.tight_layout()
plt.show()
'''),
        md('''
## 3b. More drawing styles: ResPlan

CubiCasa5k is one country's drawings. On plans it never saw (section 8b) a model trained on it alone misses walls drawn in styles
CubiCasa5k rarely uses: hollow double-line walls, hatching, grey fills, other door and window symbols. ResPlan (2025) gives the
walls, doors, windows and rooms of 17,000 plans as polygons, but no images. So every time one of its 13,053 training plans is
used, `render_plan` draws it in a random style: solid, outlined, thick-outlined, hatched or grey walls; door swings, door leaves
or bare gaps; windows as two or three glass lines, a box or a grey fill; tinted or tiled rooms, room names and areas, furniture,
stairs, railings and dimension lines, and now and then a slightly turned page. Walls are drawn 4 to 18 px thick, the range plans
have at the size the app works at. The class map is drawn from the same polygons, with CubiCasa5k's conventions (doors and windows
fill their gap in the wall), so the labels are exact.

`MixedCrops` makes `resplan_share` of the training items such drawn plans, cut into crops exactly as CubiCasa5k plans are.
'''),
        code(extract('resplan.py', 'ROOM_NAMES', 'ROOM_KEYS', '_polygons', '_area_and_length', 'compact_plan', '_LOADED', 'load_resplan', '_px',
                     '_fill', '_rect', '_box', '_style', 'render_plan', 'MixedCrops')),
        code('''
if RESPLAN:
    resplan_plans = load_resplan(RESPLAN, limit=RUN.get('resplan_limit', 0))  # read once here; the training processes share it
    rng = np.random.default_rng(3)
    fig, axes = plt.subplots(2, 4, figsize=(20, 10))
    for col in range(4):
        gray, labels = render_plan(resplan_plans[int(rng.integers(len(resplan_plans)))], rng)
        axes[0, col].imshow(gray, cmap='gray', vmin=0, vmax=255)
        axes[1, col].imshow(COLOURS[labels])
    for ax in axes.ravel():
        ax.axis('off')
    axes[0, 0].set_title('ResPlan plans, each drawn in a random style', loc='left')
    axes[1, 0].set_title('their class maps', loc='left')
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, 'resplan_samples.png'), dpi=80)
    plt.show()
    walls = np.array([p['thickness'] for p in resplan_plans])
    print(f'{len(resplan_plans)} plans; typical wall thickness {np.median(walls):.3g} (in ResPlan units), '
          f'{np.mean([len(p["door"]) for p in resplan_plans]):.1f} doors and {np.mean([len(p["window"]) for p in resplan_plans]):.1f} windows a plan')
else:
    print('ResPlan is not attached (or resplan_share is 0): training on CubiCasa5k alone')
'''),
        md('''
## 4. The model

`RUN['arch']` picks one of two:

* **`unet`**: a plain U-Net (Ronneberger et al., 2015) trained from scratch: five levels of two 3 × 3 convolutions with batch norm,
  max-pooling on the way down, transposed convolutions and skip connections on the way up, and a 1 × 1 convolution to four class
  scores per pixel. At width 32 the levels have 32, 64, 128, 256 and 512 channels: 7.8 M parameters.
* **`resunet34`**: a U-Net decoder on a ResNet-34 encoder (He et al., 2016) that starts from ImageNet weights, with concurrent
  spatial and channel squeeze-and-excitation (scSE, Roy et al., 2018) after every decoder stage and a small full-resolution stem
  as the last skip, so thin walls keep sharp edges: 24 M parameters. Recent floor-plan work (MitUNet, 2025) finds pretrained
  encoders with a U-Net decoder and attention generalise better than a U-Net from scratch; a larger transformer encoder would be
  too heavy to download in a browser.

Whole plans are predicted in overlapping 1,024 px tiles (`predict_plan`), keeping only the middle of each tile, so a plan of any
size fits in memory and tile edges never show.
'''),
        code(extract('model.py', '_block', 'UNet', '_BasicBlock', 'ResNet34Encoder', 'RESNET34_IMAGENET', 'load_imagenet_weights', 'SCSE', '_UpBlock',
                     'ResUNet34', 'build_model', 'predict_plan')),
        code('''
# Built here only to count its parameters. Running it waits for the training processes: they are forked from this notebook,
# and a forked process should not inherit a CPU thread pool (or a GPU context) that PyTorch has already started.
net = build_model({'arch': 'unet', 'width': RUN['width']} if RUN['arch'] == 'unet' else {'arch': RUN['arch']})
s = RUN['crop']
if RUN['arch'] == 'unet':
    display(pd.DataFrame({'channels': [RUN['width'] * 2 ** i for i in range(5)], 'resolution of a crop': [f'{s >> i} × {s >> i}' for i in range(5)]},
                         index=pd.Index(range(1, 6), name='level')))
elif RUN.get('pretrained', 1):
    # Fetch the ImageNet weights once, here, so the training processes find them in the cache.
    load_imagenet_weights(net.encoder, torch.hub.load_state_dict_from_url(RESNET34_IMAGENET, map_location='cpu', progress=False))
    print('ImageNet weights for the ResNet-34 encoder fetched and checked')
print(f'{RUN["arch"]}: {sum(p.numel() for p in net.parameters()) / 1e6:.2f} M parameters; output: 4 class scores for every input pixel')
del net
'''),
        md(r'''
## 5. The loss

Cross-entropy scores every pixel; soft Dice scores the overlap of each class as a whole, so thin walls and small doors count as much
as they should. The Dice term covers wall, door and window; background is left out because it is most of every plan.

$$
\mathcal{L} = -\frac{1}{N}\sum_{i=1}^{N} \log p_{i,\,y_i} \;+\; \frac{1}{3}\sum_{c\,\in\,\{\text{wall},\,\text{door},\,\text{window}\}}
\left(1 - \frac{2\sum_i p_{i,c}\,g_{i,c} + 1}{\sum_i p_{i,c} + \sum_i g_{i,c} + 1}\right)
$$

$p_{i,c}$ is the predicted probability that pixel $i$ is class $c$, $y_i$ its true class and $g_{i,c}$ 1 when that class is $c$.
Scores are reported as IoU: $|F \cap T| \,/\, |F \cup T|$ for the pixels found $F$ and the true pixels $T$ of a class.
'''),
        code(extract('train.py', 'collate', 'dice_loss', 'iou', 'plan_scores')),
        md('''
## 5b. Plans it never trains on

CVC-FP (de las Heras et al., 2015) holds 121 scanned plans of another country in four styles, with walls, doors and windows
labelled. None is ever trained on or used to choose a checkpoint; they are scored once at the end, the way the browser predicts:
shrunk to a longest side of 1,600 px, in 512 px tiles. The Kaggle copy's label pictures are shifted against their scans, so each
is lined up with its scan's ink first. The same 96 plans as the app's baseline are scored (25 are left out: labels covering only
part of the page, unlabelled walls, or scans the app cannot read).
'''),
        code(extract('heldout.py', 'CVCFP_COLOURS', 'CVCFP_EXCLUDED', 'cvcfp_plans', '_best_shift', '_shifted', 'cvcfp_truth', 'score_cvcfp')),
        md('''
## 6. Training

`train_worker` runs once per GPU. With two T4s the two processes train one model together (PyTorch DistributedDataParallel): each
takes its own crops, and their gradients are averaged every step. They are forked from this notebook, so all the code above is
theirs too. Settings that make the T4s fast: half precision with a gradient scaler, channels-last memory, and cuDNN autotuning.

The learning rate warms up over 300 steps and then follows a cosine down to 2% of its peak. Its clock is whichever budget is
further along, steps or minutes, so a time-limited run still ends with a full cool-down. Every `val_every` steps the model is scored
on the validation plans and the best checkpoint is kept. At the end that checkpoint predicts every test plan: its scores go to
`test_results.json`, and its class maps to `pred_test/`, where the app's own scorer can read them too.
'''),
        code(extract('train.py', 'TrainConfig', 'train_worker')),
        code('''
cfg = TrainConfig(data=DATA, labels=LABELS, out=OUT, resplan=RESPLAN, heldout=CVCFP, **RUN)
for name in ('log.txt', 'history.json'):  # a fresh history for this run
    if os.path.exists(os.path.join(OUT, name)):
        os.remove(os.path.join(OUT, name))
started = time.time()
if WORLD > 1:
    import torch.multiprocessing as mp
    mp.start_processes(train_worker, args=(WORLD, cfg), nprocs=WORLD, start_method='fork')
else:
    train_worker(0, 1, cfg)
print(f'training and testing took {(time.time() - started) / 60:.1f} min')
'''),
        md('''
## 7. How training went
'''),
        code('''
history = json.load(open(os.path.join(OUT, 'history.json')))
loss = pd.DataFrame(history['loss'])
val = pd.DataFrame(history['val'])
fig, (a, b) = plt.subplots(1, 2, figsize=(15, 4))
a.plot(loss['step'], loss['loss'], color='#2f70bb', lw=1.5)
a.set_title('training loss')
a.set_xlabel('step')
b.plot(val['step'], val['iou'], 'o-', color='#2f70bb', lw=2, label='walls')
b.plot(val['step'], val['openings_iou'], 'o-', color='#c98500', lw=2, label='doors and windows')
b.set_title(f'IoU on the {int(val["plans"].iloc[-1])} validation plans')
b.set_xlabel('step')
b.legend(frameon=False)
for ax in (a, b):
    ax.grid(alpha=0.25)
    ax.spines[['top', 'right']].set_visible(False)
plt.show()
best = val.loc[val['iou'].idxmax()]
print(f'{int(loss["step"].iloc[-1])} steps in {loss["minutes"].iloc[-1]:.0f} min at about {loss["crops_per_s"].median():.0f} crops/s; '
      f'best validation wall IoU {best["iou"]:.3f} at step {int(best["step"])}')
'''),
        md('''
## 8. The test plans

The kept checkpoint against the hand-written rules that FloorPlan3D's *Image to plan* uses today. The rules' scores below were
measured by the app's `scripts/evaluate-cubicasa.ts` on the same 400 test plans with the same truth and the same IoU; this
notebook's scorer draws the identical truth, so the two columns compare like with like.
'''),
        code(f'''
# Wall IoU of the rule pipeline (OpenCV.js, "Fill outlined walls" 9 px) on each test plan, from the FloorPlan3D repository.
RULES_IOU = {{
{rule_lines},
}}
'''),
        code('''
results = json.load(open(os.path.join(OUT, 'test_results.json')))
rows = pd.DataFrame(results['rows']).set_index('plan')
rows['kind'] = [kind(p) for p in rows.index]
rows['rules_iou'] = [RULES_IOU.get(p, np.nan) for p in rows.index]
s = results['summary']
both = rows.dropna(subset=['rules_iou'])
display(Markdown(
    f"| on {s['plans']} test plans | trained model | rules |\\n|---|---|---|\\n"
    f"| wall IoU (mean) | **{s['iou']:.1%}** | {both['rules_iou'].mean():.1%} |\\n"
    f"| wall IoU (median) | {s['median_iou']:.1%} | {both['rules_iou'].median():.1%} |\\n"
    f"| precision / recall | {s['precision']:.1%} / {s['recall']:.1%} | |\\n"
    f"| door and window IoU | {s['openings_iou']:.1%} | not found by the rules |\\n"
    f"| model better on | {(both['iou'] > both['rules_iou']).sum()} of {len(both)} plans | |\\n"
    f"| checkpoint | step {s['best_step']} | |"
))
display(rows.groupby('kind')[['iou', 'rules_iou', 'openings_iou']].mean().round(3).rename(
    columns={'iou': 'model wall IoU', 'rules_iou': 'rules wall IoU', 'openings_iou': 'model door+window IoU'}))
'''),
        code('''
fig, (a, b) = plt.subplots(1, 2, figsize=(15, 5.5))
a.scatter(both['rules_iou'], both['iou'], s=14, color='#2f70bb', alpha=0.6)
a.plot([0, 1], [0, 1], color='grey', lw=1)
a.set_xlim(0, 1)
a.set_ylim(0, 1)
a.set_xlabel('rules, wall IoU')
a.set_ylabel('trained model, wall IoU')
a.set_title('each dot is one test plan; above the line the model is better')
bins = np.linspace(0, 1, 26)
b.hist(both['rules_iou'], bins=bins, color='#c98500', alpha=0.8, label='rules')
b.hist(both['iou'], bins=bins, color='#2f70bb', alpha=0.8, label='trained model')
b.set_xlabel('wall IoU')
b.set_ylabel('plans')
b.legend(frameon=False)
for ax in (a, b):
    ax.grid(alpha=0.25)
    ax.spines[['top', 'right']].set_visible(False)
plt.show()
'''),
        md('''
## 8b. Plans it never saw: CVC-FP

The real test of whether more drawing styles help. Run 2 is the CubiCasa5k-only U-Net the app uses today; its scores and the
rules' were measured on these same 96 plans, the same way.
'''),
        code(f'''
# Wall IoU of the rules and of run 2 on each scored CVC-FP plan: (rules, run 2), from training/kaggle/cvcfp_baseline.json.
CVCFP_BASELINE = {{
{baseline_lines},
}}
'''),
        code('''
path = os.path.join(OUT, 'heldout_cvcfp.json')
if os.path.exists(path):
    held = json.load(open(path))
    h = pd.DataFrame(held['rows']).set_index('plan')
    h['rules'] = [CVCFP_BASELINE.get(p, (np.nan, np.nan))[0] for p in h.index]
    h['run2'] = [CVCFP_BASELINE.get(p, (np.nan, np.nan))[1] for p in h.index]
    k = held['summary']
    display(Markdown(
        f"| on {k['plans']} CVC-FP plans | this run | run 2 (CubiCasa5k only) | rules |\\n|---|---|---|---|\\n"
        f"| wall IoU (mean) | **{k['iou']:.1%}** | {h['run2'].mean():.1%} | {h['rules'].mean():.1%} |\\n"
        f"| wall IoU (median) | {k['median_iou']:.1%} | {h['run2'].median():.1%} | {h['rules'].median():.1%} |\\n"
        f"| precision / recall | {k['precision']:.1%} / {k['recall']:.1%} | | |\\n"
        f"| door and window IoU | {k['openings_iou'] or 0:.1%} | 56.0% | not found |\\n"
        f"| better than run 2 on | {(h['iou'] > h['run2']).sum()} of {h['run2'].notna().sum()} plans | | |"
    ))
    fig, ax = plt.subplots(figsize=(6.5, 6))
    ax.scatter(h['run2'], h['iou'], s=16, color='#2f70bb', alpha=0.7)
    ax.plot([0, 1], [0, 1], color='grey', lw=1)
    ax.set_xlim(0.3, 1)
    ax.set_ylim(0.3, 1)
    ax.set_xlabel('run 2 (CubiCasa5k only), wall IoU')
    ax.set_ylabel('this run, wall IoU')
    ax.set_title('each dot is one CVC-FP plan; above the line this run is better')
    ax.grid(alpha=0.25)
    ax.spines[['top', 'right']].set_visible(False)
    plt.show()
else:
    print('CVC-FP was not attached, so no held-out score')
'''),
        md('''
## 9. Where it goes wrong

The best, a typical (median) and the worst test plan. Teal is wall found, red is wall found where there is none, amber is wall missed.
'''),
        code('''
def errors(gray: np.ndarray, labels: np.ndarray, pred: np.ndarray) -> np.ndarray:
    truth, found = labels == 1, pred == 1
    out = np.repeat((165 + gray[..., None] * 0.35).astype(np.uint8), 3, axis=2)
    out[truth & found] = (27, 108, 128)
    out[found & ~truth] = (229, 86, 111)
    out[truth & ~found] = (232, 160, 32)
    return out


ranked = rows.sort_values('iou')
picks = {'best': ranked.index[-1], 'typical': ranked.index[len(ranked) // 2], 'worst': ranked.index[0]}
fig, axes = plt.subplots(1, 3, figsize=(18, 7))
for ax, (label, plan) in zip(axes, picks.items()):
    gray, labels = load(plan)
    pred = cv2.imread(os.path.join(OUT, 'pred_test', plan_name(plan) + '.png'), cv2.IMREAD_UNCHANGED)
    ax.imshow(around((labels > 0) | (pred > 0), errors(gray, labels, pred))[0])
    ax.set_title(f'{label}: {plan}, wall IoU {rows.loc[plan, "iou"]:.1%} (rules {rows.loc[plan, "rules_iou"]:.1%})')
    ax.axis('off')
plt.tight_layout()
plt.show()
'''),
        md('''
## 10. Export for the browser

FloorPlan3D runs in the browser, so the model is exported to ONNX for onnxruntime-web, with the image height and width left free.
The export is checked against PyTorch on a tile of a test plan. `model_card.json` records what the browser needs to feed it.
'''),
        code('''
checkpoint = torch.load(os.path.join(OUT, 'model_best.pt'), map_location='cpu')
export_net = build_model(checkpoint['config']).eval()
export_net.load_state_dict(checkpoint['state'])
onnx_path = os.path.join(OUT, 'floorplan3d_walls.onnx')
dummy = torch.zeros(1, 1, 512, 512)
exported = False
for dynamo in (False, True):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', DeprecationWarning)  # the TorchScript exporter is deprecated but still the simplest here
            torch.onnx.export(export_net, (dummy,), onnx_path, input_names=['ink'], output_names=['logits'], opset_version=17,
                              dynamic_axes={'ink': {2: 'height', 3: 'width'}, 'logits': {2: 'height', 3: 'width'}}, dynamo=dynamo)
        exported = True
        print(f'exported {onnx_path} ({os.path.getsize(onnx_path) / 1e6:.1f} MB, {"dynamo" if dynamo else "TorchScript"} exporter)')
        break
    except Exception as err:  # the exporters need optional packages; report and try the other one
        print(f'{"dynamo" if dynamo else "TorchScript"} exporter failed: {type(err).__name__}: {str(err)[:200]}')

if exported:
    try:
        import onnxruntime as ort
        gray, _ = load(splits['test'][0])
        tile = np.full((1024, 1024), 255, np.uint8)
        h, w = min(1024, gray.shape[0]), min(1024, gray.shape[1])
        tile[:h, :w] = gray[:h, :w]
        x = ink(tile)[None, None]
        onnx_classes = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider']).run(None, {'ink': x})[0].argmax(1)
        with torch.no_grad():
            torch_classes = export_net(torch.from_numpy(x)).argmax(1).numpy()
        print(f'ONNX and PyTorch agree on {(onnx_classes == torch_classes).mean():.4%} of the pixels of a 1,024 px test tile')
    except ImportError:
        print('onnxruntime is not installed here; check the export with training/check_onnx.py on a machine that has it')

card = {
    'model': f'FloorPlan3D wall model ({checkpoint["config"].get("arch", "unet")})', 'classes': list(CLASSES), 'config': checkpoint['config'],
    'checkpoint_step': checkpoint['step'], 'trained_on': ['CubiCasa5k'] + (['ResPlan, drawn in random styles'] if RESPLAN else []),
    'input': 'ink = 1 - gray / 255 (0 paper, 1 black), shape [1, 1, H, W] float32, H and W multiples of 32',
    'tiling': {'tile': 512, 'margin': 96}, 'onnx': os.path.basename(onnx_path) if exported else None,
    'validation': checkpoint['val'], 'test': results['summary'],
    'heldout_cvcfp': json.load(open(os.path.join(OUT, 'heldout_cvcfp.json')))['summary'] if os.path.exists(os.path.join(OUT, 'heldout_cvcfp.json')) else None,
    'data': 'CubiCasa5k (CC BY-NC-SA 4.0): non-commercial use only',
}
json.dump(card, open(os.path.join(OUT, 'model_card.json'), 'w'), indent=1)
'''),
        md('''
## 11. What this run leaves

`model_best.pt` (the kept checkpoint), `model_last.pt`, `history.json` and `log.txt` (the training record), `test_results.json` and
`pred_test/` (scores and class maps of the test plans), `floorplan3d_walls.onnx` and `model_card.json` (for the browser).
'''),
        code('''
for name in sorted(os.listdir(OUT)):
    path = os.path.join(OUT, name)
    size = sum(os.path.getsize(os.path.join(path, f)) for f in os.listdir(path)) if os.path.isdir(path) else os.path.getsize(path)
    print(f'{name:28s} {size / 1e6:8.1f} MB')
'''),
    ]
    return {
        'cells': cells,
        'metadata': {
            'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'},
            'language_info': {'name': 'python'},
        },
        'nbformat': 4,
        'nbformat_minor': 5,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--minutes', type=float, default=180)
    ap.add_argument('--steps', type=int, default=60000)
    ap.add_argument('--test-limit', type=int, default=400)
    ap.add_argument('--arch', default='unet', choices=sorted(LEARNING_RATES))
    ap.add_argument('--resplan-share', type=float, default=0.4)
    ap.add_argument('--title', default='FloorPlan3D walls notebook')
    ap.add_argument('--notebook', default=NOTEBOOK, help='where to write the notebook')
    ap.add_argument('--kaggle-dir', default=os.path.join(HERE, 'build', 'notebook'), help='folder to push to Kaggle')
    ap.add_argument('--slug', default='floorplan3d-walls-notebook')
    ap.add_argument('--owner', default='jeswintobias')
    args = ap.parse_args()

    notebook = build(args.minutes if args.minutes % 1 else int(args.minutes), args.steps, args.test_limit, args.arch, args.resplan_share)
    for i, cell in enumerate(notebook['cells']):
        cell['id'] = f'cell-{i:02d}'
    text = json.dumps(notebook, indent=1, ensure_ascii=False) + '\n'
    with open(args.notebook, 'w') as f:
        f.write(text)

    os.makedirs(args.kaggle_dir, exist_ok=True)
    code_file = os.path.basename(NOTEBOOK)
    with open(os.path.join(args.kaggle_dir, code_file), 'w') as f:
        f.write(text)
    meta = {
        'id': f'{args.owner}/{args.slug}',
        'title': args.title,
        'code_file': code_file,
        'language': 'python',
        'kernel_type': 'notebook',
        'is_private': True,
        'enable_gpu': True,
        'enable_tpu': False,
        'enable_internet': True,  # the ImageNet weights of the ResNet-34 encoder
        'machine_shape': 'NvidiaTeslaT4',
        'dataset_sources': ['qmarva/cubicasa5k', 'resplan/resplan', 'asutoshprad/floor-plan-dataset'],
        'competition_sources': [],
        'kernel_sources': [],
        'model_sources': [],
    }
    with open(os.path.join(args.kaggle_dir, 'kernel-metadata.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    code_cells = sum(c['cell_type'] == 'code' for c in notebook['cells'])
    print(f'{args.notebook}: {len(notebook["cells"])} cells ({code_cells} code), {len(text) / 1000:.0f} kB; '
          f'Kaggle folder {args.kaggle_dir} ({meta["id"]}), {args.minutes} min, test {args.test_limit} plans')


if __name__ == '__main__':
    main()
