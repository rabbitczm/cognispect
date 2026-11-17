# 知镜网站部署

云端完整免费版使用 Cloudflare Pages + Workers Free + D1 Free，步骤见 [deploy/cloudflare.md](deploy/cloudflare.md)。以下内容保留用于本机 Python 和 Docker 运行方式。

本机 v18 使用 `deploy/start-local.ps1`，数据目录为 `D:\workspace\codex_list\scratch\zhijing-data`；原账号和密码继续使用。以下 Docker/Caddy 配置用于后续公网部署，本次尚未在 Linux Docker 主机执行构建。

## v18 请求保护与公网接入

应用按来源 IP 限制登录 20 次/分钟、发信 6 次/分钟、PDF 上传 15 次/分钟、计算及问答等 30 次/分钟，超限返回 429 和 Retry-After。默认 PDF 上传上限 30 MiB，其他 JSON 请求上限 3 MiB；科学计算并发数默认为 2。对应环境变量为 `HELIX_RATE_LIMIT`、`HELIX_MAX_UPLOAD_MB`、`HELIX_COMPUTE_CONCURRENCY`。现有会话权限、跨站来源检查与新增响应安全头同时生效。

公网测试时，将域名接入 CDN/WAF 并启用供应商的 DDoS 流量清洗、登录及上传路径限速；源站 80/443 仅放行代理出口，SSH 仅放行管理来源。Caddy/Uvicorn 转发来源地址须与可信代理配置一致。应用内限速用于减少单机资源滥用；大流量 DDoS 由代理与网络服务商在源站前处理。这些公网配置需在实际域名和主机上完成，本地版本没有代替供应商开通服务。

## 运行结构

香港 Linux 主机使用 Docker Compose 启动两个服务：Caddy 提供 HTTPS、静态文件压缩与缓存，FastAPI/Uvicorn 单进程处理账号、私人工作区、PDF、统计与模型转发。起步配置为 2 核 CPU、4 GB 内存和 40 GB SSD；应用内存上限 3 GB，Caddy 上限 192 MB。一个应用实例、一个 Uvicorn worker 共同使用本机 SQLite。并发较多的 PDF 解析和统计绘图以服务器实际负载决定扩容。

代码放 `/srv/helix/app`，账号、PDF 和笔记等运行数据放 `/srv/helix/data`，备份放 `/srv/helix/backups`，证书状态放 `/srv/helix/caddy/`。这些目录在应用容器重建后保留。不要把运行数据库、备份或环境配置提交到 Git。

当前使用域名为 `cognispect.tech`。DNS 记录和当前控制台待办见 `deploy/domain-records.md`。

部署需要已经安装 Docker Engine 与 Compose v2 的 Linux 主机、指向该主机的域名，以及能够发送验证和密码重置邮件的 SMTP 账号。主机开放 TCP 80/443；UDP 443 用于 HTTP/3。应用 8000 端口只在 Compose 内部可见。

## 1. 放置源码和配置

将干净源码上传或克隆到 `/srv/helix/app`。尚未配置 GitHub 账号和远程仓库时，可以直接上传源码包。

```bash
cd /srv/helix/app
sudo install -d -o 10001 -g 10001 /srv/helix/data /srv/helix/backups
sudo install -d /srv/helix/caddy/data /srv/helix/caddy/config
cp deploy/env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

填写实际值：

| 变量 | 填写内容 |
| --- | --- |
| `HELIX_DOMAIN` | 域名，例如 `cognispect.tech`，不带协议或路径 |
| `PUBLIC_URL` | 完整公开地址，例如 `https://cognispect.tech`，不带末尾斜杠 |
| `ACME_EMAIL` | 接收证书相关通知的邮箱 |
| `SMTP_HOST` / `SMTP_PORT` | 邮件服务商提供的服务器和端口 |
| `SMTP_USER` / `SMTP_PASSWORD` | 发信账号和授权密码 |
| `SMTP_FROM` | 邮件服务商允许的发件地址 |
| `SMTP_TLS` | `starttls`（通常 587）、`ssl`（通常 465）或本机邮件中继的 `none` |

`PUBLIC_URL` 同时决定邮件链接和 Cookie 的 HTTPS 属性，应当与实际访问地址一致。未填写 SMTP 时，已有账号仍可登录，注册和找回密码会提示邮件服务未配置。问答、翻译等 API 密钥由各自页面输入；不要写入源码或 `deploy/env.example`。

## 2. 构建与创建管理员

```bash
cd /srv/helix/app
docker compose --env-file deploy/.env config --quiet
docker compose --env-file deploy/.env build app
docker compose --env-file deploy/.env run --rm --no-deps app \
  python tools/web_manage.py init-admin --email your-admin@example.com
```

终端会两次隐藏输入密码，至少 8 位。命令只输出用户 ID、邮箱和角色。如果该邮箱已经存在，命令会将它设为管理员并更新密码。管理员 ID 是随机生成的不透明标识，私人文件目录使用该 ID。

```bash
docker compose --env-file deploy/.env up -d
curl --fail https://cognispect.tech/api/health
docker compose --env-file deploy/.env logs --tail=80 app caddy
```

健康接口应返回 `service: helix-web`。然后用浏览器完成：管理员登录、注册新邮箱并点击验证邮件、创建私人笔记、上传 PDF、退出再登录、申请一次密码重置。用两个不同账号检查各自的 PDF 和笔记。模型问答的文字应逐段显示。Caddy 对代理设置即时刷新，保持 SSE 流式输出。

`/assets/` 默认缓存 1 小时并允许重验证；带 `?v=版本号` 的资源缓存 1 年。修改带版本号的资源时同时更新其版本号。HTML、账号和 API 由应用返回。

## 3. 导入旧版管理员记录和 PDF

先用旧版浏览器的“备份 JSON”导出自己的工作区；登录网站后从工作区导入该 JSON。浏览器里的旧笔记无法由服务器自动读取。

旧版桌面服务的管理员记录通常为 `scratch/admin/management.sqlite`，PDF 通常为 `scratch/pdf-library/`。如果旧服务曾使用独立的管理员目录，PDF 也可能在该目录下的 `pdfs/`。在旧服务退出后复制这两项到服务器 `/srv/helix/legacy/`，先保留原件。此目录不进入仓库。

```bash
cd /srv/helix/app
docker compose --env-file deploy/.env stop app
docker compose --env-file deploy/.env run --rm --no-deps app \
  python tools/web_manage.py users
```

从输出找到接收私人 PDF 的网站账号 ID，然后执行：

```bash
docker compose --env-file deploy/.env run --rm --no-deps \
  -v /srv/helix/legacy:/legacy:ro app \
  python tools/web_manage.py import-legacy \
  --database /legacy/management.sqlite \
  --pdf-dir /legacy/pdf-library \
  --owner-id REPLACE_WITH_USER_ID
docker compose --env-file deploy/.env up -d app
```

旧人员账号和原密码保留，重名记录保留网站已有版本；旧会话不导入。共享文章、复核记录进入管理员台账，PDF 和对应 JSON 进入指定账号的私人目录。相同 PDF 文件名已存在时停止导入，先选择正确账号或整理重复文件。

## 4. 备份与保留周期

手动备份时先停止应用写入，Caddy 保持运行：

```bash
cd /srv/helix/app
docker compose --env-file deploy/.env stop app
docker compose --env-file deploy/.env run --rm --no-deps app \
  python tools/web_manage.py backup --output /backups/manual-20261115.tar.gz
docker compose --env-file deploy/.env up -d app
```

备份包含 `accounts.sqlite`、管理员数据库、用户 PDF、工作区和导出文件。SQLite 通过自身 backup API 生成一致副本；`manifest.json` 记录备份时间、相对路径和文件大小。该文件不含 SMTP 配置或 Caddy 证书；`deploy/.env` 和证书目录需要由服务器管理员另外保存。

启用每天 UTC 03:15（香港 11:15）的自动备份：

```bash
sudo install -m 644 deploy/helix-backup.service deploy/helix-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now helix-backup.timer
sudo systemctl start helix-backup.service
sudo systemctl status helix-backup.service --no-pager
sudo systemctl list-timers helix-backup.timer
```

任务自动停止应用、备份并重新启动，通常会有短暂维护时间。保留最近 7 个每日备份；每逢星期日再保留一份周备份，最近 4 份。日志用 `journalctl -u helix-backup.service` 查看。应定期将备份复制到另一台主机或对象存储。

## 5. 隔离恢复演练

先恢复到独立目录，不覆盖在线数据：

```bash
sudo install -d -o 10001 -g 10001 /srv/helix/restore-rehearsal
docker compose --env-file deploy/.env run --rm --no-deps \
  -v /srv/helix/restore-rehearsal:/restore app \
  python tools/web_manage.py restore \
  --archive /backups/manual-20261115.tar.gz --data-dir /restore
```

恢复命令会读取文件清单并检查恢复后 SQLite，目标目录必须为空。可以使用本机转发端口单独启动演练实例：

```bash
docker compose --env-file deploy/.env run --rm --no-deps \
  -e HELIX_DATA_DIR=/restore -e PUBLIC_URL=http://localhost:18000 \
  -e SMTP_HOST= -v /srv/helix/restore-rehearsal:/restore \
  -p 127.0.0.1:18000:8000 app
# 在自己电脑另开终端：
ssh -L 18000:127.0.0.1:18000 your-user@your-server
```

浏览器访问 `http://localhost:18000`，核对管理员登录、私人笔记和 PDF，再在演练实例终端按 Ctrl+C。正式恢复时先停应用，将原 `/srv/helix/data` 改名保存，再把已验证的恢复目录改为 `/srv/helix/data`，保持 UID/GID 为 `10001:10001`，最后 `up -d app`。保留原数据目录直到核对结束。

## 6. 更新与回退

更新前按第 4 节备份，并记录当前 Git 提交或保留上一版源码。放置新源码后执行：

```bash
docker compose --env-file deploy/.env build app
docker compose --env-file deploy/.env up -d --no-deps app
curl --fail https://cognispect.tech/api/health
```

如需回退，恢复上一版源码后重新构建和启动；涉及数据变化时使用已演练的备份恢复流程。不要删除数据或执行 `docker compose down -v` 来完成更新。

## 7. 干净源码和 GitHub 检查

Windows 工作区运行：

```powershell
$env:TEMP = 'D:\workspace\codex_list\scratch\tmp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
python _tools/prepare_web_release.py `
  --output 'D:\workspace\codex_list\output\知镜-网站源码-20261115' `
  --archive 'D:\workspace\codex_list\output\知镜-网站源码-20261115.zip'
```

输出目录必须为空。导出只包含网站源码、构建所需公共文献与模型数据、许可证、运行依赖、部署配置和测试；排除本机密钥、数据库、导出数据、缓存、浏览器档案、截图、验证日志和旧版页面操作脚本。生成的 `helix-demo.html` 在部署构建时重新创建。

准备好实际 GitHub 私有仓库地址后，在干净目录初始化并推送，分支可以使用 `main`，不要在分支名中加入代理名称。仓库中的 `check.yml` 在提交、拉取请求和手动触发时运行账号流程、论文解析和统计口径测试、页面构建、Python 语法检查、Caddy/Compose 配置检查和生产镜像构建。服务器部署由上述命令执行；GitHub 检查流程不连接服务器。

第三方模型和教材内容的署名与许可见 `ATTRIBUTION.md`，Three.js 与 PDF.js 的许可证随各自资源保留。
