"""selftest — 不依赖 pydicom / SimpleITK / PyRadiomics 的逻辑自检。

用合成 LIDC XML 验证四件事：
  1. 多医师 readingSession 结构能被正确解析（含 inclusion、EdgeMap、characteristics）；
  2. 跨医师聚类只合并不跨医师的标注，同医师两枚结节不被误合；
  3. 真结节筛选按"标注人数 + 直径"两条口径剔除并留下原因；
  4. 掩膜栅格化与 z 匹配的几何行为正确。

用法：python selftest.py [--verbose]
退出码 0 表示全部通过。
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import helix_lidc as H  # noqa: E402

# 沙箱与只读环境下都能写的落点：脚本所在目录下的临时区
TMP_ROOT = Path(__file__).resolve().parent / ".selftest_tmp"
VERBOSE = "--verbose" in sys.argv
_failures: list[str] = []
_checks = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _checks
    _checks += 1
    if cond:
        print(f"  PASS  {name}")
        if VERBOSE and detail:
            print(f"        {detail}")
    else:
        print(f"  FAIL  {name}  {detail}")
        _failures.append(name)


def synth_xml(
    radiologist_specs: list[list[dict]],
    z_levels: tuple[float, ...] = (-70.0, -67.5, -65.0),
    sop_prefix: str = "1.2.840",
) -> str:
    """拼一份结构合法的 LIDC XML。

    radiologist_specs: 每位医师一个列表，元素为
        {"nodule_id": str, "malignancy": int, "texture": int,
         "cx": float, "cy": float, "half": float}
    half 为正方形轮廓的半边长（像素）。
    """
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<LidcReadMessage>"]
    parts.append("<ResponseHeader><SeriesInstanceUid>1.3.6.1.4.1</SeriesInstanceUid></ResponseHeader>")
    for r, spec in enumerate(radiologist_specs):
        parts.append("<readingSession>")
        parts.append("<annotationVersion>3.1</annotationVersion>")
        parts.append(f"<servingFlag>{r}</servingFlag>")
        for nod in spec:
            cx, cy, half = nod["cx"], nod["cy"], nod["half"]
            parts.append("<unblindedReadNodule>")
            parts.append(f"<noduleID>{nod['nodule_id']}</noduleID>")
            parts.append("<characteristics>")
            parts.append(f"<subtlety>5</subtlety>")
            parts.append(f"<malignancy>{nod['malignancy']}</malignancy>")
            parts.append(f"<texture>{nod['texture']}</texture>")
            parts.append("</characteristics>")
            for zi, z in enumerate(z_levels):
                parts.append("<roi>")
                parts.append(f"<imageZposition>{z}</imageZposition>")
                parts.append(f"<imageSOP_InstanceUID>{sop_prefix}.{zi}</imageSOP_InstanceUID>")
                parts.append("<inclusion>TRUE</inclusion>")
                corners = [
                    (cx - half, cy - half),
                    (cx + half, cy - half),
                    (cx + half, cy + half),
                    (cx - half, cy + half),
                ]
                for x, y in corners:
                    parts.append(f"<EdgeMap><xCoord>{x}</xCoord><yCoord>{y}</yCoord></EdgeMap>")
                parts.append("</roi>")
            parts.append("</unblindedReadNodule>")
        parts.append("</readingSession>")
    parts.append("</LidcReadMessage>")
    return "\n".join(parts)


def build_case() -> Path:
    """构造一个包含三枚结节、四医师结构的最小病例。"""
    # 结节 A：三位医师标注，边长 8 px（spacing 1mm -> 8mm），恶性度 4/4/5
    # 结节 B：仅一位医师标注 -> 应被 annotators 口径剔除
    # 结节 C：三位医师标注但边长 1 px（1mm）-> 应被 diameter 口径剔除
    # 结节 D：仅医师 3 标注，与 A 空间远离，用于验证同医师不误合
    specs = [
        [  # 医师 0
            {"nodule_id": "Nodule 001", "malignancy": 4, "texture": 5, "cx": 100.0, "cy": 100.0, "half": 4.0},
            {"nodule_id": "Nodule 002", "malignancy": 2, "texture": 3, "cx": 40.0, "cy": 40.0, "half": 2.0},
            {"nodule_id": "Nodule 003", "malignancy": 3, "texture": 4, "cx": 200.0, "cy": 60.0, "half": 0.5},
        ],
        [  # 医师 1
            {"nodule_id": "Nodule 001", "malignancy": 4, "texture": 4, "cx": 100.6, "cy": 99.4, "half": 4.0},
            {"nodule_id": "Nodule 003", "malignancy": 3, "texture": 4, "cx": 200.4, "cy": 60.4, "half": 0.5},
        ],
        [  # 医师 2
            {"nodule_id": "Nodule 001", "malignancy": 5, "texture": 5, "cx": 99.2, "cy": 100.8, "half": 4.0},
            {"nodule_id": "Nodule 003", "malignancy": 2, "texture": 3, "cx": 199.6, "cy": 59.6, "half": 0.5},
        ],
        [  # 医师 3
            {"nodule_id": "Nodule 004", "malignancy": 5, "texture": 5, "cx": 300.0, "cy": 260.0, "half": 5.0},
        ],
    ]
    tmp = TMP_ROOT / "case"
    tmp.mkdir(parents=True, exist_ok=True)
    xml_path = tmp / "LIDC-IDRI-0001.xml"
    xml_path.write_text(synth_xml(specs), encoding="utf-8")
    return xml_path


def main() -> int:
    xml_path = build_case()
    spacing = (1.0, 1.0)

    print("[1] XML 解析")
    anns = H.parse_lidc_xml(xml_path)
    # 医师0 三枚 + 医师1 两枚 + 医师2 两枚 + 医师3 一枚 = 8 条标注
    check("解析出 8 条标注", len(anns) == 8, f"实际 {len(anns)}")
    check("患者 id 回退为文件名主干", anns[0].patient_id == "LIDC-IDRI-0001", anns[0].patient_id)
    check("radiologist 序号覆盖 0..3", {a.radiologist for a in anns} == {0, 1, 2, 3})
    a0 = [a for a in anns if a.radiologist == 0 and a.nodule_id == "Nodule 001"][0]
    check("每标注 3 层轮廓", len(a0.contours) == 3, f"实际 {len(a0.contours)}")
    check("每层 4 个 EdgeMap 点", all(len(c.points) == 4 for c in a0.contours))
    check("malignancy 解析为 4", a0.malignancy == 4, str(a0.malignancy))
    check("texture 解析为 5", a0.texture == 5, str(a0.texture))
    check("inclusion 解析为 True", all(c.inclusion for c in a0.contours))
    check("z 区间为 -70..-65", a0.z_range == (-70.0, -65.0), str(a0.z_range))
    cx, cy, cz = a0.centroid
    check("质心落在 (100,100,~-67.5)", abs(cx - 100) < 1e-6 and abs(cy - 100) < 1e-6 and abs(cz + 67.5) < 0.1,
          f"({cx:.3f},{cy:.3f},{cz:.3f})")

    print("[2] 几何量")
    check("8px 方形最长径约 11.31px", abs(a0.max_diameter_px() - 11.3137) < 0.01,
          f"{a0.max_diameter_px():.4f}")

    print("[3] 跨医师聚类")
    groups = H.cluster_annotations(anns, link_tol_mm=5.0, spacing_xy=spacing, z_tol_mm=10.0)
    check("聚出 4 个结节组", len(groups) == 4, f"实际 {len(groups)}")
    by_count = sorted([g.n_annotators for g in groups], reverse=True)
    # Nodule 001 与 003 各三位医师，Nodule 002 仅医师0，Nodule 004 仅医师3
    check("标注人数分布为 [3,3,1,1]", by_count == [3, 3, 1, 1], str(by_count))
    gA = [g for g in groups if g.n_annotators == 3 and abs(g.centroid[0] - 100) < 5][0]
    check("结节 A 的恶性度中位数为 4", gA.malignancy_median == 4.0, str(gA.malignancy_median))
    check("结节 A 的恶性度原始评分为 4/4/5", sorted(gA.malignancy_all) == [4, 4, 5], str(gA.malignancy_all))
    # 同一医师的两个结节必须分属不同组
    r0 = {g.group_id: g for g in groups if any(a.radiologist == 0 for a in g.members)}
    same_r0 = [g for g in groups if sum(1 for a in g.members if a.radiologist == 0) > 1]
    check("同医师多结节未被误合", len(same_r0) == 0, f"误合组数 {len(same_r0)}")

    print("[4] 真结节筛选")
    kept, dropped = H.select_true_nodules(groups, spacing_xy=spacing, min_diameter_mm=3.0, min_annotators=3)
    reasons = sorted(r for _, r in dropped)
    check("保留 1 枚真结节", len(kept) == 1, f"实际 {len(kept)}")
    check("剔除 3 枚", len(dropped) == 3, f"实际 {len(dropped)}")
    check("剔除原因含标注人数不足", any(r.startswith("annotators_lt") for r in reasons), str(reasons))
    check("剔除原因含直径不足", any(r.startswith("diameter_lt") for r in reasons), str(reasons))
    d_kept = kept[0].diameter_mm(spacing)
    check("保留结节直径 >= 3mm", d_kept >= 3.0, f"{d_kept:.2f}mm")

    print("[5] 二分类标签")
    check("中位数 4 -> label 1", H.binarize_label(4.0) == 1)
    check("中位数 3 -> label 0", H.binarize_label(3.0) == 0)
    check("中位数 4.5 -> label 1", H.binarize_label(4.5) == 1)
    check("缺失 -> None", H.binarize_label(None) is None)

    print("[6] 掩膜栅格化")
    contour = H.RoiContour(z=-70.0, sop_uid="x", inclusion=True,
                           points=[(10.0, 10.0), (20.0, 10.0), (20.0, 20.0), (10.0, 20.0)])
    m = H.rasterize_slice([contour], row=64, col=64, mode="union")
    check("掩膜 dtype 为 uint16", m.dtype == np.uint16, str(m.dtype))
    check("掩膜为 0/1 二值", set(np.unique(m)).issubset({0, 1}), str(np.unique(m)))
    area = int(m.sum())
    check("矩形填充面积在 100 上下（含边界）", 95 <= area <= 130, f"面积 {area}")
    check("掩膜在四边形外部为 0", m[5, 5] == 0 and m[40, 40] == 0)
    check("掩膜在四边形内部为 1", m[15, 15] == 1)

    hole = H.RoiContour(z=-70.0, sop_uid="x", inclusion=False,
                        points=[(13.0, 13.0), (17.0, 13.0), (17.0, 17.0), (13.0, 17.0)])
    m2 = H.rasterize_slice([contour, hole], row=64, col=64, mode="union")
    check("排除型轮廓被挖成孔洞", m2[15, 15] == 0 and int(m2.sum()) < area,
          f"带孔面积 {int(m2.sum())} < {area}")

    multi = H.rasterize_slice([contour, contour, contour], row=64, col=64, mode="vote")
    check("vote 模式累计为 3", int(multi.max()) == 3, str(int(multi.max())))

    print("[7] z 匹配")
    positions = [-70.0, -67.5, -65.0, -62.5]
    check("z=-67.5 命中索引 1", H.match_slice_index(-67.5, positions) == 1)
    check("z=-67.6 容差内命中索引 1", H.match_slice_index(-67.6, positions) == 1)
    check("z=-50 超容差返回 None", H.match_slice_index(-50.0, positions) is None)

    print("[8] 留痕")
    import json
    tmp = TMP_ROOT / "manifest"
    tmp.mkdir(parents=True, exist_ok=True)
    H.dump_json(tmp / "x.json", {"a": 1})
    check("dump_json 落盘可解析", json.loads((tmp / "x.json").read_text(encoding="utf-8"))["a"] == 1)
    h1 = H.sha256_file(xml_path)
    h2 = H.sha256_file(xml_path)
    check("sha256 稳定且为 64 位十六进制", h1 == h2 and len(h1) == 64, h1[:16] + "...")
    rec = H.group_record(gA, spacing, 4.0)
    check("组记录含 label 与直径", rec["label_malignant"] == 1 and rec["diameter_mm"] > 3, str(rec["label_malignant"]))

    print()
    if _failures:
        print(f"FAILED: {len(_failures)}/{_checks} 项未通过")
        for f in _failures:
            print(f"  - {f}")
        return 1
    print(f"OK: {_checks}/{_checks} 项全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
