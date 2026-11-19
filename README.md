# 知镜 Cognispect

知镜面向医学学习与研究，连接文献检索、证据阅读、影像和统计计算、复现记录与论文交流。网页提供 Cloudflare Pages / Workers 部署、本机 Python 服务及无需账号登录的离线演示。

## 功能结构

- 医学文献：中英文及医学同义词检索、相关性与年份排序、筛选、20 条分页、直接跳页和浏览器缓存。当前构建包含 22,275 条去重题录；日期待核记录不参与默认检索。
- 阅读研究：摘要双语阅读与上下文翻译、来源链接、批注与撤销重做、笔记、AI 总结和论文复盘。访客可以阅读；同步笔记、私人 PDF 与投稿需要账户。
- 计算工作台：公开 CT 切片与 ROI 测量；合成影像提供可重复真值；统计图表、患者随访分析及数学模型在浏览器运行。
- 解剖导航：男女分层全身模型，结构目录、单器官显示、透明度及本地标记；精细模型按需载入。
- 投稿和审阅：作者保存论文与复现实验步骤，提交后由管理者审阅；获准的公开记录独立于作者的私人文件。

## 下载离线演示

**Windows 离线演示包**：[下载最新 ZIP](https://github.com/rabbitczm/cognispect/releases/latest/download/zhijing-offline-demo-windows-x64.zip)。解压后双击 `打开演示.cmd`，浏览器会打开 `http://127.0.0.1:8778/demo/`。演示服务只监听本机，无需安装 Python 或 Node.js，也无需联网；运行期间请保留启动窗口，关闭窗口即可停止。

离线版包含 88 篇固定文献、男女解剖图谱、公开影像 ROI、统计和数学建模示例。检索、图谱、影像和计算均在本机运行，AI 问答展示已保存的演示样例。账号、云端笔记、论文上传和实时 AI 仍可在[正式网站](https://cognispect.tech/)使用。

也可直接打开[公开在线演示](https://cognispect.tech/demo/)，无需下载。它使用同一套固定演示数据。

## 科研复现

科研复现案例研究影像噪声及 ROI 轮廓变化对定量测量稳定性的影响。合成影像用于控制变量实验，数值为合成灰度。真实公开 CT 保留原始 HU 与空间间距，用于演示 ROI 测量。

影像资源来源和许可见 [`data/imaging-sources/README.md`](data/imaging-sources/README.md)、解剖模型来源见 [`ATTRIBUTION.md`](ATTRIBUTION.md)。

## 从源码运行

运行完整 Python 服务需 Python 3.12。先安装依赖并生成网页：

```powershell
python -m pip install -r requirements-web.txt
python _tools/build_release.py
$env:PUBLIC_URL = 'http://127.0.0.1:8096'
$env:HELIX_DATA_DIR = "$PWD/scratch/web-data"
python -m uvicorn tools.web_app:create_app --factory --host 127.0.0.1 --port 8096
```

Cloudflare Pages 构建与数据库配置见 [`DEPLOY.md`](DEPLOY.md) 和 [`deploy/cloudflare.md`](deploy/cloudflare.md)。真实邮件登录需站点管理员在 Cloudflare 配置邮件服务；源码没有服务密钥或用户数据库。

## 验证

核心用户流程与浏览器演示检查见 `_tools/check_main_v28.cjs`、`_tools/check_demo_v28.cjs`。账户、私人 PDF、投稿审批和内容隐藏见 `_tools/test_cloud_worker.mjs`。Python 服务检查可用 `python -m unittest discover -s tests -p 'test_web*.py'`。

公开在线演示和 Windows 离线包都可用于验证公开文献、人体图谱、影像 ROI、统计与数学建模。

## 联系

站点：<https://cognispect.tech>

## AI4S 可复现科研案例

[影像噪声及 ROI 轮廓变化对定量测量稳定性的影响](examples/ai4s-roi-stability/README.md)复用当前网站的计算核心，包含 300 幅合成影像、900 次测量、原始表、独立 NumPy/SciPy 核算与科研图表。Node.js 可直接运行批处理，研究不依赖在线 AI。
