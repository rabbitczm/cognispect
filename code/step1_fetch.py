#!/usr/bin/env python
"""step1_fetch.py — 从 TCIA 拉取 LIDC-IDRI 的 CT series，并留下可复现的抽样记录。

设计要点（与方案书第三章对齐）：
  * 抽样即研究决策。候选池、随机种子、选中清单、每个文件的 sha256 全部落盘，
    任何第三方用同一份 sample_manifest.json 都能拿到同一批病例。
  * 断点续传：已存在且哈希一致的文件直接跳过，不重复下载。
  * 只依赖标准库（urllib + zipfile + hashlib），不需要 pip 装任何网络库。

用法示例：
  python step1_fetch.py --out D:/work/helix/data/raw --limit 120 --seed 42
  python step1_fetch.py --dry-run                      # 只出下载计划，不落盘
  python step1_fetch.py --patients LIDC-IDRI-0001,LIDC-IDRI-0002   # 指定病例

注意：接口端点以 TCIA NBIA API 官方文档为准；若端点升级，改 BASE 常量即可。
部分集合的匿名访问受限，如遇 401/403 用环境变量 TCIA_API_KEY 提供 key。
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://services.cancerimagingarchive.net/nbia-api/services/v1"
COLLECTION = "LIDC-IDRI"
MODALITY = "CT"
UA = "HELIX-fetch/1.0 (research reproducibility pipeline)"

LOG = logging.getLogger("step1")


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #


def api_get(path: str, params: dict[str, str], retries: int = 4, timeout: int = 120) -> bytes:
    """带重试与指数退避的 GET。401/403 不重试，直接抛出可读错误。"""
    query = urllib.parse.urlencode(params)
    url = f"{BASE}/{path}?{query}"
    key = os.environ.get("TCIA_API_KEY")
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if key:
        headers["api_key"] = key

    delay = 2.0
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise SystemExit(
                    f"TCIA 拒绝访问（HTTP {exc.code}）。请到 TCIA 申请 API key，\n"
                    f"然后设置环境变量 TCIA_API_KEY 再重跑。URL={url}"
                ) from exc
            if exc.code == 404:
                raise SystemExit(f"端点不存在或参数有误（404）：{url}") from exc
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        LOG.warning("第 %d/%d 次请求失败：%s（%.1fs 后重试）", attempt, retries, last, delay)
        time.sleep(delay)
        delay = min(delay * 2, 30.0)
    raise SystemExit(f"请求连续失败 {retries} 次：{url}\n最后错误：{last}")


# --------------------------------------------------------------------------- #
# 清单与抽样
# --------------------------------------------------------------------------- #


def list_series() -> list[dict]:
    """取 LIDC-IDRI 全部 CT series 的元数据。"""
    raw = api_get("getSeries", {"Collection": COLLECTION, "Modality": MODALITY})
    rows = json.loads(raw.decode("utf-8"))
    if not isinstance(rows, list):
        raise SystemExit(f"getSeries 返回结构异常：{type(rows)}")

    out = []
    for r in rows:
        patient = r.get("PatientId") or r.get("PatientID") or ""
        series = r.get("SeriesInstanceUID") or r.get("SeriesInstanceUid") or ""
        if not patient or not series:
            continue
        out.append(
            {
                "patient_id": patient.strip(),
                "series_uid": series.strip(),
                "study_uid": (r.get("StudyInstanceUID") or "").strip(),
                "series_description": (r.get("SeriesDescription") or "").strip(),
                "image_count": int(r.get("ImageCount") or 0),
                "file_size": int(r.get("FileSize") or 0),
            }
        )
    out.sort(key=lambda d: (d["patient_id"], d["series_uid"]))
    return out


def plan_sample(rows: list[dict], limit: int | None, seed: int, patients: list[str] | None) -> dict:
    """病人级抽样：同一病人的所有 series 要么全进、要么全不进。

    病人级而非 series 级，因为后续划分必须按病人分组，抽样阶段就不能拆散病人。
    """
    by_patient: dict[str, list[dict]] = {}
    for r in rows:
        by_patient.setdefault(r["patient_id"], []).append(r)

    pool = sorted(by_patient)
    pool_digest = hashlib.sha256("\n".join(pool).encode("utf-8")).hexdigest()

    if patients:
        wanted = {p.strip() for p in patients if p.strip()}
        missing = sorted(wanted - set(pool))
        if missing:
            raise SystemExit(f"以下病例不在候选池中：{missing[:10]}{' …' if len(missing) > 10 else ''}")
        chosen = sorted(wanted)
        method = "explicit_list"
    elif limit is None or limit >= len(pool):
        chosen = pool
        method = "all"
    else:
        rng = random.Random(seed)
        chosen = sorted(rng.sample(pool, limit))
        method = f"random(seed={seed})"

    selected = [r for p in chosen for r in by_patient[p]]
    LOG.info("候选池 %d 例病人 / %d 个 series → 选中 %d 例 / %d 个 series（%s）",
             len(pool), len(rows), len(chosen), len(selected), method)
    return {
        "method": method,
        "seed": seed,
        "limit": limit,
        "pool_size": len(pool),
        "pool_sha256": pool_digest,
        "selected_patients": chosen,
        "series": selected,
    }


# --------------------------------------------------------------------------- #
# 下载
# --------------------------------------------------------------------------- #


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download_one(row: dict, out_root: Path, force: bool) -> dict:
    """下载单个 series 的 zip 并解出 DICOM 文件。

    返回记录：成功含 sha256 与解出的文件数；失败含 error。
    """
    pdir = out_root / row["patient_id"]
    zpath = pdir / f"{row['series_uid']}.zip"
    ddir = pdir / row["series_uid"]
    meta_path = pdir / f"{row['series_uid']}.json"

    if not force and meta_path.exists() and zpath.exists():
        try:
            prev = json.loads(meta_path.read_text(encoding="utf-8"))
            if prev.get("sha256") == sha256_path(zpath) and ddir.exists():
                LOG.info("跳过（已存在且哈希一致）：%s", row["series_uid"])
                return {**row, **prev, "status": "skipped"}
        except (ValueError, OSError):
            LOG.warning("已有元数据不可读，重新下载：%s", row["series_uid"])

    pdir.mkdir(parents=True, exist_ok=True)
    try:
        blob = api_get("getImage", {"SeriesInstanceUID": row["series_uid"]})
    except SystemExit as exc:
        return {**row, "status": "failed", "error": str(exc)}

    digest = sha256_bytes(blob)
    zpath.write_bytes(blob)

    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            zf.extractall(ddir)
    except zipfile.BadZipFile:
        return {**row, "status": "failed", "error": "响应不是合法 zip（可能是错误页）"}

    record = {
        **row,
        "status": "ok",
        "sha256": digest,
        "bytes": len(blob),
        "n_files": len(names),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    meta_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("完成 %s：%d 个文件 / %.1f MB", row["patient_id"], len(names), len(blob) / 1e6)
    return record


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TCIA LIDC-IDRI CT series 可复现下载")
    p.add_argument("--out", default="data/raw", help="下载根目录（默认 data/raw）")
    p.add_argument("--limit", type=int, default=None, help="抽取多少例病人；省略表示全量")
    p.add_argument("--seed", type=int, default=42, help="抽样随机种子，写进 manifest")
    p.add_argument("--patients", default=None, help="逗号分隔的病例 id，指定后忽略 --limit")
    p.add_argument("--workers", type=int, default=4, help="并发下载线程数（默认 4，请勿过高）")
    p.add_argument("--force", action="store_true", help="忽略已有文件强制重下")
    p.add_argument("--dry-run", action="store_true", help="只生成下载计划，不下载")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    out_root = Path(args.out).expanduser().resolve()
    out_root.mkdir(parents=True, exist_ok=True)
    plan_path = out_root / "sample_manifest.json"

    rows = list_series()
    LOG.info("候选池已取回：%d 个 CT series", len(rows))
    plan = plan_sample(rows, args.limit, args.seed, args.patients.split(",") if args.patients else None)
    plan["collection"] = COLLECTION
    plan["modality"] = MODALITY
    plan["api_base"] = BASE
    plan["planned_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("抽样计划已落盘：%s", plan_path)

    if args.dry_run:
        LOG.info("dry-run：不下载。计划中共 %d 个 series。", len(plan["series"]))
        return 0

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(download_one, r, out_root, args.force): r for r in plan["series"]}
        for i, fut in enumerate(as_completed(futures), 1):
            row = futures[fut]
            try:
                results.append(fut.result())
            except Exception as exc:  # 单点失败不拖垮整批
                LOG.error("series %s 异常：%s", row["series_uid"], exc)
                results.append({**row, "status": "failed", "error": repr(exc)})
            LOG.info("进度 %d/%d", i, len(futures))

    results.sort(key=lambda d: (d["patient_id"], d["series_uid"]))
    ok = [r for r in results if r["status"] in ("ok", "skipped")]
    failed = [r for r in results if r["status"] == "failed"]

    download_manifest = {
        "planned_at": plan["planned_at"],
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample_manifest_sha256": sha256_path(plan_path),
        "counts": {"total": len(results), "ok": len(ok), "failed": len(failed)},
        "results": results,
    }
    mpath = out_root / "download_manifest.json"
    mpath.write_text(json.dumps(download_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("下载清单已落盘：%s", mpath)
    LOG.info("成功 %d / 失败 %d", len(ok), len(failed))

    if failed:
        LOG.error("以下 series 失败，修正网络后重跑同一条命令即可续传：")
        for r in failed[:20]:
            LOG.error("  %s %s", r["patient_id"], r.get("error", "")[:120])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
