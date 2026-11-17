#!/usr/bin/env python
"""step2_annotations.py — 解析 LIDC XML 标注，聚成结节、筛真结节、导出标签表。

这是整条流水线上唯一能在"无重依赖"环境里完整跑通的环节：只用到标准库
+ numpy（可选 Pillow）。解析、聚类、筛选的 `helix_lidc` 模块已用 38 项合成
断言自检过（见 selftest.py）。

产物：
  annotations.csv      每条医师标注一行（含质心、z 区间、像素最长径）
  nodules.csv          聚类后的结节组 = 训练样本，含 label_malignant
  dropped.csv          被剔除的组及原因，供审计
  patients_summary.csv 每例病人的样本量与阳性率
  step2_manifest.json  参数、输入指纹、输出指纹

直径口径提醒：LIDC 的 XML 不含像素间距，diameter_mm 需要 DICOM 的 PixelSpacing。
有 raw DICOM 时用 --spacing-source dicom 读真实间距；没有则由 --assume-spacing
假定并明确记入 manifest（spacing_source="assumed"）。假定值会改变"直径 ≥3mm"
的筛选结果，这一步必须在方案书里披露。

用法：
  python step2_annotations.py --xml data/raw/xml --out data/processed ^
      --spacing-source dicom --dicom-root data/raw
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import helix_lidc as H  # noqa: E402

LOG = logging.getLogger("step2")


# --------------------------------------------------------------------------- #
# 输入发现
# --------------------------------------------------------------------------- #


def materialize_xml(src: Path, work: Path) -> Path:
    """src 是 zip 就解压到 work，是目录就直接用。返回 XML 目录。"""
    if src.is_dir():
        return src
    if not src.exists():
        raise SystemExit(f"输入不存在：{src}")
    if not zipfile.is_zipfile(src):
        raise SystemExit(f"既不是目录也不是 zip：{src}")
    target = work / "xml"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with zipfile.ZipFile(src) as zf:
        for member in zf.namelist():
            if member.lower().endswith(".xml") and not member.endswith("/"):
                zf.extract(member, target)
    LOG.info("已解压 XML zip 到 %s", target)
    return target


def find_xmls(root: Path) -> list[Path]:
    files = sorted(p for p in root.rglob("*.xml") if p.is_file())
    if not files:
        raise SystemExit(f"{root} 下没有找到 XML 文件")
    return files


def patient_id_of(path: Path) -> str:
    return H.patient_id_from_name(path)


def fingerprint(files: list[Path]) -> str:
    """对 (文件名, sha256) 有序列表求聚合哈希，用作输入指纹。"""
    h = hashlib.sha256()
    for p in files:
        h.update(f"{p.name}:{H.sha256_file(p)}\n".encode("utf-8"))
    return h.hexdigest()


# --------------------------------------------------------------------------- #
# 像素间距
# --------------------------------------------------------------------------- #


def spacing_from_dicom(dicom_root: Path, patient_id: str) -> tuple[float, float] | None:
    """从已下载的 DICOM 里读 PixelSpacing（mm）。读不到返回 None。"""
    try:
        import pydicom  # noqa: PLC0415
    except ImportError:
        raise SystemExit(
            "需要 pydicom 才能读取真实像素间距。\n"
            "  pip install pydicom\n"
            "或改用 --spacing-source assume 并在方案书披露假定值。"
        )

    pdir = dicom_root / patient_id
    if not pdir.exists():
        return None
    for dcm in sorted(pdir.rglob("*.dcm"))[:1] or sorted(pdir.rglob("*"))[:1]:
        if dcm.is_dir():
            continue
        try:
            ds = pydicom.dcmread(str(dcm), stop_before_pixels=True, force=True)
        except Exception:  # 单个坏文件不影响整体
            continue
        ps = getattr(ds, "PixelSpacing", None)
        if ps and len(ps) == 2:
            return (float(ps[0]), float(ps[1]))
    return None


def resolve_spacing(
    source: str,
    dicom_root: Path | None,
    assume: tuple[float, float],
    patients: list[str],
    cache: dict[str, tuple[float, float]],
) -> dict[str, tuple[float, float]]:
    """为每例病人确定 spacing；dicom 模式读不到的病例回退到假定值并记账。"""
    out: dict[str, tuple[float, float]] = {}
    for pid in patients:
        if pid in cache:
            out[pid] = cache[pid]
            continue
        got = spacing_from_dicom(dicom_root, pid) if (source == "dicom" and dicom_root) else None
        if got is None:
            LOG.warning("%s 未取到真实像素间距，回退假定值 %s", pid, assume)
            got = assume
        cache[pid] = out[pid] = got
    return out


# --------------------------------------------------------------------------- #
# 导出
# --------------------------------------------------------------------------- #


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return H.sha256_file(path)
    fields = fields or list(rows[0].keys())
    # utf-8-sig：Excel 直接双击打开不乱码
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return H.sha256_file(path)


def summarize(records: list[dict], kept: list[dict]) -> list[dict]:
    kept_ids = {(r["patient_id"], r["group_id"]) for r in kept}
    per: dict[str, dict] = {}
    for r in records:
        pid = r["patient_id"]
        s = per.setdefault(
            pid, {"patient_id": pid, "n_groups": 0, "n_kept": 0, "n_malignant": 0, "n_benign": 0}
        )
        s["n_groups"] += 1
        if (r["patient_id"], r["group_id"]) in kept_ids:
            s["n_kept"] += 1
            if r["label_malignant"] == 1:
                s["n_malignant"] += 1
            elif r["label_malignant"] == 0:
                s["n_benign"] += 1
    out = []
    for pid in sorted(per):
        s = per[pid]
        s["malignant_rate"] = round(s["n_malignant"] / s["n_kept"], 4) if s["n_kept"] else None
        out.append(s)
    return out


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="解析 LIDC XML → 结节级标签表")
    p.add_argument("--xml", required=True, help="XML 目录或 XML zip 路径")
    p.add_argument("--out", default="data/processed", help="输出目录")
    p.add_argument("--work", default=None, help="解压 zip 的临时目录，默认 <out>/.work")
    p.add_argument("--dicom-root", default=None, help="step1 的下载根目录，用于读真实像素间距")
    p.add_argument("--spacing-source", choices=["dicom", "assume"], default="assume")
    p.add_argument("--assume-spacing", default="0.7,0.7", help="假定 (row,col) 间距 mm，LIDC 常见 0.7")
    p.add_argument("--link-tol", type=float, default=H.DEFAULT_LINK_TOL_MM, help="跨医师聚类距离阈值 mm")
    p.add_argument("--z-tol", type=float, default=10.0, help="跨医师 z 方向容差 mm")
    p.add_argument("--min-diameter", type=float, default=H.DEFAULT_MIN_DIAMETER_MM)
    p.add_argument("--min-annotators", type=int, default=H.DEFAULT_MIN_ANNOTATORS)
    p.add_argument("--label-threshold", type=float, default=4.0, help="恶性度中位数 >= 该值为阳性")
    p.add_argument("--keep-all", action="store_true", help="不做真结节筛选，保留全部组（敏感性分析用）")
    p.add_argument("--patients", default=None, help="只处理这些病人，逗号分隔")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    work = Path(args.work).expanduser().resolve() if args.work else out / ".work"
    dicom_root = Path(args.dicom_root).expanduser().resolve() if args.dicom_root else None
    assume = tuple(float(x) for x in args.assume_spacing.split(","))
    if len(assume) != 2:
        raise SystemExit("--assume-spacing 需要两个数，例如 0.7,0.7")

    xml_dir = materialize_xml(Path(args.xml).expanduser().resolve(), work)
    files = find_xmls(xml_dir)
    wanted = {p.strip().upper() for p in args.patients.split(",")} if args.patients else None
    if wanted:
        files = [f for f in files if patient_id_of(f) in wanted]
        if not files:
            raise SystemExit(f"按 --patients 过滤后没有剩余 XML：{sorted(wanted)[:10]}")
    LOG.info("待解析 XML：%d 份", len(files))

    anns: list[H.Annotation] = []
    bad: list[dict] = []
    for f in files:
        pid = patient_id_of(f)
        try:
            got = H.parse_lidc_xml(f, patient_id=pid)
        except Exception as exc:
            LOG.error("解析失败 %s：%s", f.name, exc)
            bad.append({"file": f.name, "error": repr(exc)})
            continue
        if not got:
            bad.append({"file": f.name, "error": "无标注"})
        anns.extend(got)
    LOG.info("标注总数：%d 条（%d 份文件无标注/解析失败）", len(anns), len(bad))
    if not anns:
        raise SystemExit("没有解析出任何标注，检查 --xml 指向是否正确")

    patients = sorted({a.patient_id for a in anns})
    spacing_map = resolve_spacing(args.spacing_source, dicom_root, assume, patients, {})

    groups: list[H.NoduleGroup] = []
    for pid in patients:
        sub = [a for a in anns if a.patient_id == pid]
        groups.extend(
            H.cluster_annotations(sub, link_tol_mm=args.link_tol, spacing_xy=spacing_map[pid], z_tol_mm=args.z_tol)
        )
    LOG.info("聚类得到 %d 个结节组", len(groups))

    if args.keep_all:
        kept, dropped = groups, []
        LOG.warning("--keep-all 已启用：未做真结节筛选，仅用于敏感性分析")
    else:
        kept, dropped = H.select_true_nodules(
            groups,
            min_diameter_mm=args.min_diameter,
            min_annotators=args.min_annotators,
            spacing_by_patient=spacing_map,
        )

    ann_rows = [H.annotation_record(a) for a in anns]
    for r, a in zip(ann_rows, anns):
        r["spacing_row_mm"], r["spacing_col_mm"] = spacing_map[a.patient_id]

    nod_rows = [H.group_record(g, spacing_map[g.patient_id], args.label_threshold) for g in kept]
    drop_rows = []
    for g, reason in dropped:
        rec = H.group_record(g, spacing_map[g.patient_id], args.label_threshold)
        rec["drop_reason"] = reason
        drop_rows.append(rec)

    all_rows = [H.group_record(g, spacing_map[g.patient_id], args.label_threshold) for g in groups]
    summary = summarize(all_rows, nod_rows)

    outputs = {
        "annotations.csv": write_csv(out / "annotations.csv", ann_rows),
        "nodules.csv": write_csv(out / "nodules.csv", nod_rows),
        "dropped.csv": write_csv(out / "dropped.csv", drop_rows),
        "patients_summary.csv": write_csv(out / "patients_summary.csv", summary),
    }

    n_pos = sum(1 for r in nod_rows if r["label_malignant"] == 1)
    manifest = {
        "step": "step2_annotations",
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "inputs": {
            "xml_root": str(xml_dir),
            "n_xml": len(files),
            "xml_fingerprint_sha256": fingerprint(files),
            "unreadable": bad,
            "dicom_root": str(dicom_root) if dicom_root else None,
        },
        "params": {
            "spacing_source": args.spacing_source,
            "assume_spacing_mm": assume,
            "link_tol_mm": args.link_tol,
            "z_tol_mm": args.z_tol,
            "min_diameter_mm": args.min_diameter,
            "min_annotators": args.min_annotators,
            "label_threshold": args.label_threshold,
            "keep_all": args.keep_all,
        },
        "counts": {
            "n_patients": len(patients),
            "n_annotations": len(anns),
            "n_groups": len(groups),
            "n_kept": len(nod_rows),
            "n_dropped": len(drop_rows),
            "n_malignant": n_pos,
            "n_benign": len(nod_rows) - n_pos,
            "malignant_rate": round(n_pos / len(nod_rows), 4) if nod_rows else None,
        },
        "drop_reasons": {
            reason: sum(1 for _, r in dropped if r == reason) for reason in sorted({r for _, r in dropped})
        },
        "spacing_per_patient": {k: list(v) for k, v in spacing_map.items()},
        "outputs_sha256": outputs,
        "note": "label_malignant = malignancy 中位数 >= label_threshold 时取 1；"
                "该切点是研究决策，改阈值必须重跑并重写本 manifest。",
    }
    H.dump_json(out / "step2_manifest.json", manifest)

    LOG.info("样本：%d 例病人 / %d 个结节（阳性 %d，占 %.1f%%）",
             len(patients), len(nod_rows), n_pos, 100 * (n_pos / len(nod_rows) if nod_rows else 0))
    LOG.info("剔除 %d 组，原因分布 %s", len(drop_rows), manifest["drop_reasons"])
    LOG.info("产物已写入 %s", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
