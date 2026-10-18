# MF05/MF06: AI execution reauthorized and device timing

The owner's direct instruction on 18 October permits AI execution again.
It supersedes the previous execution pause, while model adoption still requires
the existing quality, lifecycle and acceptance gates. Website UI remains paused.

## Actual bounded execution

Evidence: `D:/Ky9-FPT/SmartSiteData/runs/ai-device-latency-20261018-v1/`.
`measure.py` loaded retained corrective checkpoint `80b79169…57dc1` through the
current AI adapter's offline local-model factory. Model SHA, fifteen names and
YOLO scale `s` were checked. No rejected candidate or intermediate was applied.

The existing development MP4 SHA is `12e9c8d2…68a4`. Both devices received the
same twelve BGR frames, indices 0,6,…,66; each frame's bytes were hashed. Two
warmup predictions per device were excluded from the measured sample.

| Measurement | CPU, two threads | CUDA device 0 |
|---|---:|---:|
| First prediction, ms | 2109.28 | 796.82 |
| Warm synchronized prediction median, ms | 114.84 | 9.66 |
| Warm nearest-rank p95, ms (n=12) | 125.81 | 15.10 |

Decode median was 3.61 ms across 67 sequential reads. Hardware: RTX 4060 Laptop;
Torch 2.14.0+cu126, CUDA 12.6, Ultralytics 8.4.155, imgsz832/conf.25/NMS.7/FP32.
The single process completed with actual exit0; no Python remained afterward.

These are sequential CPU-then-GPU provider-call measurements on one previously
used clip. They include provider overhead and explicit GPU synchronization.
They do not measure tracking, temporal confirmation, queues, Backend, browser,
physical cameras, sustained capacity, accuracy or whole-flow latency.
Deprecated `half` argument warnings were retained; execution completed.

## Recovery findings and disposition

The earlier protocol audit searched only three named roots. Wider recovery
found the warmup-only run plus its completed four-plus-two-epoch continuation:
`unified8-adamw-human-continuation-20261014-v1`. Its actual exit0 and rejection
of 15/19 frozen controls mean the proposed warmup ablation is not novel.
Do not retrain it on the premise that it has never run. Person-anchor remains
separately rejected at 16/19. Neither result establishes independent accuracy.

The initial website owner guard refused a six-versus-seven fractional-digit
timestamp serialization, although both represented the exact same instant.
Failure was preserved and no AI had started. New local guard v9 compares exact
DateTimeOffset instants: equivalent precision passes, a one-microsecond change
fails. PID/command/expiry/listener/PostgreSQL checks remain; actual owner passed.

The website stayed at Node40548, birth2026-10-18T17:03:54.2424560+07:00, port5181.
No runtime restart, config mutation, DB migration, camera capture, training,
web-model application, push or deployment occurred. Standalone inference has
finished; permission for future justified AI work remains active.

Next model work requires a reviewed data/protocol delta and balanced visible,
gloved, bare-hand and hidden-hand evidence; timing cannot supply those labels.
Independent quality, wearer/identity and website commissioning remain open.
