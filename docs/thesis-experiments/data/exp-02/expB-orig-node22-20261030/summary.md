# EXP-02 run expB-orig-node22-20261030

- group: B (CURRENT_ANALYZER_EVALUATION)
- protocol: orig, warm-up 5, measured 30
- node: v22.16.0; analyzer bbe4cbf5b1f784d9223ca3d46d96058617687b12 (build 2423b0d471b6…)
- tool: exp02-cache-benchmark/1.2 @ 5855704f04b8d45358ff62322126f4deaa2828bc
- status: COMPLETE, conditions 54

| target | scenario | mode | median (type7) ms | p50 nearest ms | p95 ms | r | 95% CI r | SF hit | result hit |
|---|---|---|---:|---:|---:|---:|---|---:|---:|
| cogic | cold | off | 767.15 | 766.79 | 869.95 |  |  | 0 | 0 |
| cogic | cold | sourcefile | 771.42 | 768.36 | 913.13 | -0.6% | -6.2% – 5.4% | 0 | 0 |
| cogic | cold | full | 790.91 | 790.14 | 917.07 | -3.1% | -10.7% – 1.2% | 0 | 0 |
| cogic | repeated | off | 762.83 | 758.33 | 890.68 |  |  | 0 | 0 |
| cogic | repeated | sourcefile | 213.92 | 213.63 | 228.16 | 72.0% | 70.9% – 73.3% | 5190 | 0 |
| cogic | repeated | full | 3.97 | 3.97 | 5.91 | 99.5% | 99.5% – 99.5% | 0 | 30 |
| cogic | active-edit | off | 772.11 | 771.23 | 869.76 |  |  | 0 | 0 |
| cogic | active-edit | sourcefile | 223.02 | 222.45 | 243.46 | 71.1% | 69.6% – 72.2% | 5190 | 0 |
| cogic | active-edit | full | 218.14 | 218.09 | 239.72 | 71.7% | 70.5% – 72.6% | 5190 | 0 |
| synthetic-100 | cold | off | 623.79 | 623.12 | 668.29 |  |  | 0 | 0 |
| synthetic-100 | cold | sourcefile | 617.47 | 616.14 | 651.33 | 1.0% | -1.3% – 3.3% | 0 | 0 |
| synthetic-100 | cold | full | 631.76 | 630.38 | 662.03 | -1.3% | -2.8% – 1.2% | 0 | 0 |
| synthetic-100 | repeated | off | 623.27 | 621.84 | 667.18 |  |  | 0 | 0 |
| synthetic-100 | repeated | sourcefile | 89.02 | 88.98 | 100.61 | 85.7% | 85.5% – 86.0% | 7770 | 0 |
| synthetic-100 | repeated | full | 0.43 | 0.43 | 0.52 | 99.9% | 99.9% – 99.9% | 0 | 30 |
| synthetic-100 | active-edit | off | 621.75 | 621.57 | 659.35 |  |  | 0 | 0 |
| synthetic-100 | active-edit | sourcefile | 93.97 | 93.97 | 99.11 | 84.9% | 84.7% – 85.1% | 7770 | 0 |
| synthetic-100 | active-edit | full | 92.44 | 92.39 | 100.00 | 85.1% | 84.9% – 85.4% | 7770 | 0 |
| synthetic-500 | cold | off | 804.29 | 804.15 | 841.12 |  |  | 0 | 0 |
| synthetic-500 | cold | sourcefile | 791.95 | 791.62 | 844.78 | 1.5% | -1.1% – 2.7% | 0 | 0 |
| synthetic-500 | cold | full | 801.36 | 800.98 | 857.20 | 0.4% | -2.4% – 2.0% | 0 | 0 |
| synthetic-500 | repeated | off | 790.84 | 790.83 | 846.51 |  |  | 0 | 0 |
| synthetic-500 | repeated | sourcefile | 139.67 | 139.65 | 145.13 | 82.3% | 81.9% – 82.6% | 19770 | 0 |
| synthetic-500 | repeated | full | 1.93 | 1.93 | 2.95 | 99.8% | 99.8% – 99.8% | 0 | 30 |
| synthetic-500 | active-edit | off | 777.61 | 777.21 | 839.85 |  |  | 0 | 0 |
| synthetic-500 | active-edit | sourcefile | 139.54 | 139.42 | 149.43 | 82.1% | 81.9% – 82.6% | 19770 | 0 |
| synthetic-500 | active-edit | full | 139.68 | 139.67 | 146.66 | 82.0% | 81.8% – 82.5% | 19770 | 0 |
| synthetic-1000 | cold | off | 987.79 | 985.22 | 1052.33 |  |  | 0 | 0 |
| synthetic-1000 | cold | sourcefile | 1046.50 | 1046.20 | 1109.27 | -5.9% | -8.3% – -3.4% | 0 | 0 |
| synthetic-1000 | cold | full | 1041.09 | 1038.37 | 1129.75 | -5.4% | -8.6% – -2.9% | 0 | 0 |
| synthetic-1000 | repeated | off | 980.88 | 980.86 | 1045.44 |  |  | 0 | 0 |
| synthetic-1000 | repeated | sourcefile | 1100.89 | 1096.85 | 1191.82 | -12.2% | -14.5% – -8.9% | 0 | 0 |
| synthetic-1000 | repeated | full | 3.86 | 3.86 | 5.23 | 99.6% | 99.6% – 99.6% | 0 | 30 |
| synthetic-1000 | active-edit | off | 998.79 | 997.43 | 1040.70 |  |  | 0 | 0 |
| synthetic-1000 | active-edit | sourcefile | 1104.90 | 1102.38 | 1149.58 | -10.6% | -13.7% – -8.1% | 0 | 0 |
| synthetic-1000 | active-edit | full | 1103.90 | 1101.56 | 1165.96 | -10.5% | -14.7% – -8.1% | 0 | 0 |
| synthetic-2000 | cold | off | 1392.66 | 1387.14 | 1461.95 |  |  | 0 | 0 |
| synthetic-2000 | cold | sourcefile | 1535.29 | 1535.18 | 1624.50 | -10.2% | -12.1% – -7.5% | 0 | 0 |
| synthetic-2000 | cold | full | 1558.87 | 1556.79 | 1666.91 | -11.9% | -14.8% – -8.6% | 0 | 0 |
| synthetic-2000 | repeated | off | 1395.80 | 1395.26 | 1470.97 |  |  | 0 | 0 |
| synthetic-2000 | repeated | sourcefile | 1613.18 | 1612.06 | 1755.56 | -15.6% | -19.1% – -13.2% | 0 | 0 |
| synthetic-2000 | repeated | full | 8.39 | 8.36 | 9.66 | 99.4% | 99.4% – 99.4% | 0 | 30 |
| synthetic-2000 | active-edit | off | 1394.68 | 1394.63 | 1450.14 |  |  | 0 | 0 |
| synthetic-2000 | active-edit | sourcefile | 1592.91 | 1592.26 | 1707.03 | -14.2% | -17.8% – -12.3% | 0 | 0 |
| synthetic-2000 | active-edit | full | 1624.83 | 1618.80 | 1681.44 | -16.5% | -19.4% – -13.7% | 0 | 0 |
| zod | cold | off | 1038.24 | 1037.27 | 1088.24 |  |  | 0 | 0 |
| zod | cold | sourcefile | 1052.68 | 1052.15 | 1102.11 | -1.4% | -2.7% – 1.4% | 0 | 0 |
| zod | cold | full | 1056.37 | 1055.58 | 1113.49 | -1.7% | -3.0% – 1.0% | 0 | 0 |
| zod | repeated | off | 1018.91 | 1015.43 | 1073.09 |  |  | 0 | 0 |
| zod | repeated | sourcefile | 128.89 | 128.86 | 135.13 | 87.4% | 87.2% – 87.5% | 15960 | 0 |
| zod | repeated | full | 1.25 | 1.25 | 2.11 | 99.9% | 99.9% – 99.9% | 0 | 30 |
| zod | active-edit | off | 1013.92 | 1012.68 | 1059.00 |  |  | 0 | 0 |
| zod | active-edit | sourcefile | 135.17 | 134.82 | 142.08 | 86.7% | 86.4% – 86.8% | 15960 | 0 |
| zod | active-edit | full | 133.65 | 133.60 | 139.66 | 86.8% | 86.7% – 87.0% | 15960 | 0 |

- hit-path correctness (Phase D): 18/18 checks pass
- per-iteration result hashes compared with OFF: 1260, mismatches 0
- invariant/variant problems: 0
- Full repeated all result hit: true; Full active-edit result hits: 0

