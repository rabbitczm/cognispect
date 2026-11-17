#!/usr/bin/env python
"""mkfixture.py — 生成合成 LIDC XML 病例，用于无网络/无数据环境下的流水线演示与回归。

这不是"假数据糊弄"：它的用途写在名字里——fixture。真实研究必须用 TCIA 的
LIDC-IDRI。fixture 的价值在于，任何人 clone 这份代码后能在 10 秒内验证
step2 的解析、聚类、筛选口径是否按预期工作，而不必先拉 20GB DICOM。

生成规则（写成规则才能被回归测试断言）：
  * 每例病人 1–2 枚"真结节"：被 3 位医师标注，直径 4–15 mm，恶性度随机 2–5
  * 每例病人 1–2 枚"小众结节"：只被 1 位医师标注 → 应被 annotators 口径剔除
  * 每例病人 0–2 枚"微结节"：3 位医师标注但直径 1–2.5 mm → 应被直径口径剔除
  * 轮廓用正十二边形逼近圆周，点对最长距离对应目标直径

用法：
  python mkfixture.py --out data_synthetic --patients 3 --seed 7
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from pathlib import Path
from typing import Any

SPACING_MM = 0.7  # LIDC 常见像素间距，fixture 固定用它，step2 用 --assume-spacing 0.7,0.7 对齐


def _ring(cx: float, cy: float, radius: float, n: int = 12) -> list[tuple[float, float]]:
    """正 n 边形逼近圆周。用多边形而非正方形，是因为库把"最长径"定义为
    轮廓点对最大距离——正方形会把对角线当成直径，直径被虚高 √2 倍。"""
    return [
        (cx + radius * math.cos(2 * math.pi * i / n), cy + radius * math.sin(2 * math.pi * i / n))
        for i in range(n)
    ]


def build_patient(pid: str, rng: random.Random) -> str:
    """返回一份 LIDC XML 文本。"""
    z_levels = [-70.0 + 2.5 * i for i in range(4)]
    # 每位医师一个列表：分配结节给医师
    sessions: list[list[dict[str, Any]]] = [[], [], [], []]
    nodule_seq = 1

    def add_nodule(diameter_mm: float, malignancy: int, texture: int, annotators: list[int]) -> None:
        nonlocal nodule_seq
        nid = f"Nodule {nodule_seq:03d}"
        nodule_seq += 1
        cx = rng.uniform(40, 220)
        cy = rng.uniform(40, 220)
        radius = max(0.8, diameter_mm / SPACING_MM / 2.0)
        for r in annotators:
            # 每位医师看到的位置有亚像素级偏差，模拟真实阅片分歧
            jx = cx + rng.uniform(-1.0, 1.0)
            jy = cy + rng.uniform(-1.0, 1.0)
            sessions[r].append(
                {
                    "nodule_id": nid,
                    "malignancy": max(1, min(5, malignancy + rng.choice([-1, 0, 0, 1]))),
                    "texture": texture,
                    "cx": jx,
                    "cy": jy,
                    "radius": radius,
                }
            )

    for _ in range(rng.randint(1, 2)):  # 真结节
        add_nodule(rng.uniform(4.0, 15.0), rng.randint(3, 5), rng.choice([3, 4, 5]), [0, 1, 2])
    for _ in range(rng.randint(1, 2)):  # 小众结节：只有医师 3 看到
        add_nodule(rng.uniform(4.0, 12.0), rng.randint(1, 3), rng.choice([1, 3]), [3])
    for _ in range(rng.randint(0, 2)):  # 微结节
        add_nodule(rng.uniform(1.0, 2.5), rng.randint(1, 3), rng.choice([1, 3, 5]), [0, 1, 2])

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<LidcReadMessage>",
        f"<ResponseHeader><SeriesInstanceUid>1.3.6.1.4.1.14519.5.2.1.{pid}</SeriesInstanceUid></ResponseHeader>",
    ]
    for r, spec in enumerate(sessions):
        parts.append("<readingSession>")
        parts.append("<annotationVersion>3.1</annotationVersion>")
        parts.append(f"<servingFlag>{r}</servingFlag>")
        for nod in spec:
            parts.append("<unblindedReadNodule>")
            parts.append(f"<noduleID>{nod['nodule_id']}</noduleID>")
            parts.append("<characteristics>")
            parts.append("<subtlety>4</subtlety>")
            parts.append(f"<malignancy>{nod['malignancy']}</malignancy>")
            parts.append(f"<texture>{nod['texture']}</texture>")
            parts.append("</characteristics>")
            for zi, z in enumerate(z_levels):
                parts.append("<roi>")
                parts.append(f"<imageZposition>{z}</imageZposition>")
                parts.append(f"<imageSOP_InstanceUID>1.3.6.1.4.1.999.{pid}.{zi}</imageSOP_InstanceUID>")
                parts.append("<inclusion>TRUE</inclusion>")
                for x, y in _ring(nod["cx"], nod["cy"], nod["radius"]):
                    parts.append(f"<EdgeMap><xCoord>{x:.2f}</xCoord><yCoord>{y:.2f}</yCoord></EdgeMap>")
                parts.append("</roi>")
            parts.append("</unblindedReadNodule>")
        parts.append("</readingSession>")
    parts.append("</LidcReadMessage>")
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="生成合成 LIDC XML fixture")
    p.add_argument("--out", default="data_synthetic", help="输出根目录，XML 写入其下 xml/")
    p.add_argument("--patients", type=int, default=3, help="生成几例病人")
    p.add_argument("--seed", type=int, default=7, help="随机种子，保证同一 seed 生成同一批 fixture")
    args = p.parse_args(argv)

    out = Path(args.out).expanduser().resolve()
    xml_dir = out / "xml"
    xml_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)

    for i in range(1, args.patients + 1):
        pid = f"LIDC-IDRI-{i:04d}"
        (xml_dir / f"{pid}.xml").write_text(build_patient(pid, rng), encoding="utf-8")
        print(f"写出 {xml_dir / f'{pid}.xml'}")

    print(f"\n完成：{args.patients} 例合成病例 → {xml_dir}")
    print(f"下一步：python step2_annotations.py --xml {xml_dir} --out {out / 'processed'} "
          f"--assume-spacing {SPACING_MM},{SPACING_MM}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
