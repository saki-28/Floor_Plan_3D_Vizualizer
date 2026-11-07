"""Trains the wall model on CubiCasa5k, picks the best checkpoint on val plans, then predicts the test plans.

One GPU, the Mac's GPU or the CPU:
    python3 -I training/train.py --data data/cubicasa5k/cubicasa5k --labels <dir> --out <dir> [--steps N] [--minutes M]
Several GPUs (Kaggle's 2× T4), one process per GPU:
    torchrun --standalone --nproc_per_node=2 training/train.py ...
The notebook (training/floorplan3d_walls.ipynb) calls train_worker directly, one forked process per GPU.

Labels are drawn first with cubicasa.prepare_labels (train_worker does it if they are missing). The
test predictions are written as class maps (0 background, 1 wall, 2 door, 3 window), one PNG per
plan, for scripts/evaluate-cubicasa.ts --masks to score with the same truth and metric as the
rule pipeline. history.json records the loss and every validation, for plotting.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import MISSING, asdict, dataclass, fields

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.distributed as dist  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from torch.utils.data import DataLoader, DistributedSampler, RandomSampler  # noqa: E402

from cubicasa import DOOR, WALL, WINDOW, TrainCrops, ink, plan_name, prepare_labels, read_split  # noqa: E402
from model import UNet, predict_plan  # noqa: E402


def collate(batch):
    xs, ys = zip(*batch)
    return torch.from_numpy(np.concatenate(xs)), torch.from_numpy(np.concatenate(ys))


def dice_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Soft Dice over wall, door and window (background left out: it is most of every plan)."""
    probs = logits.softmax(1)
    onehot = F.one_hot(target, probs.shape[1]).permute(0, 3, 1, 2).to(probs.dtype)
    inter = (probs * onehot).sum((0, 2, 3))
    denom = probs.sum((0, 2, 3)) + onehot.sum((0, 2, 3))
    return (1 - (2 * inter + 1) / (denom + 1))[1:].mean()


def iou(a: np.ndarray, b: np.ndarray) -> float | None:
    union = np.count_nonzero(a | b)
    return None if union == 0 else np.count_nonzero(a & b) / union


def plan_scores(pred: np.ndarray, labels: np.ndarray) -> dict:
    found, truth = pred == WALL, labels == WALL
    overlap = np.count_nonzero(found & truth)
    nf, nt = np.count_nonzero(found), np.count_nonzero(truth)
    openings_pred = (pred == DOOR) | (pred == WINDOW)
    openings_true = (labels == DOOR) | (labels == WINDOW)
    return {
        'iou': iou(found, truth) or 0.0,
        'precision': overlap / nf if nf else 0.0,
        'recall': overlap / nt if nt else 0.0,
        'openings_iou': iou(openings_pred, openings_true),
    }


@dataclass
class TrainConfig:
    data: str  # folder holding train.txt, val.txt, test.txt
    labels: str  # folder of class-map PNGs (drawn if missing)
    out: str
    width: int = 32  # U-Net width: 32 is 7.8 M parameters
    crop: int = 512
    batch: int = 8  # crops per GPU per step
    per_plan: int = 4  # crops taken from each plan load
    steps: int = 24000
    minutes: float = 95  # training time budget; the schedule ends at whichever comes first
    lr: float = 2e-3
    val_plans: int = 60
    val_every: int = 3000
    test_limit: int = 400
    train_limit: int = 0  # use only the first N training plans (0 = all; for quick checks)
    workers: int = 2  # data loader processes per GPU
    log_every: int = 200
    device: str = 'auto'


def train_worker(rank: int, world: int, cfg: TrainConfig) -> None:
    """Trains on one GPU (or the CPU) as process `rank` of `world`; with world > 1 the processes train one model together (DDP)."""
    distributed = world > 1
    if distributed:
        os.environ.setdefault('MASTER_ADDR', '127.0.0.1')
        os.environ.setdefault('MASTER_PORT', '29531')
        if torch.cuda.is_available():
            torch.cuda.set_device(rank % torch.cuda.device_count())
            device = torch.device('cuda', torch.cuda.current_device())
            dist.init_process_group('nccl', rank=rank, world_size=world, device_id=device)
        else:
            device = torch.device('cpu')
            dist.init_process_group('gloo', rank=rank, world_size=world)
        # A process forked from one that already used PyTorch's or OpenCV's CPU thread pools (the notebook) cannot safely use the
        # pools it inherited. One thread is plenty: the GPUs do the work, and the data loaders are separate processes.
        torch.set_num_threads(1)
        cv2.setNumThreads(0)  # the same for OpenCV's thread pool; the data loaders inherit this
    else:
        name = cfg.device if cfg.device != 'auto' else ('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu')
        device = torch.device(name)
    cuda = device.type == 'cuda'
    if cuda:
        torch.backends.cudnn.benchmark = True
    os.makedirs(cfg.out, exist_ok=True)
    log_file = open(os.path.join(cfg.out, 'log.txt'), 'a') if rank == 0 else None
    history: dict = {'config': asdict(cfg), 'world': world, 'device': device.type, 'loss': [], 'val': []}

    def log(msg: str) -> None:
        if rank == 0:
            line = f'[{time.strftime("%H:%M:%S")}] {msg}'
            print(line, flush=True)
            log_file.write(line + '\n')
            log_file.flush()

    def record(kind: str, entry: dict) -> None:
        if rank == 0:
            history[kind].append(entry)
            with open(os.path.join(cfg.out, 'history.json'), 'w') as f:
                json.dump(history, f, indent=1)

    def barrier() -> None:
        if distributed:
            dist.barrier()

    if rank == 0 and not os.path.exists(os.path.join(cfg.labels, '.done')):
        t = time.time()
        made = prepare_labels(cfg.data, cfg.labels)
        open(os.path.join(cfg.labels, '.done'), 'w').close()
        log(f'labels drawn for {made} plans in {time.time() - t:.0f} s')
    barrier()

    train_plans = read_split(cfg.data, 'train')
    if cfg.train_limit:
        train_plans = train_plans[:cfg.train_limit]
    val_plans = read_split(cfg.data, 'val')[:cfg.val_plans]
    test_plans = read_split(cfg.data, 'test')[:cfg.test_limit]
    dataset = TrainCrops(cfg.data, cfg.labels, train_plans, size=cfg.crop, per_plan=cfg.per_plan)
    sampler = DistributedSampler(dataset, shuffle=True) if distributed else RandomSampler(dataset)
    loader = DataLoader(dataset, batch_size=max(1, cfg.batch // cfg.per_plan), sampler=sampler, num_workers=cfg.workers,
                        collate_fn=collate, pin_memory=cuda, drop_last=True, persistent_workers=cfg.workers > 0,
                        prefetch_factor=4 if cfg.workers > 0 else None)

    net = UNet(cfg.width).to(device)
    if cuda:
        net = net.to(memory_format=torch.channels_last)
    model = (
        # Gradients live inside DDP's communication buckets, so their memory layout always matches (and is not copied).
        torch.nn.parallel.DistributedDataParallel(net, device_ids=[device.index] if cuda else None, gradient_as_bucket_view=True)
        if distributed else net
    )
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=1e-4)
    scaler = torch.amp.GradScaler('cuda', enabled=cuda)
    params = sum(p.numel() for p in net.parameters()) / 1e6
    log(f'{world} × {device.type}, {len(train_plans)} train plans, {params:.1f} M params, '
        f'{cfg.batch * world} crops per step, up to {cfg.steps} steps or {cfg.minutes:.0f} min')

    def evaluate(plans: list[str], pred_dir: str | None = None) -> tuple[dict, list[dict]]:
        net.eval()
        rows = []
        for i, plan in enumerate(plans):
            if i % world != rank:
                continue
            gray = cv2.imread(os.path.join(cfg.data, plan, 'F1_scaled.png'), cv2.IMREAD_GRAYSCALE)
            labels = cv2.imread(os.path.join(cfg.labels, plan_name(plan) + '.png'), cv2.IMREAD_UNCHANGED)
            t = time.time()
            pred = predict_plan(net, ink(gray), device)
            ms = (time.time() - t) * 1000
            if pred_dir:
                cv2.imwrite(os.path.join(pred_dir, plan_name(plan) + '.png'), pred)
            rows.append({'plan': plan, 'width': gray.shape[1], 'height': gray.shape[0], 'ms': ms, **plan_scores(pred, labels)})
        net.train()
        sums = torch.tensor([sum(r['iou'] for r in rows), sum(r['precision'] for r in rows), sum(r['recall'] for r in rows),
                             sum(r['openings_iou'] for r in rows if r['openings_iou'] is not None),
                             sum(1 for r in rows if r['openings_iou'] is not None), len(rows)], dtype=torch.float64,
                            device=device if distributed and cuda else 'cpu')
        if distributed:
            dist.all_reduce(sums)
        s = sums.tolist()
        n = max(s[5], 1)
        return {'iou': s[0] / n, 'precision': s[1] / n, 'recall': s[2] / n, 'openings_iou': s[3] / max(s[4], 1), 'plans': int(s[5])}, rows

    def save(path: str, step: int, metrics: dict) -> None:
        if rank == 0:
            torch.save({'state': net.state_dict(), 'config': net.config, 'step': step, 'val': metrics}, path)

    start = time.time()
    budget = cfg.minutes * 60
    step, time_frac, best = 0, 0.0, -1.0
    seen = 0
    sample_every = max(1, cfg.log_every // 4)  # the loss is read (a GPU sync) only this often
    window_start, window_loss, window_samples = time.time(), 0.0, 0
    epoch = 0
    model.train()
    done = False
    while not done:
        if distributed:
            sampler.set_epoch(epoch)
        for x, y in loader:
            progress = max(step / cfg.steps, time_frac)
            if progress >= 1:
                done = True
                break
            warm = min(1.0, (step + 1) / 300)
            lr = cfg.lr * warm * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * progress)))
            for g in opt.param_groups:
                g['lr'] = lr
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)
            if cuda:
                x = x.contiguous(memory_format=torch.channels_last)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device.type, dtype=torch.float16, enabled=cuda):
                logits = model(x)
            logits = logits.float()
            loss = F.cross_entropy(logits, y) + dice_loss(logits, y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            step += 1
            seen += x.shape[0] * world
            if step % sample_every == 0:
                window_loss += loss.item()
                window_samples += 1

            if step % 50 == 0:
                frac = torch.tensor([(time.time() - start) / budget], device=device)
                if distributed:
                    dist.all_reduce(frac, op=dist.ReduceOp.MAX)
                time_frac = float(frac.item())
            if step % cfg.log_every == 0:
                rate = cfg.log_every * x.shape[0] * world / (time.time() - window_start)
                minutes = (time.time() - start) / 60
                mean_loss = window_loss / max(window_samples, 1)
                log(f'step {step:6d}  loss {mean_loss:.4f}  lr {lr:.2e}  {rate:5.1f} crops/s  {minutes:5.1f} min  {seen / 1000:.0f}k crops')
                record('loss', {'step': step, 'loss': mean_loss, 'lr': lr, 'crops_per_s': rate, 'minutes': minutes})
                window_start, window_loss, window_samples = time.time(), 0.0, 0
            if step % cfg.val_every == 0:
                metrics, _ = evaluate(val_plans)
                log(f'val on {metrics["plans"]} plans: wall IoU {metrics["iou"]:.3f} (precision {metrics["precision"]:.3f}, '
                    f'recall {metrics["recall"]:.3f}), door+window IoU {metrics["openings_iou"]:.3f}')
                record('val', {'step': step, 'minutes': (time.time() - start) / 60, **metrics})
                if metrics['iou'] > best:
                    best = metrics['iou']
                    save(os.path.join(cfg.out, 'model_best.pt'), step, metrics)
                window_start = time.time()
        epoch += 1

    metrics, _ = evaluate(val_plans)
    log(f'final val on {metrics["plans"]} plans: wall IoU {metrics["iou"]:.3f} (precision {metrics["precision"]:.3f}, '
        f'recall {metrics["recall"]:.3f}), door+window IoU {metrics["openings_iou"]:.3f}  after {step} steps, {seen / 1000:.0f}k crops, '
        f'{(time.time() - start) / 60:.1f} min')
    record('val', {'step': step, 'minutes': (time.time() - start) / 60, 'final': True, **metrics})
    save(os.path.join(cfg.out, 'model_last.pt'), step, metrics)
    if metrics['iou'] > best:
        best = metrics['iou']
        save(os.path.join(cfg.out, 'model_best.pt'), step, metrics)
    barrier()

    if test_plans:
        state = torch.load(os.path.join(cfg.out, 'model_best.pt'), map_location=device)
        net.load_state_dict(state['state'])
        pred_dir = os.path.join(cfg.out, 'pred_test')
        os.makedirs(pred_dir, exist_ok=True)
        summary, rows = evaluate(test_plans, pred_dir)
        with open(os.path.join(cfg.out, f'test_rows_{rank}.json'), 'w') as f:
            json.dump(rows, f)
        barrier()
        if rank == 0:
            all_rows = []
            for r in range(world):
                path = os.path.join(cfg.out, f'test_rows_{r}.json')
                all_rows += json.load(open(path))
                os.remove(path)
            all_rows.sort(key=lambda r: r['plan'])
            summary['median_iou'] = float(np.median([r['iou'] for r in all_rows]))
            summary['ms_per_plan'] = float(np.mean([r['ms'] for r in all_rows]))
            summary['best_step'] = state['step']
            json.dump({'summary': summary, 'rows': all_rows}, open(os.path.join(cfg.out, 'test_results.json'), 'w'), indent=1)
            log(f'test on {summary["plans"]} plans (checkpoint of step {state["step"]}): wall IoU {summary["iou"]:.3f} '
                f'(median {summary["median_iou"]:.3f}, precision {summary["precision"]:.3f}, recall {summary["recall"]:.3f}), '
                f'door+window IoU {summary["openings_iou"]:.3f}, {summary["ms_per_plan"]:.0f} ms per plan')
    barrier()
    if log_file:
        log_file.close()
    if distributed:
        dist.destroy_process_group()


def main() -> None:
    ap = argparse.ArgumentParser()
    types = {'int': int, 'float': float, 'str': str}
    for f in fields(TrainConfig):
        flag = '--' + f.name.replace('_', '-')
        if f.default is MISSING:
            ap.add_argument(flag, dest=f.name, required=True)
        else:
            ap.add_argument(flag, dest=f.name, type=types[str(f.type)], default=f.default)
    cfg = TrainConfig(**vars(ap.parse_args()))
    # torchrun sets RANK and WORLD_SIZE (and MASTER_ADDR / MASTER_PORT) for each process it starts.
    train_worker(int(os.environ.get('RANK', 0)), int(os.environ.get('WORLD_SIZE', 1)), cfg)


if __name__ == '__main__':
    main()
