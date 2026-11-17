# 知镜女性图谱资源

来源：[Female Anatomy Blast 2.2](https://github.com/ThaddeusMercy/female-anatomy-blast/tree/fe9fa411909502d8c3fee957fc0827c0239184a8)，固定版本 `fe9fa411909502d8c3fee957fc0827c0239184a8`。

模型许可为 CC BY 4.0。上游完整署名与改编说明保存在同目录的 `ATTRIBUTION.md`；部件覆盖清单保存在 `MODEL-COVERAGE.md`。

知镜本次转换：

- 保留 2,353 个原始部件、3,563 个原始结构概念及其组成关系、稳定编号、上游来源和分类。
- 精细几何只执行米／Y-up 到毫米／Z-up 的坐标变换 `(x,y,z) → (1000x,-1000z,1000y)`，不再对体形进行变换。
- 法线离线重新计算并量化为 Int16，精细三角索引和顶点顺序保持上游版本；按系统分块、gzip 压缩。
- 轻量预览使用 meshoptimizer 1.3.0 的逐部件边折叠简化，75,403 个三角面，保留每个部件以供选取。该预览用于快速交互；选中后读取对应精细几何。
- 目录提供常见女性解剖名称的中文显示标签，以及用于现有导航的组合结构；原始英文名与编号继续保留。

构建器：`_tools/build_female_anatomy.py`。下载源与构建依赖位于工作区的 `scratch/female-anatomy/blast-2.2` 和 `tools/anatomy-build`，不参与网站运行。

复现命令（在项目目录执行）：

```powershell
$env:TEMP = 'D:\workspace\codex_list\scratch\tmp'
$env:TMP = $env:TEMP
python _tools/build_female_anatomy.py --offline
```

移除 `--offline` 可重新获取缺少的固定版本文件。构建器需要 Python、Node.js 和工作区中安装的 `meshoptimizer@1.3.0`。浏览器只读取发布后的 JSON 与 gzip 资源。
