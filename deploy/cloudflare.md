# cognispect.tech · 完整免费版部署

使用 Cloudflare Pages、Workers Free、D1 Free。网站资源随 Pages 发布，私人 PDF 存入 D1；不需要 R2。站主原账号数据保留，当前登录名为 `13773172155`。统计、拟合和 PDF 提取在访问者浏览器运行。

## 免费方案

保持域名 Free、Workers Free、D1 Free 及 Workers AI 免费额度，不启用超额计费或付费模型服务。Workers 免费请求耗尽时动态功能暂停；D1 每日操作额度或存储耗尽时停止相关操作，已有数据保留。域名注册与续费仍由域名注册商管理。

Pages 单文件上限 25 MiB，构建器将大资源拆成每份不超过 20 MiB。内部文件位于 `/__private_assets/`，所有直接访问由 Functions 返回 404；通过 ASSETS 内部读取。首页、导览和管理页也保存为内部 `.bin` 文件，由入口以 HTML 返回，避免 Pages 去掉 `.html` 时出现循环跳转。Pages 的生产和预览部署必须设置 `fail_open=false`，避免免费请求耗尽时暴露内部静态文件。

D1 单库免费上限 500 MB。PDF 每文件不超过 30 MiB，以 1 MiB 分块保存。上传完成前不出现在文献列表，公开审批使用独立对象引用，作者删除私人文件不删除已批准版本。文件和工作区共用免费数据库容量。

## 构建与发布

所有命令在 `D:/workspace/codex_list/code/zhijing` 执行，脚本、缓存和临时文件均留在 D 盘。

```powershell
$env:TEMP='D:\workspace\codex_list\scratch\tmp'
$env:TMP=$env:TEMP
$env:WRANGLER_HOME='D:\workspace\codex_list\scratch\wrangler-home'
$env:XDG_CONFIG_HOME='D:\workspace\codex_list\scratch\config'
$env:WRANGLER_SEND_METRICS='false'
$env:NODE_USE_SYSTEM_CA='1'
$env:NODE_OPTIONS='--tls-max-v1.2'
$wrangler='D:\workspace\codex_list\tools\helix-wrangler\node_modules\wrangler\bin\wrangler.js'
powershell -ExecutionPolicy Bypass -File deploy/build-cloud.ps1
node $wrangler d1 migrations apply cognispect --remote --config cloud/wrangler.toml
Push-Location cloud
try {
    node $wrangler pages deploy ../scratch/cloud-site --project-name cognispect --branch main
} finally { Pop-Location }
```

公开部署目录只能使用构建器生成的 `scratch/cloud-site`。不要上传账号迁移包、用户数据目录、`claims-private.csv` 或 Wrangler 配置。Pages 绑定为 D1 `DB` 与 Workers AI `AI`，`AI_MODEL` 为 `@cf/google/gemma-4-26b-a4b-it`；不存在 R2 绑定。生产和预览均保持 `fail_open=false`。账户密码登录不需要 Resend。

## 旧站迁移

已有账号和工作区迁移后，不重新执行覆盖式迁移。新增文件迁移通过 `_tools/migrate_free_files.py` 读取私有文件清单，生成仅增加 D1 文件存储记录的 SQL。每个 SQL 语句小于 100 KB，分段拼接原始 BLOB；完整文件重复导入不会追加重复字节。

```powershell
& $python _tools/migrate_free_files.py D:/workspace/codex_list/scratch/zhijing-cloud-migration/r2-upload-manifest.json --output D:/workspace/codex_list/scratch/zhijing-cloud-migration/free-files.sql
node $wrangler d1 execute cognispect --remote --config cloud/wrangler.toml --file D:/workspace/codex_list/scratch/zhijing-cloud-migration/free-files.sql
```

这里沿用旧导出清单的文件名，不会调用或开通 R2。`$python` 使用已安装的 Python 3.12 可执行文件。

## 域名与账户登录

`cognispect.tech` 使用名称服务器 `coby.ns.cloudflare.com`、`martha.ns.cloudflare.com`。在 Pages 的 Custom domains 添加域名，DNS 指向 `cognispect.pages.dev`，验收 HTTPS。是否被搜索引擎收录与域名能否直接访问分别检查。

Cloudflare DNS 需添加网站记录：`CNAME`，名称 `@`，目标 `cognispect.pages.dev`，代理开启，TTL 自动。保留邮件 MX/TXT。2026-11-16 已核对域名 Active，正式域名、HTTPS、robots.txt 和站点地图均返回正常。

云端已改为账户密码注册／登录，不收集注册邮箱。访客不写应用 Cookie；登录后设置 HttpOnly 会话 Cookie。注册或重置时显示恢复码，恢复码仅由用户保存。数据库保存密码派生值与恢复码摘要，不保存原始密码。

迁移按顺序应用 `0003_accounts_review.sql`、`0004_catalog_cache.sql`，不重建已有用户或工作区。原站主通过原用户 ID 关联账号凭证；一次性站主初始化 SQL 位于源码包外，禁止放入公开部署目录。恢复码也不进入源码包。

## 三轮验收

1. 迁移和权限：旧 PDF 逐字节还原，私人隔离、上传完成、审批、删除与隐藏符合预期。
2. 正常使用：桌面和手机中文搜索、年份筛选、人体导航、浏览器科学计算、PDF 阅读和表格分析，以及站主草稿、发布、恢复和管理员权限。
3. 公网：Pages 与正式域名 HTTPS、真实账户密码登录与 Workers AI 总结、完整模型、大文件分块及免费配额错误提示。

具体部署状态与验收结果见工作区 output/zhijing-v22 下的交付报告。

官方资料：[Pages 限额](https://developers.cloudflare.com/pages/platform/limits/)、[Workers 计费](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers AI 价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

## v22 静态资源与缓存

保留每页 20 条数字分页，首屏请求20条，后台分批补齐并保存进度。公开数据缓存按内容版本和数据库可见性修订号校验；模型、影像使用各自资源版本。重建应用外壳不会仅因构建时间改变而失效整库题录缓存。

首次人体网格与目录约1.43MB，精细模型按器官分块加载；gzip解码在Worker运行，法线预先计算。构建器 `_tools/build_anatomy_binary.py` 可从已打包的原始图谱资源重新生成，需NumPy；一般构建直接使用现有二进制资源。

真实影像发布分块位于 assets/imaging，最大分块不足2MB；原始体数据留在本地 data/imaging-sources，不上传整份体数据。源码导出包含无损分块、来源许可和处理脚本，不包含本地原始体数据。

站点地图由Functions动态生成，公开文献详情同样遵循现有文献可见性。IndexNow验证文件为公开文件，提交操作不需要站长账号；Google及百度仍需站主注册和验证。


## v24 首屏加载

首页使用 Pages 静态外壳，`/api/bootstrap` 合并公开设置、题录版本、首20条和当前会话；浏览器检查版本后复用 IndexedDB 文献。应用程序、样式和按需图谱运行程序按内容版本命名。Service Worker 只缓存公开外壳及程序，不缓存 API、私人 PDF 或笔记。内部模型仍经过每次可见性检查，检查后复用部署版本对应的边缘缓存。

图谱构建：`node _tools/build_anatomy_start_v24.mjs`。男女首屏包分别约316/504kB，Worker解码并合批。原精细几何不改；首屏预览减面和量化记录见 `assets/anatomy/start-v24/IMPORT.md`。

影像构建：`python _tools/prepare_imaging_v24.py`，从原有无损分块拆出108张独立切片并生成嵌入目录。`test_imaging_slices_v24.cjs` 核对全部像素与空间信息，首张约231/367/265kB。

完整构建沿用 `deploy/build-cloud.ps1`。本机现有时区依赖位于 D:/workspace/codex_list/tools/helix-build-deps，执行前把 PYTHONPATH 指向此目录。性能与实际功能报告位于 D:/workspace/codex_list/output/zhijing-v24。
