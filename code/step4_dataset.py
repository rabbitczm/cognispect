#!/usr/bin/env python
"""step4_dataset.py — 数据体检、病人级嵌套交叉验证、指标与校准报告。

这是"可复现"最容易被做假的一环，所以三条硬规矩写在最前面：

  1. 划分单位是**病人**，不是结节。同一病人的多个结节进同一折——
     否则同一张 CT 的纹理特征跨折泄漏，AUC 会虚高。
  2. 任何在标签上做的操作（标准化、特征筛选、超参搜索）都封装在
     Pipeline 内、只用训练折的数据。测试折只做 predict。
  3. 分类阈值在训练折上按 Youden 指数选定，再原样用到测试折。
     用测试折的标签挑阈值等于偷看答案。

--dry-run 不需要 sklearn，只做数据体检（样本量、事件数、常数特征、缺失、
每病人结节分布），任何环境都能跑。

用法：
  python step4_dataset.py --features data/features/features.csv --out results --dry-run
  python step4_dataset.py --features data/features/features.csv --out results --outer 5 --inner 3
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

LOG = logging.getLogger("step4")
META_COLS = {
    "patient_id", "group_id", "label_malignant", "n_annotators", "diameter_mm",
    "voters_used", "vote_threshold", "mask_voxels", "max_vote",
    "matched_layers", "unmatched_layers", "fallback_to_single_vote", "mask_digest",
}


# --------------------------------------------------------------------------- #
# 载入与体检
# --------------------------------------------------------------------------- #


def load_features(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str], list[str]]:
    """返回 (X, y, groups, feature_names, patient_ids)。"""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        fields = reader.fieldnames or []
    if not rows:
        raise SystemExit(f"{path} 没有数据行")

    feat_cols = [c for c in fields if c.startswith("original_") or c.startswith("wavelet_")]
    if not feat_cols:
        # 退一步：非元数据列都当特征，避免因命名差异直接罢工
        feat_cols = [c for c in fields if c not in META_COLS]
    if not feat_cols:
        raise SystemExit("找不到任何特征列（列名应在 fields 或 original_* 命名下）")

    X = np.full((len(rows), len(feat_cols)), np.nan, dtype=float)
    for i, r in enumerate(rows):
        for j, c in enumerate(feat_cols):
            v = r.get(c, "")
            if v is None or v == "" or v.lower() in ("nan", "none", "null"):
                continue
            try:
                X[i, j] = float(v)
            except ValueError:
                continue

    y = np.array([int(float(r["label_malignant"])) for r in rows], dtype=int)
    groups = np.array([r["patient_id"] for r in rows], dtype=object)
    pids = [r["patient_id"] for r in rows]
    return X, y, groups, feat_cols, pids


def audit(X: np.ndarray, y: np.ndarray, groups: np.ndarray, feat_cols: list[str]) -> dict:
    """数据体检：正式训练前先把数据问题摊在桌面上。"""
    n, p = X.shape
    nan_cols = [feat_cols[j] for j in range(p) if np.isnan(X[:, j]).any()]
    const_cols = [feat_cols[j] for j in range(p)
                  if np.isfinite(X[:, j]).any() and np.std(X[np.isfinite(X[:, j]), j]) == 0]
    inf_cols = [feat_cols[j] for j in range(p) if np.isinf(X[:, j]).any()]

    uniq, counts = np.unique(groups, return_counts=True)
    events = int(y.sum())
    per_group = counts.tolist()
    single_nodule_groups = int((counts == 1).sum())

    # 病人级的事件分布：同一病人只要有一个阳性结节，该病人即为阳性病人
    pt_pos = {}
    for g, label in zip(groups, y):
        pt_pos[g] = max(pt_pos.get(g, 0), int(label))
    n_pos_pts = sum(pt_pos.values())

    return {
        "n_samples": n,
        "n_features": p,
        "n_patients": int(len(uniq)),
        "n_events": events,
        "event_rate": round(events / n, 4) if n else None,
        "n_patients_with_positive": int(n_pos_pts),
        "events_per_feature": round(events / p, 3) if p else None,
        "nodules_per_patient": {
            "min": int(min(per_group)) if per_group else None,
            "median": float(np.median(per_group)) if per_group else None,
            "max": int(max(per_group)) if per_group else None,
            "n_single_nodule_patients": single_nodule_groups,
        },
        "columns_with_nan": nan_cols,
        "columns_constant": const_cols,
        "columns_with_inf": inf_cols,
        "warnings": _audit_warnings(n, events, len(uniq), p, nan_cols, const_cols, single_nodule_groups, per_group),
    }


def _audit_warnings(n, events, n_pts, p, nan_cols, const_cols, single, per_group) -> list[str]:
    w: list[str] = []
    if events < 40:
        w.append(f"阳性样本仅 {events} 个，远低于建模所需的经验下限（约 40–100 事件），"
                 f"结论只能当可行性验证，不能作为效能结论。")
    if n_pts < 10:
        w.append(f"只有 {n_pts} 例病人，切 5 折后每折不到 2 例病人，交叉验证结果不稳定。")
    if nan_cols:
        w.append(f"{len(nan_cols)} 个特征列含空值；线性模型在训练折中位数填补，HGB 原生处理缺失值。")
    if const_cols:
        w.append(f"{len(const_cols)} 个特征列方差为 0，训练时会因方差过滤被自动剔除。")
    if single == n_pts and n_pts:
        w.append("每位病人只有 1 个结节，此时病人级划分与结节级划分等价。")
    elif per_group and max(per_group) > 1:
        w.append(f"存在多结节病人（最多 {max(per_group)} 个），必须按病人分组划分。")
    if p > n / 5:
        w.append(f"特征数 {p} 相对样本数 {n} 偏多，需在内层做特征筛选以防过拟合。")
    return w


# --------------------------------------------------------------------------- #
# 指标
# --------------------------------------------------------------------------- #


def youden_threshold(y_true: np.ndarray, p: np.ndarray) -> float:
    """按 Youden 指数 J = TPR - FPR 找阈值。只在训练折上调用。"""
    from sklearn.metrics import roc_curve

    fpr, tpr, thr = roc_curve(y_true, p)
    j = tpr - fpr
    return float(thr[int(np.argmax(j))])


def binary_metrics(y_true: np.ndarray, p: np.ndarray, thr: float) -> dict:
    tp = int(((p >= thr) & (y_true == 1)).sum())
    fp = int(((p >= thr) & (y_true == 0)).sum())
    tn = int(((p < thr) & (y_true == 0)).sum())
    fn = int(((p < thr) & (y_true == 1)).sum())
    sens = tp / (tp + fn) if (tp + fn) else None
    spec = tn / (tn + fp) if (tn + fp) else None
    ppv = tp / (tp + fp) if (tp + fp) else None
    npv = tn / (tn + fn) if (tn + fn) else None
    return {
        "threshold": round(thr, 6),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "sensitivity": _r(sens), "specificity": _r(spec),
        "ppv": _r(ppv), "npv": _r(npv),
        "accuracy": _r((tp + tn) / max(len(y_true), 1)),
    }


def calibration(y_true: np.ndarray, p: np.ndarray) -> dict:
    """校准截距与斜率：把 logit(p) 当唯一自变量拟合 y。

    完美校准 = 截距 0、斜率 1。斜率 < 1 说明概率过于极端（过拟合的典型表现）。
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss

    eps = 1e-6
    q = np.clip(p, eps, 1 - eps)
    logit = np.log(q / (1 - q)).reshape(-1, 1)
    out = {"brier": _r(brier_score_loss(y_true, q))}
    if len(np.unique(y_true)) < 2:
        out.update({"intercept": None, "slope": None, "note": "单一类别，无法拟合校准"})
        return out
    lr = LogisticRegression(C=1e6, max_iter=2000, solver="lbfgs")
    lr.fit(logit, y_true)
    out["intercept"] = round(float(lr.intercept_[0]), 4)
    out["slope"] = round(float(lr.coef_[0][0]), 4)
    return out


def _r(v, nd: int = 4):
    return None if v is None else round(float(v), nd)


# --------------------------------------------------------------------------- #
# 训练
# --------------------------------------------------------------------------- #


def require_sklearn():
    try:
        import sklearn  # noqa: F401
    except ImportError:
        print(
            "缺少 scikit-learn，无法训练。\n  pip install scikit-learn\n"
            "只想看数据体检的话，加 --dry-run（不需要 sklearn）。",
            file=sys.stderr,
        )
        raise SystemExit(2)
    import sklearn
    return sklearn


def build_pipeline(args):
    from sklearn.feature_selection import SelectKBest, VarianceThreshold, f_classif
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold
    from sklearn.svm import SVC

    if args.model == "logreg":
        steps = [
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("variance", VarianceThreshold()),
            ("scale", StandardScaler()),
        ]
        if args.k_best and 0 < args.k_best < 10_000:
            steps.append(("select", SelectKBest(f_classif, k=args.k_best)))
        steps.append(("clf", LogisticRegression(max_iter=5000, class_weight="balanced", solver="lbfgs")))
        pipe = Pipeline(steps)
        grid = {"clf__C": [0.01, 0.03, 0.1, 0.3, 1.0]}
    elif args.model == "hgb":
        pipe = Pipeline([
            ("clf", HistGradientBoostingClassifier(random_state=args.seed, class_weight="balanced")),
        ])
        grid = {"clf__learning_rate": [0.03, 0.1], "clf__max_leaf_nodes": [7, 15]}
    elif args.model == "svm":
        pipe = Pipeline([
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("variance", VarianceThreshold()),
            ("scale", StandardScaler()),
            ("clf", SVC(probability=True, class_weight="balanced", random_state=args.seed)),
        ])
        grid = {"clf__C": [0.1, 1.0, 10.0], "clf__gamma": ["scale", 0.01]}
    else:
        raise SystemExit(f"未知模型：{args.model}")

    inner = StratifiedGroupKFold(n_splits=args.inner, shuffle=True, random_state=args.seed)
    return GridSearchCV(pipe, grid, scoring="roc_auc", cv=inner, refit=True, n_jobs=1)


def run_cv(X, y, groups, args) -> dict:
    from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve
    from sklearn.model_selection import StratifiedGroupKFold

    outer = StratifiedGroupKFold(n_splits=args.outer, shuffle=True, random_state=args.seed)
    oof = np.full(len(y), np.nan)
    oof_decisions = np.full(len(y), np.nan)
    folds = []

    for k, (tr, te) in enumerate(outer.split(X, y, groups), 1):
        train_patients = set(groups[tr])
        test_patients = set(groups[te])
        if train_patients & test_patients:
            raise ValueError("外层交叉验证出现跨折病人")
        if len(np.unique(y[tr])) < 2 or len(np.unique(y[te])) < 2:
            raise ValueError("外层训练或测试折只有一个类别，请减少折数或扩充病人")
        est = build_pipeline(args)
        inner_splits = list(est.cv.split(X[tr], y[tr], groups[tr]))
        inner_overlap = 0
        for inner_train, inner_test in inner_splits:
            inner_overlap += len(set(groups[tr][inner_train]) & set(groups[tr][inner_test]))
            if len(np.unique(y[tr][inner_train])) < 2 or len(np.unique(y[tr][inner_test])) < 2:
                raise ValueError("内层训练或验证折只有一个类别，请减少折数或扩充病人")
        if inner_overlap:
            raise ValueError("内层交叉验证出现跨折病人")
        est.fit(X[tr], y[tr], groups=groups[tr])
        best = est.best_estimator_ if hasattr(est, "best_estimator_") else est

        p_tr = best.predict_proba(X[tr])[:, 1]
        p_te = best.predict_proba(X[te])[:, 1]
        oof[te] = p_te

        thr = youden_threshold(y[tr], p_tr)  # 阈值只来自训练折
        oof_decisions[te] = p_te >= thr
        fold = {
            "fold": k,
            "n_train": int(len(tr)),
            "n_test": int(len(te)),
            "n_test_patients": int(len(set(groups[te]))),
            "train_patient_ids": sorted(str(v) for v in train_patients),
            "test_patient_ids": sorted(str(v) for v in test_patients),
            "inner_patient_overlap_count": inner_overlap,
            "n_train_events": int(y[tr].sum()),
            "n_test_events": int(y[te].sum()),
            "train_auc": _r(roc_auc_score(y[tr], p_tr)) if len(set(y[tr])) > 1 else None,
            "test_auc": _r(roc_auc_score(y[te], p_te)) if len(set(y[te])) > 1 else None,
            "test_ap": _r(average_precision_score(y[te], p_te)) if len(set(y[te])) > 1 else None,
            "test_metrics": binary_metrics(y[te], p_te, thr),
            "best_params": {k2: (v if isinstance(v, (int, float, str)) else str(v))
                            for k2, v in getattr(est, "best_params_", {}).items()},
        }
        folds.append(fold)
        LOG.info("折 %d：train AUC %s / test AUC %s", k, fold["train_auc"], fold["test_auc"])

    mask = ~np.isnan(oof)
    summary = {
        "n_scored": int(mask.sum()),
        "pooled_auc": _r(roc_auc_score(y[mask], oof[mask])) if len(set(y[mask])) > 1 else None,
        "pooled_ap": _r(average_precision_score(y[mask], oof[mask])) if len(set(y[mask])) > 1 else None,
        "mean_fold_auc": _r(np.mean([f["test_auc"] for f in folds if f["test_auc"] is not None])),
        "sd_fold_auc": _r(np.std([f["test_auc"] for f in folds if f["test_auc"] is not None], ddof=1)),
        "calibration_oof": calibration(y[mask], oof[mask]),
    }
    # Aggregate only decisions made using each fold's training-derived threshold.
    classification = binary_metrics(y[mask], oof_decisions[mask], 0.5)
    classification.pop("threshold")
    classification["threshold_policy"] = "per_fold_training_youden"
    summary["classification_at_training_thresholds"] = classification

    fpr, tpr, _ = roc_curve(y[mask], oof[mask])
    roc_points = [{"fpr": round(float(a), 4), "tpr": round(float(b), 4)} for a, b in zip(fpr, tpr)]
    return {"folds": folds, "summary": summary, "oof": oof, "roc_curve": roc_points}


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="病人级嵌套交叉验证与指标报告")
    p.add_argument("--features", required=True, help="step3 的 features.csv")
    p.add_argument("--out", default="results", help="输出目录")
    p.add_argument("--model", default="logreg", choices=["logreg", "hgb", "svm"])
    p.add_argument("--outer", type=int, default=5, help="外层折数")
    p.add_argument("--inner", type=int, default=3, help="内层折数（超参搜索）")
    p.add_argument("--k-best", type=int, default=0, help="内层单变量特征筛选保留数，0 表示不筛")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dry-run", action="store_true", help="只做数据体检，不训练（不需要 sklearn）")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    fpath = Path(args.features).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)

    X, y, groups, feat_cols, _ = load_features(fpath)
    LOG.info("载入 %d 个结节 × %d 个特征，%d 例病人", *X.shape, len(set(groups)))
    data_audit = audit(X, y, groups, feat_cols)
    for w in data_audit["warnings"]:
        LOG.warning(w)

    manifest = {
        "input": str(fpath),
        "input_sha256": hashlib.sha256(fpath.read_bytes()).hexdigest(),
        "labels_groups_sha256": sha256_text(json.dumps({"y": y.tolist(), "g": groups.tolist()})),
        "label_definition": "radiologist_rating_median_ge_threshold; not pathology-confirmed malignancy",
        "feature_columns_sha256": sha256_text("|".join(feat_cols)),
        "n_features": len(feat_cols),
        "params": {"model": args.model, "outer": args.outer, "inner": args.inner,
                   "k_best": args.k_best, "seed": args.seed},
        "data_audit": data_audit,
    }

    if args.dry_run:
        manifest["mode"] = "dry_run"
        (out / "data_audit.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        LOG.info("dry-run 完成，体检结果写入 %s", out / "data_audit.json")
        if data_audit["n_events"] < 20:
            LOG.error("阳性事件少于 20，不建议继续训练；先扩充样本或改标签口径。")
            return 1
        return 0

    sklearn = require_sklearn()
    if data_audit["columns_with_inf"]:
        raise SystemExit("特征含无穷值，已记录体检结果；请核查原始数据后再训练")
    t0 = time.time()
    result = run_cv(X, y, groups, args)
    elapsed = round(time.time() - t0, 1)

    np.savetxt(
        out / "oof_predictions.csv",
        np.column_stack([y, result["oof"]]),
        delimiter=",",
        header="label_malignant,prob_oof",
        comments="",
        fmt=["%d", "%.6f"],
    )
    summary = result["summary"]
    fold_report = {"folds": result["folds"], "summary": summary, "roc_curve": result["roc_curve"]}
    (out / "fold_details.json").write_text(json.dumps(fold_report, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest.update({
        "mode": "cv",
        "elapsed_s": elapsed,
        "versions": {
            "sklearn": sklearn.__version__,
            "numpy": np.__version__,
            "python": sys.version.split()[0],
        },
        "results": summary,
        "outputs_sha256": {
            "oof_predictions.csv": hashlib.sha256((out / "oof_predictions.csv").read_bytes()).hexdigest(),
            "fold_details.json": hashlib.sha256((out / "fold_details.json").read_bytes()).hexdigest(),
        },
        "caveats": [
            "指标为交叉验证估计，非独立外部验证；对外宣称效能必须另有留出集或外部数据。",
            "内外层均按病人分组，组内相关性未被单独建模。",
            "标签是医师评分的阈值化代理，非病理确诊，不据此推断临床恶性风险或净收益。",
            "阈值来自训练折 Youden 指数；换人群后最优阈值会漂移，临床使用需重新校准。",
        ],
    })
    (out / "run_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    LOG.info("池化 OOF AUC %s｜折均值 %s ± %s", summary["pooled_auc"],
             summary["mean_fold_auc"], summary["sd_fold_auc"])
    LOG.info("校准斜率 %s（1 为理想）｜Brier %s",
             summary["calibration_oof"].get("slope"), summary["calibration_oof"].get("brier"))
    LOG.info("结果写入 %s，用时 %.1fs", out, elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
