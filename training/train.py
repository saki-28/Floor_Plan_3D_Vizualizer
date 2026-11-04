"""Trains the wall model on CubiCasa5k, picks the best checkpoint on val plans, then predicts the test plans.

One GPU, the Mac's GPU or the CPU:
    python3 -I training/train.py --data data/cubicasa5k/cubicasa5k --labels <dir> --out <dir> [--steps N] [--minutes M]
Several GPUs (Kaggle's 2× T4), one process per GPU:
    torchrun --standalone --nproc_per_node=2 training/train.py ...

Labels are drawn first with cubicasa.prepare_labels (train.py does it if they are missing). The
test predictions are written as class maps (0 background, 1 wall, 2 door, 3 window), one PNG per
plan, for scripts/evaluate-cubicasa.ts --masks to score with the same truth and metric as the
rule pipeline.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='folder holding train.txt, val.txt, test.txt')
    ap.add_argument('--labels', required=True, help='folder of class-map PNGs (drawn if missing)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=32)
    ap.add_argument('--crop', type=int, default=512)
    ap.add_argument('--batch', type=int, default=8, help='crops per GPU per step')
    ap.add_argument('--per-plan', type=int, default=4, help='crops taken from each plan load')
    ap.add_argument('--steps', type=int, default=24000)
    ap.add_argument('--minutes', type=float, default=95, help='training time budget; the schedule ends at whichever comes first')
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--val-plans', type=int, default=60)
    ap.add_argument('--val-every', type=int, default=3000)
    ap.add_argument('--test-limit', type=int, default=400)
    ap.add_argument('--workers', type=int, default=2, help='data loader processes per GPU')
    ap.add_argument('--device', default='auto')
    args = ap.parse_args()

    distributed = 'WORLD_SIZE' in os.environ and int(os.environ['WORLD_SIZE']) > 1
    if distributed:
        dist.init_process_group('nccl')
        rank, world = dist.get_rank(), dist.get_world_size()
        torch.cuda.set_device(int(os.environ.get('LOCAL_RANK', rank)))
        device = torch.device('cuda', torch.cuda.current_device())
    else:
        rank, world = 0, 1
        name = args.device if args.device != 'auto' else ('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu')
        device = torch.device(name)
    cuda = device.type == 'cuda'
    if cuda:
        torch.backends.cudnn.benchmark = True
    os.makedirs(args.out, exist_ok=True)
    log_file = open(os.path.join(args.out, 'log.txt'), 'a') if rank == 0 else None

    def log(msg: str) -> None:
        if rank == 0:
            line = f'[{time.strftime("%H:%M:%S")}] {msg}'
            print(line, flush=True)
            log_file.write(line + '\n')
            log_file.flush()

    def barrier() -> None:
        if distributed:
            dist.barrier()

    if rank == 0 and not os.path.exists(os.path.join(args.labels, '.done')):
        t = time.time()
        made = prepare_labels(args.data, args.labels)
        open(os.path.join(args.labels, '.done'), 'w').close()
        log(f'labels drawn for {made} plans in {time.time() - t:.0f} s')
    barrier()

    train_plans = read_split(args.data, 'train')
    val_plans = read_split(args.data, 'val')[:args.val_plans]
    test_plans = read_split(args.data, 'test')[:args.test_limit]
    dataset = TrainCrops(args.data, args.labels, train_plans, size=args.crop, per_plan=args.per_plan)
    sampler = DistributedSampler(dataset, shuffle=True) if distributed else RandomSampler(dataset)
    loader = DataLoader(dataset, batch_size=max(1, args.batch // args.per_plan), sampler=sampler, num_workers=args.workers,
                        collate_fn=collate, pin_memory=cuda, drop_last=True, persistent_workers=args.workers > 0,
                        prefetch_factor=4 if args.workers > 0 else None)

    net = UNet(args.width).to(device)
    if cuda:
        net = net.to(memory_format=torch.channels_last)
    model = torch.nn.parallel.DistributedDataParallel(net, device_ids=[device.index]) if distributed else net
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scaler = torch.amp.GradScaler('cuda', enabled=cuda)
    params = sum(p.numel() for p in net.parameters()) / 1e6
    log(f'{world} × {device.type}, {len(train_plans)} train plans, {params:.1f} M params, '
        f'{args.batch * world} crops per step, up to {args.steps} steps or {args.minutes:.0f} min')

    def evaluate(plans: list[str], pred_dir: str | None = None) -> tuple[dict, list[dict]]:
        net.eval()
        rows = []
        for i, plan in enumerate(plans):
            if i % world != rank:
                continue
            gray = cv2.imread(os.path.join(args.data, plan, 'F1_scaled.png'), cv2.IMREAD_GRAYSCALE)
            labels = cv2.imread(os.path.join(args.labels, plan_name(plan) + '.png'), cv2.IMREAD_UNCHANGED)
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
                            device=device if distributed else 'cpu')
        if distributed:
            dist.all_reduce(sums)
        s = sums.tolist()
        n = max(s[5], 1)
        return {'iou': s[0] / n, 'precision': s[1] / n, 'recall': s[2] / n, 'openings_iou': s[3] / max(s[4], 1), 'plans': int(s[5])}, rows

    def save(path: str, step: int, metrics: dict) -> None:
        if rank == 0:
            torch.save({'state': net.state_dict(), 'config': net.config, 'step': step, 'val': metrics}, path)

    start = time.time()
    budget = args.minutes * 60
    step, time_frac, best = 0, 0.0, -1.0
    seen = 0
    window_start, window_loss = time.time(), 0.0
    epoch = 0
    model.train()
    done = False
    while not done:
        if distributed:
            sampler.set_epoch(epoch)
        for x, y in loader:
            progress = max(step / args.steps, time_frac)
            if progress >= 1:
                done = True
                break
            warm = min(1.0, (step + 1) / 300)
            lr = args.lr * warm * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * progress)))
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
            window_loss += loss.item() if step % 50 == 0 else 0.0

            if step % 50 == 0:
                frac = torch.tensor([(time.time() - start) / budget], device=device)
                if distributed:
                    dist.all_reduce(frac, op=dist.ReduceOp.MAX)
                time_frac = float(frac.item())
            if step % 200 == 0:
                rate = 200 * x.shape[0] * world / (time.time() - window_start)
                log(f'step {step:6d}  loss {window_loss / 4:.4f}  lr {lr:.2e}  {rate:5.1f} crops/s  '
                    f'{(time.time() - start) / 60:5.1f} min  {seen / 1000:.0f}k crops')
                window_start, window_loss = time.time(), 0.0
            if step % args.val_every == 0:
                metrics, _ = evaluate(val_plans)
                log(f'val on {metrics["plans"]} plans: wall IoU {metrics["iou"]:.3f} (precision {metrics["precision"]:.3f}, '
                    f'recall {metrics["recall"]:.3f}), door+window IoU {metrics["openings_iou"]:.3f}')
                if metrics['iou'] > best:
                    best = metrics['iou']
                    save(os.path.join(args.out, 'model_best.pt'), step, metrics)
                window_start = time.time()
        epoch += 1

    metrics, _ = evaluate(val_plans)
    log(f'final val on {metrics["plans"]} plans: wall IoU {metrics["iou"]:.3f} (precision {metrics["precision"]:.3f}, '
        f'recall {metrics["recall"]:.3f}), door+window IoU {metrics["openings_iou"]:.3f}  after {step} steps, {seen / 1000:.0f}k crops, '
        f'{(time.time() - start) / 60:.1f} min')
    save(os.path.join(args.out, 'model_last.pt'), step, metrics)
    if metrics['iou'] > best:
        best = metrics['iou']
        save(os.path.join(args.out, 'model_best.pt'), step, metrics)
    barrier()

    if test_plans:
        state = torch.load(os.path.join(args.out, 'model_best.pt'), map_location=device)
        net.load_state_dict(state['state'])
        pred_dir = os.path.join(args.out, 'pred_test')
        os.makedirs(pred_dir, exist_ok=True)
        summary, rows = evaluate(test_plans, pred_dir)
        with open(os.path.join(args.out, f'test_rows_{rank}.json'), 'w') as f:
            json.dump(rows, f)
        barrier()
        if rank == 0:
            all_rows = []
            for r in range(world):
                path = os.path.join(args.out, f'test_rows_{r}.json')
                all_rows += json.load(open(path))
                os.remove(path)
            all_rows.sort(key=lambda r: r['plan'])
            summary['median_iou'] = float(np.median([r['iou'] for r in all_rows]))
            summary['ms_per_plan'] = float(np.mean([r['ms'] for r in all_rows]))
            summary['best_step'] = state['step']
            json.dump({'summary': summary, 'rows': all_rows}, open(os.path.join(args.out, 'test_results.json'), 'w'), indent=1)
            log(f'test on {summary["plans"]} plans (checkpoint of step {state["step"]}): wall IoU {summary["iou"]:.3f} '
                f'(median {summary["median_iou"]:.3f}, precision {summary["precision"]:.3f}, recall {summary["recall"]:.3f}), '
                f'door+window IoU {summary["openings_iou"]:.3f}, {summary["ms_per_plan"]:.0f} ms per plan')
    barrier()
    if distributed:
        dist.destroy_process_group()


if __name__ == '__main__':
    main()
