"""helix_lidc — LIDC-IDRI 标注解析与结节几何核心。

设计约束
--------
1. 本模块只用标准库 + numpy（+ Pillow 做多边形栅格化），不依赖 pydicom /
   SimpleITK / PyRadiomics，因此可以在任何 Python 环境里被测试和复用。
2. 所有经验参数（连接容差、真结节判定阈值）都显式暴露，并在 manifest 中记录，
   不在代码里藏默认值。
3. 几何单位统一毫米；像素坐标统一 (x=列, y=行) 与 LIDC XML 的 EdgeMap 一致。
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, Sequence
import xml.etree.ElementTree as ET

import numpy as np

# LIDC 中"真结节"的通行筛选口径（承接 LUNA16 的公开评测设定）：
# 最长径 >= 3 mm，且至少被 3 位放射科医师标注。
DEFAULT_MIN_DIAMETER_MM = 3.0
DEFAULT_MIN_ANNOTATORS = 3
# 跨医师标注的聚类容差：两位医师标注同一结节时，其质心通常相差数毫米以内。
DEFAULT_LINK_TOL_MM = 5.0

# LIDC XML 文件名形如 LIDC-IDRI-0001.xml，病人号从文件名取。
_PATIENT_RE = re.compile(r"(LIDC-IDRI-\d+)", re.IGNORECASE)


def patient_id_from_name(path: str | Path) -> str:
    """从 XML 文件名推病人号；命名不符时退回文件主干，不抛异常。"""
    stem = Path(path).stem
    m = _PATIENT_RE.search(stem)
    return m.group(1).upper() if m else stem


# --------------------------------------------------------------------------- #
# 数据结构
# --------------------------------------------------------------------------- #


@dataclass
class RoiContour:
    """单一层面上的一个闭合轮廓。"""

    z: float
    sop_uid: str
    inclusion: bool
    points: list[tuple[float, float]]  # (x=列, y=行)，像素单位

    @property
    def area(self) -> float:
        """鞋带公式面积（像素²），用于加权质心。"""
        pts = self.points
        s = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            s += x1 * y2 - x2 * y1
        return abs(s) / 2.0


@dataclass
class Annotation:
    """一位医师对一枚结节的一次标注。"""

    patient_id: str
    radiologist: int  # readingSession 序号，0 起
    nodule_id: str
    malignancy: int | None
    texture: int | None
    subtlety: int | None
    sphericity: int | None
    contours: list[RoiContour]
    source_xml: str = ""

    @property
    def centroid(self) -> tuple[float, float, float]:
        """所有轮廓点的算术质心 (x, y, z)。点少时比面积加权更稳。"""
        xs, ys, zs = [], [], []
        for c in self.contours:
            for x, y in c.points:
                xs.append(x)
                ys.append(y)
                zs.append(c.z)
        if not xs:
            return (float("nan"),) * 3
        return (float(np.mean(xs)), float(np.mean(ys)), float(np.mean(zs)))

    @property
    def z_range(self) -> tuple[float, float]:
        zs = [c.z for c in self.contours]
        return (min(zs), max(zs)) if zs else (float("nan"), float("nan"))

    def max_diameter_px(self) -> float:
        """最长径的 2D 近似：逐层取点对最大距离，再跨层取最大。

        逐层计算把复杂度从 3D 的 O(N^2) 降到 O(L * n^2)，在 LIDC 的
        轮廓点数尺度上足够快，且不会因为层间距把垂直距离误算进直径。
        """
        best = 0.0
        for c in self.contours:
            pts = np.asarray(c.points, dtype=float)
            if len(pts) < 2:
                continue
            d = np.linalg.norm(pts[:, None, :] - pts[None, :, :], axis=-1)
            best = max(best, float(d.max()))
        return best

    def is_dominant(self) -> bool:
        """inclusion 轮廓占多数时，该标注视为包含型（非排除型）。"""
        inc = sum(1 for c in self.contours if c.inclusion)
        return inc >= max(1, len(self.contours) / 2)


@dataclass
class NoduleGroup:
    """跨医师聚类后的结节。标签取组内中位数。"""

    patient_id: str
    group_id: int
    members: list[Annotation] = field(default_factory=list)

    @property
    def n_annotators(self) -> int:
        return len({a.radiologist for a in self.members})

    @property
    def centroid(self) -> tuple[float, float, float]:
        cs = np.array([a.centroid for a in self.members], dtype=float)
        return tuple(float(v) for v in np.nanmean(cs, axis=0))

    @property
    def malignancy_median(self) -> float | None:
        vals = [a.malignancy for a in self.members if a.malignancy is not None]
        return float(np.median(vals)) if vals else None

    @property
    def malignancy_all(self) -> list[int]:
        return [a.malignancy for a in self.members if a.malignancy is not None]

    @property
    def texture_median(self) -> float | None:
        vals = [a.texture for a in self.members if a.texture is not None]
        return float(np.median(vals)) if vals else None

    def max_diameter_px(self) -> float:
        """组内最长径取各标注的中位数（避免个别医师画得特别大）。"""
        ds = [a.max_diameter_px() for a in self.members]
        return float(np.median(ds)) if ds else float("nan")

    def diameter_mm(self, spacing_xy: tuple[float, float]) -> float:
        """把像素最长径换算为毫米。spacing_xy=(row_spacing, col_spacing)。"""
        ry, rx = spacing_xy
        if ry <= 0 or rx <= 0:
            raise ValueError("像素间距必须为正数")
        diameters = []
        for annotation in self.members:
            longest = 0.0
            for contour in annotation.contours:
                points = np.asarray(contour.points, dtype=float) * [rx, ry]
                if len(points) >= 2:
                    distances = np.linalg.norm(points[:, None, :] - points[None, :, :], axis=-1)
                    longest = max(longest, float(distances.max()))
            diameters.append(longest)
        return float(np.median(diameters)) if diameters else float("nan")


# --------------------------------------------------------------------------- #
# XML 解析
# --------------------------------------------------------------------------- #


def _text(node: ET.Element, tag: str) -> str | None:
    el = node.find(tag)
    if el is None or el.text is None:
        return None
    return el.text.strip()


def _int_or_none(node: ET.Element | None, tag: str) -> int | None:
    if node is None:
        return None
    v = _text(node, tag)
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def parse_lidc_xml(path: str | Path, patient_id: str | None = None) -> list[Annotation]:
    """解析一份 LIDC-IDRI XML，返回全部 Annotation（未聚类）。

    兼容 unblindedReadNodule 与 readingSession 多医师结构；不假设文件名与
    patient id 的关系，patient_id 缺省取文件名主干。
    """
    p = Path(path)
    raw = p.read_bytes()
    # LIDC 的部分 XML 带 BOM 或使用非 UTF-8 声明，解析前剥掉声明更稳。
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        text = raw.decode("utf-8", errors="replace")
        text = text[text.find("<LidcReadMessage"):]
        root = ET.fromstring(text)

    pid = patient_id or p.stem
    anns: list[Annotation] = []

    for sess_idx, sess in enumerate(root.iter("readingSession")):
        for nod in sess.findall("unblindedReadNodule"):
            nid = _text(nod, "noduleID") or f"unnamed{sess_idx}"
            ch = nod.find("characteristics")
            contours: list[RoiContour] = []
            for roi in nod.findall("roi"):
                inc_raw = (_text(roi, "inclusion") or "TRUE").upper()
                z_raw = _text(roi, "imageZposition")
                sop = _text(roi, "imageSOP_InstanceUID") or ""
                if z_raw is None:
                    continue
                try:
                    z = float(z_raw)
                except ValueError:
                    continue
                pts: list[tuple[float, float]] = []
                for em in roi.findall("EdgeMap"):
                    xr, yr = _text(em, "xCoord"), _text(em, "yCoord")
                    if xr is None or yr is None:
                        continue
                    try:
                        pts.append((float(xr), float(yr)))
                    except ValueError:
                        continue
                if len(pts) >= 3:
                    contours.append(
                        RoiContour(z=z, sop_uid=sop, inclusion=(inc_raw == "TRUE"), points=pts)
                    )
            if not contours:
                continue
            anns.append(
                Annotation(
                    patient_id=pid,
                    radiologist=sess_idx,
                    nodule_id=nid,
                    malignancy=_int_or_none(ch, "malignancy"),
                    texture=_int_or_none(ch, "texture"),
                    subtlety=_int_or_none(ch, "subtlety"),
                    sphericity=_int_or_none(ch, "sphericity"),
                    contours=contours,
                    source_xml=str(p),
                )
            )
    return anns


# --------------------------------------------------------------------------- #
# 跨医师聚类
# --------------------------------------------------------------------------- #


def cluster_annotations(
    anns: Sequence[Annotation],
    link_tol_mm: float = DEFAULT_LINK_TOL_MM,
    spacing_xy: tuple[float, float] = (1.0, 1.0),
    z_tol_mm: float = 10.0,
) -> list[NoduleGroup]:
    """把同一位病人的多次标注按空间邻近合并为结节组。

    判据：质心平面距离 <= link_tol_mm，且 z 区间重叠或层间间隙 <= z_tol_mm。
    只连接不同医师的标注——同一医师在同一 session 内的两个 noduleID 视为两枚结节，
    这是 LIDC 的标注约定，不应被合并。
    """
    if not anns:
        return []

    ry, rx = spacing_xy
    scale = float(np.mean([rx, ry]))  # 像素 -> 毫米

    parent = list(range(len(anns)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    cent = np.array([a.centroid for a in anns], dtype=float)
    zr = [a.z_range for a in anns]

    for i in range(len(anns)):
        for j in range(i + 1, len(anns)):
            if anns[i].radiologist == anns[j].radiologist:
                continue
            d_xy = math.hypot(cent[i][0] - cent[j][0], cent[i][1] - cent[j][1]) * scale
            if d_xy > link_tol_mm:
                continue
            # z 方向：区间重叠，或最近端距离在容差内
            gap = max(zr[i][0], zr[j][0]) - min(zr[i][1], zr[j][1])
            if gap > z_tol_mm:
                continue
            union(i, j)

    buckets: dict[int, list[int]] = {}
    for idx in range(len(anns)):
        buckets.setdefault(find(idx), []).append(idx)

    groups: list[NoduleGroup] = []
    for gid, (_, members) in enumerate(sorted(buckets.items(), key=lambda kv: kv[0])):
        groups.append(
            NoduleGroup(
                patient_id=anns[members[0]].patient_id,
                group_id=gid,
                members=[anns[m] for m in members],
            )
        )
    return groups


def select_true_nodules(
    groups: Iterable[NoduleGroup],
    spacing_xy: tuple[float, float] = (1.0, 1.0),
    min_diameter_mm: float = DEFAULT_MIN_DIAMETER_MM,
    min_annotators: int = DEFAULT_MIN_ANNOTATORS,
    spacing_by_patient: Mapping[str, tuple[float, float]] | None = None,
) -> tuple[list[NoduleGroup], list[tuple[NoduleGroup, str]]]:
    """按公开评测口径筛选真结节，同时返回被排除的组与原因。

    spacing_by_patient 优先于 spacing_xy——不同病人的 PixelSpacing 本来就不一样，
    用同一个间距去判"直径 ≥3mm"会把筛选口径搞错。
    """
    kept: list[NoduleGroup] = []
    dropped: list[tuple[NoduleGroup, str]] = []
    for g in groups:
        if g.n_annotators < min_annotators:
            dropped.append((g, f"annotators_lt_{min_annotators}"))
            continue
        sp = spacing_xy
        if spacing_by_patient and g.patient_id in spacing_by_patient:
            sp = spacing_by_patient[g.patient_id]
        d = g.diameter_mm(sp)
        if not (d >= min_diameter_mm):
            dropped.append((g, f"diameter_lt_{min_diameter_mm}mm"))
            continue
        if not any(a.is_dominant() for a in g.members):
            dropped.append((g, "exclusion_only"))
            continue
        kept.append(g)
    return kept, dropped


def binarize_label(malignancy_median: float | None, threshold: float = 4.0) -> int | None:
    """恶性度中位数转二分类标签。阈值 4 是文献常用切点，可自行调整并记录。"""
    if malignancy_median is None:
        return None
    return int(malignancy_median >= threshold)


# --------------------------------------------------------------------------- #
# 掩膜栅格化
# --------------------------------------------------------------------------- #


def rasterize_slice(
    contours: Sequence[RoiContour],
    row: int,
    col: int,
    mode: str = "vote",
) -> np.ndarray:
    """把某一层的轮廓画成 2D 二值/计数掩膜。

    mode="vote"  每个轮廓各画一张再求和，供跨医师多数投票用（返回 uint16 计数）；
    mode="union" 单标注内部去重，返回 0/1。
    inclusion=FALSE 的轮廓（结节内孔洞）先填 1 再最后取反。
    """
    from PIL import Image, ImageDraw  # 局部导入：核心解析逻辑不依赖 Pillow

    acc = np.zeros((row, col), dtype=np.uint16)
    holes = np.zeros((row, col), dtype=np.uint16)

    for c in contours:
        img = Image.new("I", (col, row), 0)
        drw = ImageDraw.Draw(img)
        drw.polygon([(float(x), float(y)) for x, y in c.points], fill=1)
        arr = np.asarray(img, dtype=np.uint16)
        if c.inclusion:
            acc += arr
        else:
            holes += arr

    if mode == "vote":
        out = acc.copy()
    else:
        out = (acc > 0).astype(np.uint16)

    if holes.any():
        out = np.where(holes > 0, 0, out).astype(np.uint16)
    return out


def contours_by_z(anns: Sequence[Annotation]) -> dict[float, list[RoiContour]]:
    """把一组标注的轮廓按 z 归并，浮点 z 用 3 位小数定键。"""
    out: dict[float, list[RoiContour]] = {}
    for a in anns:
        for c in a.contours:
            out.setdefault(round(c.z, 3), []).append(c)
    return out


def match_slice_index(
    z: float, slice_positions: Sequence[float], tol: float = 0.51
) -> int | None:
    """把 XML 的物理 z 匹配到 DICOM 切片序号；返回 None 表示无匹配。"""
    if not slice_positions:
        return None
    arr = np.asarray(slice_positions, dtype=float)
    idx = int(np.argmin(np.abs(arr - z)))
    return idx if abs(arr[idx] - z) <= tol else None


# --------------------------------------------------------------------------- #
# 留痕
# --------------------------------------------------------------------------- #


def sha256_file(path: str | Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def dump_json(path: str | Path, obj) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def annotation_record(a: Annotation) -> dict:
    """Annotation -> 可写入 CSV/manifest 的扁平记录（用于人工核查）。"""
    cx, cy, cz = a.centroid
    z0, z1 = a.z_range
    return {
        "patient_id": a.patient_id,
        "radiologist": a.radiologist,
        "nodule_id": a.nodule_id,
        "malignancy": a.malignancy,
        "texture": a.texture,
        "subtlety": a.subtlety,
        "n_contours": len(a.contours),
        "centroid_x": round(cx, 3),
        "centroid_y": round(cy, 3),
        "centroid_z": round(cz, 3),
        "z_min": round(z0, 3),
        "z_max": round(z1, 3),
        "diameter_px": round(a.max_diameter_px(), 3),
        "source_xml": a.source_xml,
    }


def group_record(g: NoduleGroup, spacing_xy: tuple[float, float], label_threshold: float) -> dict:
    med = g.malignancy_median
    return {
        "patient_id": g.patient_id,
        "group_id": g.group_id,
        "n_annotators": g.n_annotators,
        "nodule_ids": "|".join(sorted({a.nodule_id for a in g.members})),
        "malignancy_median": med,
        "malignancy_ratings": "|".join(str(v) for v in g.malignancy_all),
        "texture_median": g.texture_median,
        "diameter_mm": round(g.diameter_mm(spacing_xy), 3),
        "label_malignant": binarize_label(med, label_threshold),
    }
