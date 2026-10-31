# EXP-02 run expA-robust-node22-20261030

- group: A (HISTORICAL_REPRODUCTION)
- protocol: robust, warm-up 5, measured 30, blocks 3
- node: v22.16.0; analyzer 43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77 (build 958dbf677b60…)
- tool: exp02-cache-benchmark/1.2 @ 5855704f04b8d45358ff62322126f4deaa2828bc
- status: COMPLETE, conditions 27

| target | scenario | mode | median (type7) ms | p50 nearest ms | p95 ms | r | 95% CI r | SF hit | result hit |
|---|---|---|---:|---:|---:|---:|---|---:|---:|
| cogic | active-edit | full | 238.57 | 238.50 | 267.17 | 68.8% | 68.2% – 69.3% | 15570 | 0 |
| cogic | active-edit | off | 764.93 | 764.72 | 871.52 |  |  | 0 | 0 |
| cogic | active-edit | sourcefile | 227.28 | 227.16 | 254.65 | 70.3% | 69.6% – 70.8% | 15570 | 0 |
| cogic | cold | full | 787.96 | 787.83 | 951.31 | -3.5% | -6.9% – -1.2% | 0 | 0 |
| cogic | cold | off | 761.23 | 760.33 | 875.72 |  |  | 0 | 0 |
| cogic | cold | sourcefile | 780.17 | 778.79 | 913.93 | -2.5% | -6.2% – 0.2% | 0 | 0 |
| cogic | repeated | full | 3.80 | 3.80 | 4.13 | 99.5% | 99.5% – 99.5% | 0 | 90 |
| cogic | repeated | off | 771.27 | 769.59 | 884.71 |  |  | 0 | 0 |
| cogic | repeated | sourcefile | 227.84 | 227.77 | 257.10 | 70.5% | 69.9% – 71.0% | 15570 | 0 |
| synthetic-100 | active-edit | full | 91.73 | 91.61 | 97.68 | 84.8% | 84.5% – 85.0% | 23310 | 0 |
| synthetic-100 | active-edit | off | 604.61 | 604.09 | 634.34 |  |  | 0 | 0 |
| synthetic-100 | active-edit | sourcefile | 91.26 | 91.24 | 98.63 | 84.9% | 84.7% – 85.1% | 23310 | 0 |
| synthetic-1000 | active-edit | full | 1074.35 | 1074.20 | 1117.18 | -13.0% | -14.2% – -11.4% | 0 | 0 |
| synthetic-1000 | active-edit | off | 950.38 | 950.37 | 1007.71 |  |  | 0 | 0 |
| synthetic-1000 | active-edit | sourcefile | 1070.86 | 1068.27 | 1133.02 | -12.7% | -13.9% – -11.2% | 0 | 0 |
| synthetic-2000 | active-edit | full | 1570.43 | 1569.66 | 1703.98 | -16.6% | -18.6% – -15.2% | 0 | 0 |
| synthetic-2000 | active-edit | off | 1346.71 | 1346.61 | 1414.07 |  |  | 0 | 0 |
| synthetic-2000 | active-edit | sourcefile | 1566.63 | 1566.54 | 1645.86 | -16.3% | -17.8% – -14.8% | 0 | 0 |
| synthetic-500 | active-edit | full | 142.74 | 142.65 | 157.90 | 81.1% | 80.8% – 81.4% | 59310 | 0 |
| synthetic-500 | active-edit | off | 755.82 | 755.52 | 800.67 |  |  | 0 | 0 |
| synthetic-500 | active-edit | sourcefile | 141.60 | 141.58 | 157.25 | 81.3% | 80.9% – 81.5% | 59310 | 0 |
| synthetic-500 | repeated | full | 2.02 | 2.02 | 2.86 | 99.7% | 99.7% – 99.7% | 0 | 90 |
| synthetic-500 | repeated | off | 754.63 | 754.38 | 796.73 |  |  | 0 | 0 |
| synthetic-500 | repeated | sourcefile | 140.93 | 140.83 | 156.99 | 81.3% | 81.1% – 81.6% | 59310 | 0 |
| zod | active-edit | full | 130.76 | 130.73 | 143.36 | 86.9% | 86.7% – 87.0% | 47880 | 0 |
| zod | active-edit | off | 996.27 | 995.74 | 1065.22 |  |  | 0 | 0 |
| zod | active-edit | sourcefile | 130.38 | 130.37 | 142.09 | 86.9% | 86.8% – 87.1% | 47880 | 0 |

- hit-path correctness (Phase D): 18/18 checks pass
- per-iteration result hashes compared with OFF: 1890, mismatches 0
- invariant/variant problems: 0
- Full repeated all result hit: true; Full active-edit result hits: 0

