"""
Generates reference values for src/lib/stats/stats.test.ts using established
implementations (SciPy, scikit-posthocs, pingouin).

    pip install scipy scikit-posthocs pingouin
    python3 scripts/make_stats_fixture.py

The datasets are synthetic; no study data is involved.
"""
import json
import pathlib

import numpy as np
import pandas as pd
import pingouin as pg
import scikit_posthocs as sp
from scipy import stats

rng = np.random.default_rng(20261117)
out = {"distributions": {}, "datasets": []}

# ── Distributions ───────────────────────────────────────────────────────────
xs = [-8.5, -5, -3.2, -1.96, -1, -0.3, 0, 0.4, 1.2, 2.5, 3.0, 4.75, 7.1, 9.0]
out["distributions"]["norm_cdf"] = [[x, float(stats.norm.cdf(x))] for x in xs]
out["distributions"]["norm_sf"] = [[x, float(stats.norm.sf(x))] for x in xs]
ps = [1e-12, 1e-6, 0.001, 0.025, 0.1, 0.3, 0.5, 0.77, 0.975, 0.999, 1 - 1e-9]
out["distributions"]["norm_ppf"] = [[p, float(stats.norm.ppf(p))] for p in ps]
out["distributions"]["t_cdf"] = [
    [t, df, float(stats.t.cdf(t, df))] for t, df in [(-3.1, 4), (-1, 10), (0.5, 2), (2.1, 25), (4.2, 7), (1.5, 120)]
]
out["distributions"]["t_ppf"] = [[p, df, float(stats.t.ppf(p, df))] for p, df in [(0.975, 1), (0.975, 4), (0.975, 29), (0.995, 12), (0.9, 300)]]
out["distributions"]["f_sf"] = [
    [f, d1, d2, float(stats.f.sf(f, d1, d2))]
    for f, d1, d2 in [(0.5, 2, 10), (3.2, 2, 27), (12.4, 3, 116), (45, 4, 200), (1.01, 7, 7.5), (2.5, 1, 3)]
]
out["distributions"]["chi2_sf"] = [
    [x, df, float(stats.chi2.sf(x, df))] for x, df in [(0.3, 1), (3.84, 1), (5.99, 2), (11.3, 3), (40, 5), (2.2, 7)]
]
out["distributions"]["ptukey"] = [
    [q, k, df, float(stats.studentized_range.cdf(q, k, df))]
    for q, k, df in [
        (0.5, 3, 10), (2.0, 3, 10), (3.877, 3, 10), (4.5, 4, 20), (3.3, 2, 5), (5.1, 6, 60),
        (2.9, 3, 150), (6.0, 8, 30), (3.5, 5, 1000), (1.2, 3, 3.5), (4.0, 3, 17.3),
    ]
]
out["distributions"]["qtukey"] = [
    [p, k, df, float(stats.studentized_range.ppf(p, k, df))]
    for p, k, df in [(0.95, 3, 10), (0.95, 4, 40), (0.99, 3, 25), (0.95, 2, 120), (0.95, 6, 8.7)]
]

# ── Shapiro–Wilk across sample sizes ────────────────────────────────────────
sw = []
for n in [3, 4, 5, 6, 7, 11, 12, 20, 37, 64, 150]:
    for kind in ["normal", "skewed"]:
        x = rng.normal(10, 3, n) if kind == "normal" else rng.lognormal(1.5, 0.8, n)
        x = np.round(x, 3)
        r = stats.shapiro(x)
        sw.append({"x": x.tolist(), "W": float(r.statistic), "p": float(r.pvalue)})
out["shapiro"] = sw


# ── Group comparisons ───────────────────────────────────────────────────────
def dataset(groups, label):
    names = [f"G{i+1}" for i in range(len(groups))]
    d = {"label": label, "names": names, "groups": [g.tolist() for g in groups]}
    f = stats.f_oneway(*groups)
    d["anova"] = {"F": float(f.statistic), "p": float(f.pvalue)}
    lev = stats.levene(*groups, center="median")
    d["levene"] = {"F": float(lev.statistic), "p": float(lev.pvalue)}
    kw = stats.kruskal(*groups)
    d["kruskal"] = {"H": float(kw.statistic), "p": float(kw.pvalue)}
    t = stats.tukey_hsd(*groups)
    ci = t.confidence_interval(confidence_level=0.95)
    tk = []
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            tk.append({"a": i, "b": j, "diff": float(t.statistic[i, j]), "p": float(t.pvalue[i, j]),
                       "low": float(ci.low[i, j]), "high": float(ci.high[i, j])})
    d["tukey"] = tk
    df = pd.DataFrame({"y": np.concatenate(groups), "g": np.repeat(names, [len(g) for g in groups])})
    for method in ["holm", "bonferroni"]:
        dm = sp.posthoc_dunn(df, val_col="y", group_col="g", p_adjust=method)
        d[f"dunn_{method}"] = [
            {"a": i, "b": j, "p": float(dm.loc[names[i], names[j]])}
            for i in range(len(groups)) for j in range(i + 1, len(groups))
        ]
    w = pg.welch_anova(data=df, dv="y", between="g")
    d["welch"] = {"F": float(w["F"].iloc[0]), "df1": float(w["ddof1"].iloc[0]), "df2": float(w["ddof2"].iloc[0]),
                  "p": float(w["p_unc"].iloc[0] if "p_unc" in w.columns else w["p-unc"].iloc[0])}
    gh = pg.pairwise_gameshowell(data=df, dv="y", between="g")
    ghl = []
    for _, row in gh.iterrows():
        a, b = names.index(row["A"]), names.index(row["B"])
        sign = 1 if a < b else -1
        ghl.append({"a": min(a, b), "b": max(a, b), "diff": float(row["diff"]) * sign, "t": float(row["T"]) * sign,
                    "df": float(row["df"]), "p": float(row["pval"])})
    d["gameshowell"] = ghl
    return d


groups_sets = [
    ([rng.normal(5, 2, 12), rng.normal(8, 2, 15), rng.normal(14, 3, 10)], "three groups, unequal n"),
    ([np.round(rng.normal(10, 4, 20), 0), np.round(rng.normal(11, 4, 20), 0), np.round(rng.normal(9, 4, 20), 0),
      np.round(rng.normal(15, 4, 20), 0)], "four groups with ties"),
    ([rng.lognormal(1, 0.6, 18), rng.lognormal(1.6, 0.9, 9), rng.lognormal(2.2, 0.5, 25)], "skewed, unequal spread"),
    ([rng.normal(3, 1, 6), rng.normal(3.5, 1.2, 7)], "two small groups"),
]
out["datasets"] = [dataset(g, label) for g, label in groups_sets]

path = pathlib.Path(__file__).resolve().parent.parent / "src" / "lib" / "stats" / "reference.json"
path.write_text(json.dumps(out, indent=1))
print("wrote", path)
