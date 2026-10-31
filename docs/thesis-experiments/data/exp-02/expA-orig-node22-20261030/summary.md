# EXP-02 run expA-orig-node22-20261030

- group: A (HISTORICAL_REPRODUCTION)
- protocol: orig, warm-up 5, measured 30
- node: v22.16.0; analyzer 43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77 (build 958dbf677b60…)
- tool: exp02-cache-benchmark/1.2 @ 5855704f04b8d45358ff62322126f4deaa2828bc
- status: COMPLETE, conditions 54

| target | scenario | mode | median (type7) ms | p50 nearest ms | p95 ms | r | 95% CI r | SF hit | result hit |
|---|---|---|---:|---:|---:|---:|---|---:|---:|
| cogic | cold | off | 990.45 | 985.99 | 1406.81 |  |  | 0 | 0 |
| cogic | cold | sourcefile | 789.06 | 788.64 | 946.85 | 20.3% | 9.4% – 27.0% | 0 | 0 |
| cogic | cold | full | 798.62 | 798.14 | 926.26 | 19.4% | 7.2% – 25.8% | 0 | 0 |
| cogic | repeated | off | 801.98 | 796.58 | 903.00 |  |  | 0 | 0 |
| cogic | repeated | sourcefile | 219.86 | 219.10 | 231.08 | 72.6% | 71.2% – 74.2% | 5190 | 0 |
| cogic | repeated | full | 3.78 | 3.77 | 5.84 | 99.5% | 99.5% – 99.6% | 0 | 30 |
| cogic | active-edit | off | 795.75 | 794.26 | 910.92 |  |  | 0 | 0 |
| cogic | active-edit | sourcefile | 221.37 | 221.14 | 233.95 | 72.2% | 71.2% – 74.2% | 5190 | 0 |
| cogic | active-edit | full | 218.75 | 218.24 | 240.25 | 72.5% | 71.5% – 74.5% | 5190 | 0 |
| synthetic-100 | cold | off | 620.52 | 619.52 | 638.36 |  |  | 0 | 0 |
| synthetic-100 | cold | sourcefile | 626.08 | 624.72 | 661.17 | -0.9% | -2.1% – 0.3% | 0 | 0 |
| synthetic-100 | cold | full | 649.46 | 649.24 | 681.03 | -4.7% | -6.4% – -3.3% | 0 | 0 |
| synthetic-100 | repeated | off | 620.56 | 619.64 | 667.80 |  |  | 0 | 0 |
| synthetic-100 | repeated | sourcefile | 88.71 | 88.60 | 92.62 | 85.7% | 85.5% – 85.9% | 7770 | 0 |
| synthetic-100 | repeated | full | 0.43 | 0.43 | 0.58 | 99.9% | 99.9% – 99.9% | 0 | 30 |
| synthetic-100 | active-edit | off | 611.87 | 610.08 | 662.46 |  |  | 0 | 0 |
| synthetic-100 | active-edit | sourcefile | 89.06 | 89.05 | 94.22 | 85.4% | 85.2% – 86.0% | 7770 | 0 |
| synthetic-100 | active-edit | full | 89.79 | 89.78 | 96.31 | 85.3% | 85.1% – 85.8% | 7770 | 0 |
| synthetic-500 | cold | off | 775.75 | 773.96 | 839.36 |  |  | 0 | 0 |
| synthetic-500 | cold | sourcefile | 804.38 | 803.48 | 862.89 | -3.7% | -5.0% – -1.3% | 0 | 0 |
| synthetic-500 | cold | full | 804.62 | 803.95 | 849.84 | -3.7% | -5.4% – -1.7% | 0 | 0 |
| synthetic-500 | repeated | off | 779.17 | 777.17 | 894.82 |  |  | 0 | 0 |
| synthetic-500 | repeated | sourcefile | 140.46 | 140.12 | 147.13 | 82.0% | 81.6% – 82.5% | 19770 | 0 |
| synthetic-500 | repeated | full | 1.94 | 1.94 | 2.74 | 99.8% | 99.7% – 99.8% | 0 | 30 |
| synthetic-500 | active-edit | off | 788.00 | 785.88 | 817.07 |  |  | 0 | 0 |
| synthetic-500 | active-edit | sourcefile | 140.49 | 140.21 | 146.25 | 82.2% | 81.7% – 82.6% | 19770 | 0 |
| synthetic-500 | active-edit | full | 150.72 | 150.50 | 162.19 | 80.9% | 80.2% – 81.3% | 19770 | 0 |
| synthetic-1000 | cold | off | 984.23 | 984.02 | 1038.01 |  |  | 0 | 0 |
| synthetic-1000 | cold | sourcefile | 1044.88 | 1044.00 | 1107.70 | -6.2% | -7.7% – -3.3% | 0 | 0 |
| synthetic-1000 | cold | full | 1063.99 | 1061.87 | 1115.87 | -8.1% | -9.9% – -4.9% | 0 | 0 |
| synthetic-1000 | repeated | off | 991.74 | 990.68 | 1021.39 |  |  | 0 | 0 |
| synthetic-1000 | repeated | sourcefile | 1096.37 | 1093.36 | 1171.95 | -10.6% | -12.8% – -7.8% | 0 | 0 |
| synthetic-1000 | repeated | full | 3.79 | 3.79 | 5.49 | 99.6% | 99.6% – 99.6% | 0 | 30 |
| synthetic-1000 | active-edit | off | 991.78 | 990.16 | 1072.60 |  |  | 0 | 0 |
| synthetic-1000 | active-edit | sourcefile | 1091.36 | 1090.77 | 1161.61 | -10.0% | -11.9% – -6.8% | 0 | 0 |
| synthetic-1000 | active-edit | full | 1106.51 | 1103.12 | 1171.28 | -11.6% | -13.4% – -8.7% | 0 | 0 |
| synthetic-2000 | cold | off | 1427.14 | 1425.65 | 1516.99 |  |  | 0 | 0 |
| synthetic-2000 | cold | sourcefile | 1565.12 | 1563.94 | 1635.46 | -9.7% | -13.7% – -8.1% | 0 | 0 |
| synthetic-2000 | cold | full | 1612.36 | 1607.09 | 1723.43 | -13.0% | -17.3% – -9.4% | 0 | 0 |
| synthetic-2000 | repeated | off | 1447.36 | 1445.82 | 1592.86 |  |  | 0 | 0 |
| synthetic-2000 | repeated | sourcefile | 1678.29 | 1676.54 | 2134.36 | -16.0% | -21.4% – -12.4% | 0 | 0 |
| synthetic-2000 | repeated | full | 9.16 | 9.14 | 10.08 | 99.4% | 99.4% – 99.4% | 0 | 30 |
| synthetic-2000 | active-edit | off | 1436.36 | 1434.72 | 1602.05 |  |  | 0 | 0 |
| synthetic-2000 | active-edit | sourcefile | 1621.05 | 1620.24 | 1711.23 | -12.9% | -17.2% – -9.4% | 0 | 0 |
| synthetic-2000 | active-edit | full | 1612.37 | 1610.96 | 1692.24 | -12.3% | -16.6% – -10.0% | 0 | 0 |
| zod | cold | off | 1020.26 | 1016.49 | 1068.76 |  |  | 0 | 0 |
| zod | cold | sourcefile | 1045.12 | 1043.89 | 1089.90 | -2.4% | -4.7% – 0.1% | 0 | 0 |
| zod | cold | full | 1045.72 | 1044.31 | 1095.82 | -2.5% | -3.7% – 0.1% | 0 | 0 |
| zod | repeated | off | 1033.25 | 1033.09 | 1094.99 |  |  | 0 | 0 |
| zod | repeated | sourcefile | 135.25 | 134.97 | 140.98 | 86.9% | 86.8% – 87.3% | 15960 | 0 |
| zod | repeated | full | 1.42 | 1.42 | 3.16 | 99.9% | 99.9% – 99.9% | 0 | 30 |
| zod | active-edit | off | 1037.60 | 1035.27 | 1172.27 |  |  | 0 | 0 |
| zod | active-edit | sourcefile | 130.15 | 130.02 | 134.45 | 87.5% | 87.2% – 87.9% | 15960 | 0 |
| zod | active-edit | full | 132.22 | 132.08 | 152.20 | 87.3% | 87.0% – 87.7% | 15960 | 0 |

- hit-path correctness (Phase D): 18/18 checks pass
- per-iteration result hashes compared with OFF: 1260, mismatches 0
- invariant/variant problems: 0
- Full repeated all result hit: true; Full active-edit result hits: 0

