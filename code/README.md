# 知镜 实验代码 · 使用与验证范围

修订日期：2026-11-13。代码用于研究准备与回归；不能将其存在等同于真实 CT 研究已完成。

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| helix_lidc.py | XML、医师聚类、直径、掩膜与标签工具 | 合成测试已跑 |
| selftest.py | 38 项原基础解析断言 | 已跑 |
| mkfixture.py | 生成合成 XML | 不是真实病例 |
| step1_fetch.py | TCIA 取数、抽样、留痕 | 本轮未真实下载 |
| step2_annotations.py | 标注聚类与节点 CSV | 基础与合成回归验证 |
| step3_radiomics.py | DICOM/轮廓转特征 | 投票、续跑等逻辑已回归；真实提取未跑 |
| step4_dataset.py | 审计、病人级嵌套交叉验证 | 合成完整训练已跑；真实数据未跑 |

## 环境与统一检查

`requirements-tested.txt` 锁定本轮核心测试所用版本；完整 DICOM 提取依赖单列为 `requirements-imaging-unverified.txt`，版本兼容尚待验证。不要将未测试的最低版本称为经验证环境。

在项目根目录运行：

```powershell
$env:TEMP = Join-Path (Get-Location) 'scratch/tmp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
python _tools/check_all.py
```

本机本轮 Python 为 3.12，完整依赖版本见锁文件。Node 用于自然语言词表与网页回归。安装依赖、创建虚拟环境和缓存必须在 D 盘工作区内；检查脚本不自动下载或安装包。

## 合成数据试跑

在项目根目录执行，输出全部在项目 scratch 中：

```powershell
python code/mkfixture.py --out scratch/fixture --patients 4 --seed 7
python code/step2_annotations.py --xml scratch/fixture/xml --out scratch/fixture/processed --assume-spacing 0.7,0.7
```

这些数据只验证程序，不证明真实 CT 的配准、几何、强度和特征正确。

## 真实数据的运行准备

先按数据提供方规定获取 DICOM 与 XML，保留许可、病人/series 映射和完整输入哈希；逐 series 核对方向、层间距、逐层强度转换与轮廓叠加。当前自动选择文件最多 series 的策略不可代替人工质控。以下命令是待实际验证的工作流示例，不是已经执行的成果：

```powershell
python code/step1_fetch.py --out scratch/study/raw --limit 20 --seed 42 --dry-run
python code/step2_annotations.py --xml scratch/study/raw/xml --out scratch/study/processed --spacing-source dicom --dicom-root scratch/study/raw
python code/step3_radiomics.py --series-root scratch/study/raw --nodes scratch/study/processed/nodules.csv --xml-dir scratch/study/raw/xml --step2-manifest scratch/study/processed/step2_manifest.json --out scratch/study/features
python code/step4_dataset.py --features scratch/study/features/features.csv --out scratch/study/results --model logreg --outer 5 --inner 3
```

step1 并不代替用户准备当前可用 XML 来源。参数与输入必须一致；换 mask policy、输入节点表等设置时使用新的输出目录，或明确覆盖重跑，不能混用已有特征。

## 方法学口径

- label_malignant 是恶性度评分中位数≥4 的代理标签，不是病理真值。不要使用构成标签的同一评分聚合作为独立预测基线。
- 最长径按各向异性间距逐轴换算；聚类与筛选阈值需报告，这不是官方人工配对的等价实现。
- majority 为严格多数 n//2+1；consensus 为所有参与医师投票。有重叠的两医师也可得到全票掩膜；空掩膜记录跳过，不降阈值。
- step3 续跑依据 durable CSV 行而非仅进度 ID；原子合并保存旧行。参数/节点 CSV 签名不一致时拒绝继续；签名不覆盖所有原始影像内容。feature_log 记录本次处理情况，历史日志应另行归档。
- step4 内外层均按病人分组；内层训练显式传 groups。缺失填补、常数特征筛除等在训练折内拟合。每外折训练阈值用于分类评估，不用全部 OOF 标签寻找最优点。
- input_sha256 是特征 CSV 实际字节 SHA-256，labels_groups_sha256 单独标示。交叉验证是内部验证，不是独立外部验证。

真实研究需另验系列几何、邻近结节误合并、评分缺失/争议、小类别折分、特征稳定性、校准与病人层级不确定性；不能凭目前合成测试宣称科学结果可信。
