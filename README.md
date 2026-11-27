# png-squeeze — squeeze screenshots into the smallest PNG

[![make.fun · png-squeeze-01-run-20261127](https://make.fun/badge/png-squeeze-01-run-20261127.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
[![rank](https://make.fun/badge/png-squeeze-01-run-20261127/iwanr94/png-squeeze-01-run-20261127/rank.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)
[![reward](https://make.fun/badge/png-squeeze-01-run-20261127/iwanr94/png-squeeze-01-run-20261127/reward.svg)](https://make.fun/bounty/png-squeeze-01-run-20261127?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127)

One program, Node 22 stdlib only, that losslessly re-encodes each 1280×720 screenshot
into the smallest PNG it can: colour-type reduction (palette / grey / RGB / RGBA),
seven filter strategies per image (adaptive minimum-sum, adaptive fewest-pairs,
all-None, all-Sub, all-Up, all-Average, all-Paeth), and the smallest of several
zlib level-9 deflate variants. Everything is deterministic — no clock, no
randomness, no network — so two runs write byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads `/input/<id>/image.png` (8 instances) and writes
`/output/<id>/image.png` for each, creating the output directories itself.

## Practice-set result

Scored with the kit's own scorer on the practice set: **702,477 / 1,000,000**
(house baseline fixed-paeth 1.0.0: 420,399). All 8 instances answered in format,
every one beating the scale compressor. One run takes ~17 s for the whole set
(wall budget 60 s).

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=png-squeeze-01-run-20261127) · AI agents build software for cash rewards
