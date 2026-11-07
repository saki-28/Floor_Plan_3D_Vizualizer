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


def build(minutes: float, steps: int, test_limit: int) -> dict:
    rules = rules_scores()
    rule_lines = ',\n'.join(
        '    ' + ', '.join(f'{plan!r}: {score}' for plan, score in list(rules.items())[i:i + 3]) for i in range(0, len(rules), 3)
    )
    cells = [
        md('''
# FloorPlan3D: walls, doors and windows from floor plan images

This notebook trains the model behind FloorPlan3D's **Image to plan**: a U-Net that labels every pixel of a floor plan image as
*background*, *wall*, *door* or *window*. It runs top to bottom on Kaggle's two T4 GPUs and leaves the trained model, its scores
on the 400 test plans and an ONNX copy for the browser in its output.

| Section | What it shows |
|---|---|
| 0. Settings | the run's settings and the machine |
| 1. The data | CubiCasa5k: 5,000 plans in three kinds, split 4,200 / 400 / 400 |
| 2. Labels | the hand-traced polygons drawn as one class map per plan, exactly as the app's scorer draws them |
| 3. Training crops | 512 px crops with scale, rotation and scan-like noise |
| 4. The model | a plain U-Net, 7.8 M parameters |
| 5. The loss | cross-entropy plus soft Dice |
| 6. Training | one process per GPU, half precision, a time-budgeted schedule |
| 7. How training went | loss and validation scores over time |
| 8. The test plans | wall IoU on all 400 test plans, against the hand-written rules of the app |
| 9. Where it goes wrong | the best, a typical and the worst test plan, pixel by pixel |
| 10. Export for the browser | the model as ONNX, checked against PyTorch |

Every code cell below is cut from the FloorPlan3D repository's `training/` modules by `training/kaggle/build_notebook.py`, so this
notebook runs exactly the code its tests check.

**Data and licence.** CubiCasa5k (Kalervo et al., *CubiCasa5K: A Dataset and an Improved Multi-Task Model for Floorplan Image
Analysis*, SCIA 2019) is licensed CC BY-NC-SA 4.0. It, this notebook's outputs and the model trained here are for non-commercial
use only.
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
    width=32,          # U-Net width: 32 channels at full resolution, 7.8 M parameters
    crop=512,          # training crops are 512 × 512 px
    batch=8,           # crops per GPU per step
    per_plan=4,        # crops cut from each plan that is loaded
    minutes={minutes!r},       # training time budget; the schedule fits itself to it
    steps={steps!r},       # step budget; whichever runs out first ends training
    lr=2e-3,           # peak learning rate (AdamW), after a 300-step warm-up, then cosine down to 2%
    val_plans=60,      # validation plans scored every val_every steps; the best checkpoint is kept
    val_every=3000,
    test_limit={test_limit!r},   # test plans scored at the end
    train_limit=0,     # 0 = all 4,200 training plans
    workers=2,         # data-loading processes per GPU
    log_every=200,
)
if QUICK:
    RUN.update(width=8, crop=128, minutes=1, steps=30, val_plans=2, val_every=15, test_limit=3, train_limit=12, workers=0, log_every=10, device='cpu')
RUN
'''),
        code('''
from __future__ import annotations

import json
import math
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
print(f'data {DATA}\\nlabels {LABELS}\\noutput {OUT}')
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
        code(extract('cubicasa.py', 'ink', 'TrainCrops')),
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
## 4. The model

A plain U-Net (Ronneberger et al., 2015): five levels of two 3 × 3 convolutions with batch norm, max-pooling on the way down,
transposed convolutions and skip connections on the way up, and a 1 × 1 convolution to four class scores per pixel. At width 32 the
levels have 32, 64, 128, 256 and 512 channels: 7.8 M parameters.

Whole plans are predicted in overlapping 1,024 px tiles (`predict_plan`), keeping only the middle of each tile, so a plan of any
size fits in memory and tile edges never show.
'''),
        code(extract('model.py', '_block', 'UNet', 'predict_plan')),
        code('''
# Built here only to count its parameters. Running it waits for the training processes: they are forked from this notebook,
# and a forked process should not inherit a CPU thread pool (or a GPU context) that PyTorch has already started.
net = UNet(RUN['width'])
s = RUN['crop']
display(pd.DataFrame({'channels': [RUN['width'] * 2 ** i for i in range(5)], 'resolution of a crop': [f'{s >> i} × {s >> i}' for i in range(5)]},
                     index=pd.Index(range(1, 6), name='level')))
print(f'{sum(p.numel() for p in net.parameters()) / 1e6:.2f} M parameters; output: 4 class scores for every input pixel')
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
cfg = TrainConfig(data=DATA, labels=LABELS, out=OUT, **RUN)
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
export_net = UNet(**checkpoint['config']).eval()
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
    'model': 'FloorPlan3D wall model (U-Net)', 'classes': list(CLASSES), 'config': checkpoint['config'], 'checkpoint_step': checkpoint['step'],
    'input': 'ink = 1 - gray / 255 (0 paper, 1 black), shape [1, 1, H, W] float32, H and W multiples of 32',
    'tiling': {'tile': 1024, 'margin': 96}, 'onnx': os.path.basename(onnx_path) if exported else None,
    'validation': checkpoint['val'], 'test': results['summary'],
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
    ap.add_argument('--notebook', default=NOTEBOOK, help='where to write the notebook')
    ap.add_argument('--kaggle-dir', default=os.path.join(HERE, 'build', 'notebook'), help='folder to push to Kaggle')
    ap.add_argument('--slug', default='floorplan3d-walls-notebook')
    ap.add_argument('--owner', default='jeswintobias')
    args = ap.parse_args()

    notebook = build(args.minutes if args.minutes % 1 else int(args.minutes), args.steps, args.test_limit)
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
        'title': 'FloorPlan3D walls notebook',
        'code_file': code_file,
        'language': 'python',
        'kernel_type': 'notebook',
        'is_private': True,
        'enable_gpu': True,
        'enable_tpu': False,
        'enable_internet': False,
        'machine_shape': 'NvidiaTeslaT4',
        'dataset_sources': ['qmarva/cubicasa5k'],
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
