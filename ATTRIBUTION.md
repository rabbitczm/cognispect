# 开放解剖模型、教材与软件署名

核对日期：2026-11-13。用户选择使用开放许可模型重做，3DBody 仅作为交互方式的参考；本交付不包含 3DBody 模型、纹理、课程或知识库，不代表其官方集成。

## BodyParts3D

**BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International**

- 官方存档：https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- 现行许可：https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- 许可文本：https://creativecommons.org/licenses/by/4.0/
- 数据版本：4.0，存档更新记录列出 2013-06-19；不是 2026 年获取的患者扫描。
- 原始文件：`isa_BP3D_4.0_obj_99.zip`，142,903,898 bytes。
- 原包 SHA-256：`40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e`。
- 接入 2,234 个 OBJ 网格；4,209,773 个顶点、6,681,030 个三角面。上游说明标注 Polygon reduction rate = 99%。

**许可版本差异没有删除。** 当前官方许可页及 README 在 2025-02 更新为 CC BY 4.0；2013 年 OBJ 文件头仍写着 “BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan”。旧许可入口：https://creativecommons.org/licenses/by-sa/2.1/jp/ 。交付保留原许可页面、README、全部文件头元数据和每个原文件哈希。为了保留旧头部的相同方式共享要求，`assets/anatomy/` 转换网格同时保留此旧署名和 CC BY-SA 2.1 Japan 条款。现行官方许可依据独立记录，不把旧头部悄悄改写。

转换：OBJ 顶点转为 Float32、索引转为 UInt16/UInt32；没有二次减面、生成器官、人工挪动单个器官或改变原有三角面顺序。渲染时对全体统一作 `(x,y,z) → (x,z,-y)` 正旋转，并重算法线。颜色、灯光、高亮与透明度是本应用的教学显示方式，不是原始组织颜色。Float32 序列化误差最大约 0.000059 mm，仅描述数值转换，不说明原模型的解剖精度。

BodyParts3D 是成人男性通用解剖模型，不覆盖所有变异、年龄或性别，不能用于患者测量或诊断。17 个上游文件头未提供结构名；现按官方 ISA 组成表和同组具名 OBJ 头交叉核对，补充所属结构名称，标为“组成网格”。原头空字段与原始哈希保留。辅助中文标签不冒充上游官方中文；8 项中文标准名待核时保留官方英文。详见 `17个网格名称核对表.md`。部分复合结构只由上游已有的局部网格构成，例如肺主要由气道和血管树表示，不擅自增加外壳。

## OpenStax 教材与中文摘要

**OpenStax / Rice University, Anatomy and Physiology 2e**。

保存的教材页面在本次访问时标注 **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0)**。许可：https://creativecommons.org/licenses/by-nc-sa/4.0/ 。本交付中的教材快照与基于其整理的中文功能摘要按此许可提供，仅用于非商业教学，并保留相同方式共享及署名要求。不能将模型的 CC BY 许可误用到教材内容上。

`data/anatomy-knowledge.json` 为 21 条结构摘要、12 条系统背景说明及常用中文标签；每条摘要有对应来源。`data/anatomy-sources/knowledge-source-manifest.json` 保存 13 个教材章节的原 URL、响应状态与哈希。中文摘要经过范围约束，未声称逐一人工医学审定全部网格。未核实的独有功能明确标为待核；英文结构名及 FMA 编号以官方表为准。

## 软件

Three.js 0.160.1：MIT；原许可证、版本和来源记录保留在 `_lib/vendor/`。网页工程与数据许可分开记录，第三方许可不被本文件替代。


## Female Anatomy Blast 2.2

Female Anatomy Blast © Mercy Thaddeus，模型按 CC BY 4.0 改编。固定来源：https://github.com/ThaddeusMercy/female-anatomy-blast/tree/fe9fa411909502d8c3fee957fc0827c0239184a8 。

BodyParts3D © DBCLS；女性参考器官 © Kristen Browne and Heidi Schleeh / HuBMAP。上游各部分的完整署名、来源和许可保存在 [女性资源署名](/assets/anatomy/female-v23/ATTRIBUTION.md)，[覆盖清单](/assets/anatomy/female-v23/MODEL-COVERAGE.md) 逐项记录参考、改编和示意结构。

接入全部 2,353 个部件与 3,563 个原始概念；保留 2,195 个改编部件、76 个女性参考部件和 82 个示意部件的来源标签。精细模型仅统一坐标单位与轴向，离线重算法线；轻量模型按部件简化以便快速选取，选中后载入精细几何。中文常用名、组合入口、颜色标记和批渲染为知镜新增。详见 [转换记录](/assets/anatomy/female-v23/IMPORT.md)。
