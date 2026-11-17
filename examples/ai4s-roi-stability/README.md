# 知镜 AI4S 受控影像实验复现

研究问题、方法和结论见 `实验方法与结果.md`。数据由知镜现有数学合成与测量核心实际计算，不依赖外部模型 API。

## 复跑

Node.js 18及以上，无需 npm 安装：

```powershell
node run_experiment.cjs
```

随后使用 Python 3.10及以上和 numpy、scipy、matplotlib 执行独立核验与图表：

```powershell
python analyse_experiment.py
```

Windows 图表优先使用已有微软雅黑字体；其他系统可将脚本中的字体路径换为可用中文字体。Python输出不修改网站源码。

先进入本目录，安装 Python 依赖（numpy、scipy、matplotlib），再按上面两条命令复跑。执行前可通过 TEMP、TMP 与 MPLCONFIGDIR 指定临时目录和绘图缓存位置。

## 结果与单位

- `parameters.json`：固定参数、随机种子、形态变化和指标单位。
- `raw_results.csv/json`：3部位×5噪声×20种子×3轮廓，900行。
- `summary.csv`：各组20次重复的均值、样本标准差、均值95%置信区间。
- `paired_contrasts.csv`：相同种子条件下配对差值；属于探索性描述，不进行多重显著性筛选。
- `independent_validation.json`：NumPy/SciPy独立核对，最大绝对误差约1.04e-12。
- `samples`：9张计算样例的Float64原始像素与3组UInt8掩膜，按小端存储、行优先、512×512。
- `figures`：三张科研图，PNG与PDF均可用于方案书。
- `source`：从网站当前版本复制的计算核心，保持原始实现。

图像像素是合成灰度；面积单位mm²；熵单位bit；Dice无量纲。种子重复不是患者样本。真实公开CT保留在网站影像模块，本实验不把合成灰度标成HU。

文献元数据重查可执行 `python verify_references.py`，使用curl访问Crossref；研究本身可完全离线复跑。
