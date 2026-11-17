# 知镜 Cognispect

知镜面向医学学习与研究，连接文献检索、证据阅读、影像和统计计算、复现记录与论文交流。网页提供 Cloudflare Pages / Workers 部署、本机 Python 服务及无需账号登录的离线演示。

## 功能结构

- 医学文献：中英文及医学同义词检索、相关性与年份排序、筛选、20 条分页、直接跳页和浏览器缓存。当前构建包含 22,275 条去重题录；日期待核记录不参与默认检索。
- 阅读研究：摘要双语阅读与上下文翻译、来源链接、批注与撤销重做、笔记、AI 总结和论文复盘。访客可以阅读；同步笔记、私人 PDF 与投稿需要账户。
- 计算工作台：公开 CT 切片与 ROI 测量；合成影像提供可重复真值；统计图表、患者随访分析及数学模型在浏览器运行。
- 解剖导航：男女分层全身模型，结构目录、单器官显示、透明度及本地标记；精细模型按需载入。
- 投稿和审阅：作者保存论文与复现实验步骤，提交后由管理者审阅；获准的公开记录独立于作者的私人文件。

公开离线演示位于 <https://cognispect.tech/demo/>，使用固定的 88 条检索样例和预存 AI 示例，不能代表线上完整目录或实时 AI 服务。演示的计算与影像交互在本机运行；账号、云端同步和上传操作会引导用户前往正式站点。

## 科研复现

比赛材料使用影像噪声及 ROI 轮廓变化对定量测量稳定性的合成实验。结果、参数、复现脚本及数据源说明随竞赛交付材料保存。合成影像用于控制变量实验，灰度不是 HU；真实公开 CT 保留原始 HU 与空间间距，但所含序列没有参考分割，因此仅演示 ROI 测量，不报告真实影像 Dice。

影像资源来源和许可见 [`data/imaging-sources/README.md`](data/imaging-sources/README.md)、解剖模型来源见 [`ATTRIBUTION.md`](ATTRIBUTION.md)。

## 本地运行

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

比赛验证报告中的时间来自本机浏览器测试。页面首次打开约 0.52 秒、重复刷新约 0.12 秒；该数值受本机缓存、网络和测试条件影响，不代表公网访问性能或并发能力。Cloudflare 免费配额耗尽时，访客会看到服务状态提示，并可使用离线演示。

## 联系

站点：<https://cognispect.tech>
