#!/usr/bin/env python
"""step3_radiomics.py — 把 LIDC 的医师轮廓变成体素掩膜，再用 PyRadiomics 提取特征。

可选依赖（本轮未执行真实 DICOM 特征提取）：
  pip install pydicom SimpleITK pyradiomics
装不上时的行为：脚本以退出码 2 结束并打印安装指令，不会抛一屏栈回溯。

三个必须写清的研究决策（都会进 manifest，也都该进方案书）：
  1. 掩膜口径 --mask-policy。结节可能有不同数量医师的独立勾画，
     用谁的那份是决策。majority（过半）、consensus（全票）、或指定票数。
  2. 重采样 --voxel-spacing。不同病例层厚/像素间距不同，不重采样等于让
     纹理特征混入几何差异。默认 1×1×1 mm。
  3. 离散化 --bin-width（默认 25 HU）。IBSI 建议对 CT 用固定 bin width。

产物：
  features.csv      一行一个结节，含标签与全部 original_* 特征
  feature_log.json  每结节的掩膜体素数、投票分布、是否被跳过及原因
  step3_manifest.json 参数、PyRadiomics/SimpleITK 版本、参数集哈希、输出指纹

用法：
  python step3_radiomics.py --series-root data/raw --nodes data/processed/nodules.csv ^
      --out data/features [--limit 20] [--mask-policy majority]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import math
import os
import sys
import tempfile
import time
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import helix_lidc as H  # noqa: E402

LOG = logging.getLogger("step3")


# --------------------------------------------------------------------------- #
# 依赖守卫
# --------------------------------------------------------------------------- #


def require_deps() -> tuple:
    missing = []
    try:
        import pydicom  # noqa: F401
    except ImportError:
        missing.append("pydicom")
    try:
        import SimpleITK  # noqa: F401
    except ImportError:
        missing.append("SimpleITK")
    try:
        import radiomics  # noqa: F401
    except ImportError:
        missing.append("pyradiomics")
    if missing:
        print(
            "缺少提取特征所需的依赖：" + ", ".join(missing) + "\n"
            "  pip install pydicom SimpleITK pyradiomics\n"
            "本次未验证完整 DICOM/PyRadiomics 环境；请按其官方兼容版本另建环境并试跑。",
            file=sys.stderr,
        )
        raise SystemExit(2)  # 2 = 环境不全，区别于 1 = 跑过但失败
    import SimpleITK as sitk
    import pydicom
    import radiomics
    from radiomics import featureextractor

    return pydicom, sitk, featureextractor, radiomics


# --------------------------------------------------------------------------- #
# DICOM 读取
# --------------------------------------------------------------------------- #


def read_series(series_dir: Path) -> dict:
    """把一个 series 目录读成有序 3D 体数据。

    实现选择：自己用 pydicom 排序后堆数组，而不是让 SimpleITK 读整个 series。
    原因是后面掩膜是在同一个数组索引空间里画的，图像与掩膜天然同几何，
    不会踩 origin/direction 不一致导致 PyRadiomics 报 geometry mismatch。
    代价是假定标准轴位采集，须逐 series 核验，这一点写进 manifest。
    """
    pydicom, _, _, _ = require_deps()

    items = []
    for p in sorted(series_dir.rglob("*")):
        if not p.is_file():
            continue
        try:
            ds = pydicom.dcmread(str(p), stop_before_pixels=True, force=True)
        except Exception:
            continue
        if getattr(ds, "Modality", "") != "CT":
            continue
        ipp = getattr(ds, "ImagePositionPatient", None)
        if ipp is None or len(ipp) < 3:
            continue
        items.append((float(ipp[2]), str(p), ds))
    if len(items) < 3:
        raise ValueError(f"DICOM 切片不足（{len(items)} 张）：{series_dir}")
    items.sort(key=lambda t: t[0])

    slices = [pydicom.dcmread(path) for _, path, _ in items]
    ref = slices[0]
    slope = float(getattr(ref, "RescaleSlope", 1.0) or 1.0)
    inter = float(getattr(ref, "RescaleIntercept", 0.0) or 0.0)

    vol = np.stack([s.pixel_array.astype(np.float32) * slope + inter for s in slices], axis=0)
    rows, cols = vol.shape[1], vol.shape[2]

    ps = getattr(ref, "PixelSpacing", None)
    if ps is None or len(ps) != 2:
        raise ValueError(f"缺少 PixelSpacing：{series_dir}")
    row_sp, col_sp = float(ps[0]), float(ps[1])

    z_sorted = [z for z, _, _ in items]
    gaps = np.diff(z_sorted)
    gap = float(np.median(gaps)) if gaps.size else float(getattr(ref, "SliceThickness", 1.0) or 1.0)
    if gap <= 0:
        raise ValueError(f"层间距异常（{gap}）：{series_dir}")

    uniform = bool(gaps.size and np.allclose(gaps, gap, atol=1e-3))
    return {
        "volume": vol,
        "slice_z": z_sorted,
        "spacing_xyz": (col_sp, row_sp, gap),  # SimpleITK 的 (x, y, z)
        "rows": rows,
        "cols": cols,
        "n_slices": len(z_sorted),
        "uniform_spacing": uniform,
        "series_dir": str(series_dir),
    }


# --------------------------------------------------------------------------- #
# 掩膜
# --------------------------------------------------------------------------- #


def policy_threshold(policy: str, n_annotators: int) -> int:
    """把掩膜口径翻译成"至少几票"。"""
    if policy == "consensus":
        return n_annotators
    if policy == "majority":
        return max(1, n_annotators // 2 + 1)
    return max(1, min(int(policy), n_annotators))


def build_mask(group: H.NoduleGroup, series: dict, policy: str) -> tuple[np.ndarray, dict]:
    """按医师投票生成 3D 掩膜。返回 (mask uint8, 统计信息)。"""
    slice_z = series["slice_z"]
    rows, cols = series["rows"], series["cols"]
    n = series["n_slices"]

    votes = np.zeros((n, rows, cols), dtype=np.uint16)
    used_voters = 0
    matched_layers = 0
    unmatched = 0

    for a in group.members:
        layer_hit = False
        for z, contours in H.contours_by_z([a]).items():
            idx = H.match_slice_index(z, slice_z)
            if idx is None:
                unmatched += 1
                continue
            layer = H.rasterize_slice(contours, rows, cols, mode="union")
            if layer.any():
                votes[idx] += (layer > 0).astype(np.uint16)
                matched_layers += 1
                layer_hit = True
        if layer_hit:
            used_voters += 1

    # Missing/unmatched readers must not silently lower the declared threshold.
    thr = policy_threshold(policy, max(group.n_annotators, 1))
    mask = (votes >= thr).astype(np.uint8)

    stats = {
        "n_annotators": group.n_annotators,
        "voters_used": used_voters,
        "vote_threshold": thr,
        "mask_voxels": int(mask.sum()),
        "max_vote": int(votes.max()),
        "matched_layers": matched_layers,
        "unmatched_layers": unmatched,
        "fallback_to_single_vote": False,
    }
    return mask, stats


def crop_to_bbox(vol: np.ndarray, mask: np.ndarray, margin: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """裁到掩膜包围盒外扩 margin 体素。纹理特征只看 ROI 邻域，裁剪不改结果，只省时间。"""
    idx = np.argwhere(mask > 0)
    if idx.size == 0:
        return vol, mask
    lo = np.maximum(idx.min(axis=0) - margin, 0)
    hi = np.minimum(idx.max(axis=0) + margin + 1, vol.shape)
    sl = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
    return vol[sl], mask[sl]


# --------------------------------------------------------------------------- #
# PyRadiomics
# --------------------------------------------------------------------------- #


def make_settings(args) -> dict:
    settings = {
        "binWidth": args.bin_width,
        "interpolator": "sitkBSpline",
        "label": 1,
        "geometryTolerance": 1e-4,
        "normalize": False,
        "correctMask": True,
    }
    if not args.no_resample:
        # 键不存在 = 不重采样，比显式传 None 更稳
        settings["resampledPixelSpacing"] = [args.voxel_spacing] * 3
    return settings


def settings_digest(settings: dict, image_types: list[str], feature_classes: list[str]) -> str:
    payload = json.dumps(
        {"settings": settings, "image_types": image_types, "feature_classes": feature_classes},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def save_feature_rows(path: Path, rows: list[dict], resume: bool = False,
                      signature: str | None = None) -> list[dict]:
    """Atomically persist feature rows, retaining prior rows on resume."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    signature_path = path.with_suffix(path.suffix + ".settings.json")
    existing: list[dict] = []
    if resume and path.exists():
        if signature and signature_path.exists():
            saved = json.loads(signature_path.read_text(encoding="utf-8"))
            if saved.get("signature") != signature:
                raise ValueError("续跑参数或来源与现有特征文件不一致")
        elif signature:
            raise ValueError("现有特征文件缺少参数/来源签名，无法安全续跑")
        with path.open(encoding="utf-8-sig", newline="") as fh:
            existing = list(csv.DictReader(fh))
    by_key = {(r["patient_id"], str(r["group_id"])): r for r in existing}
    for row in rows:
        by_key[(row["patient_id"], str(row["group_id"]))] = row
    merged = list(by_key.values())
    fields = list(dict.fromkeys(k for row in merged for k in row))
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(merged)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    if signature:
        fd, temp_name = tempfile.mkstemp(prefix=signature_path.name + ".", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"signature": signature}, fh)
            os.replace(temp_name, signature_path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
    return merged


def build_extractor(featureextractor, settings: dict, image_types: list[str], feature_classes: list[str]):
    ext = featureextractor.RadiomicsFeatureExtractor(**settings)
    ext.disableAllImageTypes()
    for it in image_types:
        ext.enableImageTypeByName(it)
    ext.disableAllFeatures()
    for fc in feature_classes:
        ext.enableFeatureClassByName(fc)
    return ext


def pick_features(result: dict) -> dict:
    """只留下 original_* 数值特征；诊断字段单独收，避免污染特征矩阵。"""
    out, diag = {}, {}
    for k, v in result.items():
        if k.startswith("diagnostics_"):
            diag[k] = str(v)
            continue
        try:
            out[k] = float(v)
        except (TypeError, ValueError):
            continue
    return out, diag


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #


def load_nodules(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"{path} 是空的")
    for r in rows:
        r["group_id"] = int(r["group_id"])
    return rows


def find_series_dir(root: Path, patient_id: str) -> Path | None:
    """在 step1 的下载根目录里找该病人的 CT series 目录。"""
    pdir = root / patient_id
    if not pdir.exists():
        return None
    cands = [d for d in pdir.iterdir() if d.is_dir()]
    if not cands:
        return None
    # 若多个 series，选文件数最多的（LIDC 每例通常只有 1 个 CT series）
    return max(cands, key=lambda d: sum(1 for _ in d.rglob("*")))


def build_group_index(
    xml_dir: Path,
    spacing_by_patient: dict[str, tuple[float, float]],
    link_tol: float,
    z_tol: float,
    wanted: set[str],
) -> dict[tuple[str, int], H.NoduleGroup]:
    """一次性重建所有结节组，建立 (patient_id, group_id) → NoduleGroup 索引。

    必须与 step2 用同一套聚类参数，否则 group_id 会错位、标签会静默张冠李戴。
    这也是为什么这里不按需懒解析：错位必须被显式检测，不能被"看起来跑通了"掩盖。
    """
    index: dict[tuple[str, int], H.NoduleGroup] = {}
    picked: list[tuple[str, Path]] = []
    for xp in sorted(xml_dir.rglob("*.xml")):
        pid = H.patient_id_from_name(xp)
        if pid in wanted:
            picked.append((pid, xp))
    if not picked:
        raise SystemExit(f"在 {xml_dir} 下找不到任何目标病例的 XML")
    LOG.info("重建结节索引：%d 份 XML", len(picked))
    for pid, xp in picked:
        try:
            anns = H.parse_lidc_xml(xp, patient_id=pid)
        except Exception as exc:
            LOG.error("解析 %s 失败：%s", xp.name, exc)
            continue
        if not anns:
            continue
        spacing = spacing_by_patient.get(pid, (0.7, 0.7))
        for g in H.cluster_annotations(anns, link_tol_mm=link_tol, spacing_xy=spacing, z_tol_mm=z_tol):
            index[(pid, g.group_id)] = g
    return index


def verify_index(index: dict, rows: list[dict]) -> None:
    """核对重建的索引与 nodules.csv 是否一致。不一致就停下，不带着错位继续跑。"""
    problems: list[str] = []
    for r in rows:
        key = (r["patient_id"], r["group_id"])
        g = index.get(key)
        if g is None:
            problems.append(f"{key} 在重建索引中不存在")
            continue
        if g.n_annotators != int(r["n_annotators"]):
            problems.append(
                f"{key} 标注人数不一致：CSV={r['n_annotators']} 重建={g.n_annotators}"
            )
    if problems:
        raise SystemExit(
            "结节索引与 nodules.csv 不一致，说明聚类参数或 XML 与 step2 时不同。\n"
            "请让 --link-tol / --z-tol 与 step2 保持一致，或直接重跑 step2。\n  "
            + "\n  ".join(problems[:10])
        )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="LIDC 结节掩膜 + PyRadiomics 特征提取")
    p.add_argument("--series-root", required=True, help="step1 下载根目录（含 <patient>/<series>/）")
    p.add_argument("--nodes", required=True, help="step2 产出的 nodules.csv")
    p.add_argument("--out", default="data/features", help="输出目录")
    p.add_argument("--mask-policy", default="majority", choices=["majority", "consensus", "1", "2", "3", "4"],
                   help="掩膜投票口径，默认 majority（过半）")
    p.add_argument("--voxel-spacing", type=float, default=1.0, help="重采样体素边长 mm，默认 1.0")
    p.add_argument("--no-resample", action="store_true", help="关闭重采样（不推荐，仅用于对照）")
    p.add_argument("--bin-width", type=float, default=25.0, help="灰度离散化 bin 宽度 HU，默认 25")
    p.add_argument("--image-types", default="Original", help="逗号分隔，如 Original,Wavelet")
    p.add_argument("--features", default="shape,firstorder,glcm,glrlm,glszm,gldm,ngtdm",
                   help="逗号分隔的特征类")
    p.add_argument("--margin", type=int, default=2, help="裁剪余量体素")
    p.add_argument("--limit", type=int, default=None, help="只处理前 N 个结节（试跑用）")
    p.add_argument("--resume", action="store_true", help="跳过 features.csv 里已存在的结节")
    p.add_argument("--out-index", default=None, help="断点续写用的中间结果路径")
    p.add_argument("--xml-dir", default=None,
                   help="LIDC XML 目录（掩膜需要原始轮廓）；缺省取环境变量 HELIX_XML_DIR")
    p.add_argument("--step2-manifest", default=None,
                   help="step2_manifest.json，用于自动对齐聚类参数与像素间距")
    p.add_argument("--link-tol", type=float, default=None, help="跨医师聚类阈值，默认与 step2 一致")
    p.add_argument("--z-tol", type=float, default=None, help="跨医师 z 容差，默认与 step2 一致")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy in ("radiomics", "SimpleITK"):
        logging.getLogger(noisy).setLevel(logging.ERROR)

    pydicom, sitk, featureextractor, radiomics = require_deps()
    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    root = Path(args.series_root).expanduser().resolve()

    rows_all = load_nodules(Path(args.nodes).expanduser().resolve())

    # 与 step2 对齐：聚类参数与像素间距直接取自 step2 的 manifest，避免手抄出错
    s2_params, sp_by_patient = {}, {}
    s2_path = Path(args.step2_manifest).expanduser().resolve() if args.step2_manifest else None
    if s2_path and s2_path.exists():
        s2 = json.loads(s2_path.read_text(encoding="utf-8"))
        s2_params = s2.get("params", {})
        sp_by_patient = {k: tuple(v) for k, v in s2.get("spacing_per_patient", {}).items()}
        LOG.info("已读取 step2 manifest：%s", s2_path)
    link_tol = args.link_tol if args.link_tol is not None else float(s2_params.get("link_tol_mm", H.DEFAULT_LINK_TOL_MM))
    z_tol = args.z_tol if args.z_tol is not None else float(s2_params.get("z_tol_mm", 10.0))

    xml_dir_arg = args.xml_dir or os.environ.get("HELIX_XML_DIR")
    if not xml_dir_arg:
        raise SystemExit(
            "掩膜需要 LIDC 原始 XML。请用 --xml-dir 指定目录，或设置环境变量 HELIX_XML_DIR。"
        )
    xml_dir = Path(xml_dir_arg).expanduser().resolve()
    if not xml_dir.exists():
        raise SystemExit(f"XML 目录不存在：{xml_dir}")
    wanted = {r["patient_id"] for r in rows_all}
    groups_index = build_group_index(xml_dir, sp_by_patient, link_tol, z_tol, wanted)
    verify_index(groups_index, rows_all)
    LOG.info("结节索引校验通过：%d 个组", len(groups_index))

    rows = rows_all[: args.limit] if args.limit else rows_all
    LOG.info("待提取结节：%d 个", len(rows))

    image_types = [s.strip() for s in args.image_types.split(",") if s.strip()]
    feature_classes = [s.strip() for s in args.features.split(",") if s.strip()]
    settings = make_settings(args)
    digest = settings_digest(settings, image_types, feature_classes)
    ext = build_extractor(featureextractor, settings, image_types, feature_classes)
    LOG.info("PyRadiomics %s / SimpleITK %s / 参数集 %s",
             radiomics.__version__, sitk.Version_VersionString(), digest[:12])

    index_path = (
        Path(args.out_index).expanduser().resolve()
        if args.out_index
        else out_dir / f".progress-{digest[:12]}.jsonl"
    )
    fpath = out_dir / "features.csv"
    run_signature = hashlib.sha256(json.dumps({
        "settings_digest": digest, "mask_policy": args.mask_policy,
        "link_tol": link_tol, "z_tol": z_tol, "margin": args.margin,
        "series_root": str(root), "xml_root": str(xml_dir),
        "spacing_by_patient": sp_by_patient,
        "nodes_sha256": H.sha256_file(Path(args.nodes).expanduser().resolve()),
    }, sort_keys=True).encode("utf-8")).hexdigest()
    existing_rows = []
    if args.resume and fpath.exists():
        existing_rows = save_feature_rows(fpath, [], resume=True, signature=run_signature)
    done: set[tuple[str, int]] = {
        (r["patient_id"], int(r["group_id"])) for r in existing_rows
    }
    if args.resume and index_path.exists():
        # Progress IDs are advisory only; a CSV row is the durable completion record.
        LOG.info("断点续跑：已有 %d 个结节结果", len(done))

    series_cache: dict[str, dict | None] = {}
    feature_rows: list[dict] = []
    log_rows: list[dict] = []
    t0 = time.time()

    for i, row in enumerate(rows, 1):
        pid = row["patient_id"]
        gid = row["group_id"]
        if (pid, gid) in done:
            continue

        if pid not in series_cache:
            sdir = find_series_dir(root, pid)
            if sdir is None:
                series_cache[pid] = None
                LOG.warning("%s 没有本地 series，跳过该病人全部结节", pid)
            else:
                try:
                    series_cache[pid] = read_series(sdir)
                except (ValueError, OSError) as exc:
                    LOG.error("读取 %s 失败：%s", pid, exc)
                    series_cache[pid] = None

        series = series_cache[pid]
        if series is None:
            log_rows.append({"patient_id": pid, "group_id": gid, "status": "no_series"})
            continue

        try:
            group = groups_index[(pid, gid)]
        except KeyError:
            LOG.error("%s/%s 不在重建索引中", pid, gid)
            log_rows.append({"patient_id": pid, "group_id": gid, "status": "missing_in_index"})
            continue

        mask, mstats = build_mask(group, series, args.mask_policy)
        if not mask.any():
            log_rows.append({"patient_id": pid, "group_id": gid, "status": "empty_mask", **mstats})
            LOG.warning("%s/%s 按既定投票策略得到空掩膜，记录并跳过，不降低票数", pid, gid)
            continue
        vol, msk = crop_to_bbox(series["volume"], mask, margin=args.margin)

        img = sitk.GetImageFromArray(vol.astype(np.float32))
        mimg = sitk.GetImageFromArray(msk.astype(np.uint8))
        img.SetSpacing(series["spacing_xyz"])
        mimg.CopyInformation(img)

        try:
            result = ext.execute(img, mimg, label=1)
        except Exception as exc:  # PyRadiomics 对退化 ROI 会抛各种异常
            LOG.error("%s/%s 特征提取失败：%s", pid, gid, exc)
            log_rows.append({"patient_id": pid, "group_id": gid, "status": f"extract_failed: {exc}", **mstats})
            continue

        feats, diag = pick_features(result)
        feature_rows.append(
            {
                "patient_id": pid,
                "group_id": gid,
                "label_malignant": int(row["label_malignant"]),
                "n_annotators": int(row["n_annotators"]),
                "diameter_mm": float(row["diameter_mm"]),
                **mstats,
                "mask_digest": hashlib.sha256(msk.tobytes()).hexdigest()[:16],
                **feats,
            }
        )
        save_feature_rows(fpath, feature_rows[-1:],
                          resume=bool(args.resume or len(feature_rows) > 1), signature=run_signature)
        log_rows.append({"patient_id": pid, "group_id": gid, "status": "ok", **mstats})
        with open(index_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"patient_id": pid, "group_id": gid}, ensure_ascii=False) + "\n")
        LOG.info("[%d/%d] %s/%s 完成：%d 体素，%d 个特征",
                 i, len(rows), pid, gid, mstats["mask_voxels"], len(feats))

    elapsed = round(time.time() - t0, 1)
    all_feature_rows = save_feature_rows(fpath, feature_rows, resume=args.resume, signature=run_signature)
    if not all_feature_rows:
        LOG.error("没有任何结节提取成功，检查 --series-root 与 --nodes 是否对应")
        H.dump_json(out_dir / "step3_manifest.json", {"failed": True, "log": log_rows, "elapsed_s": elapsed})
        return 1

    fields = list(all_feature_rows[0].keys())

    H.dump_json(out_dir / "feature_log.json", log_rows)
    n_feat_cols = sum(1 for c in fields if c.startswith("original_"))
    manifest = {
        "step": "step3_radiomics",
        "elapsed_s": elapsed,
        "params": {
            "mask_policy": args.mask_policy,
            "voxel_spacing_mm": None if args.no_resample else args.voxel_spacing,
            "bin_width_hu": args.bin_width,
            "image_types": image_types,
            "feature_classes": feature_classes,
            "margin_voxels": args.margin,
            "link_tol_mm": link_tol,
            "z_tol_mm": z_tol,
            "settings": settings,
            "settings_digest": digest,
        },
        "versions": {
            "pyradiomics": radiomics.__version__,
            "simpleitk": sitk.Version_VersionString(),
            "pydicom": pydicom.__version__,
            "numpy": np.__version__,
            "python": sys.version.split()[0],
        },
        "counts": {"requested": len(rows), "extracted_this_run": len(feature_rows),
                   "total_saved": len(all_feature_rows), "logged": len(log_rows)},
        "n_features": n_feat_cols,
        "outputs_sha256": {"features.csv": H.sha256_file(fpath)},
        "assumptions": [
            "轴位采集，按 ImagePositionPatient 的 z 排序堆叠；未处理倾斜定位。",
            "仅按 ImagePositionPatient 的 z 坐标堆叠；未逐 series 核验 ImageOrientationPatient，倾斜或非标准方向可能错误，须先检查。",
            "非等距层厚会在 spacing 里取中位层间距，uniform_spacing=false 的病例应单独核查。",
        ],
    }
    H.dump_json(out_dir / "step3_manifest.json", manifest)
    LOG.info("完成 %d 个结节，用时 %.1fs，产物 %s", len(feature_rows), elapsed, fpath)
    return 0


if __name__ == "__main__":
    sys.exit(main())
