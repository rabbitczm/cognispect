# 知镜部署核验记录

以下为此前本地 Python/Docker 部署记录。v19 改用 Cloudflare，当前进度及操作以 [cloudflare.md](cloudflare.md) 为准；真实 Cloudflare 域名与 Resend 邮件仍待配置后核验。

核验日期：2026-11-15。目标主域：`cognispect.tech`。

## 已完成的本机核验

| 项目 | 结果 |
| --- | --- |
| Python 3.12 语法 | `tools/`、`_tools/`、`code/`、`tests/` 共 50 个 Python 文件解析通过 |
| 网站与部署流程 | `python -m unittest discover -s tests -p 'test_web*.py' -v`，13 项通过 |
| 论文结构解析 | `test_publication_library.py`，1 项通过 |
| 统计口径 | `test_final_statistics.py`，2 项通过 |
| Caddy 配置 | 官方 Caddy 2.10.2 执行 `validate --adapter caddyfile` 通过 |
| Compose 配置 | `docker compose --env-file deploy/env.example config --quiet` 通过 |
| 页面离线构建 | 干净源码候选目录执行 `_tools/build_release.py` 通过 |
| 源码导出 | 实测排除本机环境文件、数据库、截图、日志、缓存、旧版页面操作脚本和受限论文正文；保留必需源码和构建资料 |
| 文件编码 | 部署文件为 UTF-8/LF，`.gitattributes` 固定 Linux 运行脚本的换行 |

部署流程测试实际创建管理员并登录，验证隐藏密码不进入命令输出；合并旧管理员文章与人员记录并使用原密码登录；把旧 PDF 归入指定用户；生成带路径和文件大小清单的 SQLite 一致备份，并在独立目录恢复账号、私人笔记和 PDF。重复恢复保留目标目录已有数据。

全部本机测试、临时文件、依赖、Caddy 验证程序和源码候选均放在 `D:\workspace\codex_list` 内。

## 尚未执行的上线操作

| 操作 | 当前状态 |
| --- | --- |
| Linux 容器构建和启动 | 本机 Docker Linux daemon 未运行，未执行镜像构建或启动；GitHub 工作流中已配置生产镜像构建步骤 |
| 真实服务器部署 | 尚未取得目标服务器 IP、登录方式和主机配置 |
| 域名解析 | 等待阿里云控制台实名认证、联系人邮箱验证和实际服务器 IPv4；记录清单见 `domain-records.md` |
| 公网 HTTPS | 等待实际解析和服务器端口就绪后由 Caddy 申请证书 |
| 实际邮件收发 | 等待 SMTP 配置；目前账号邮件流程使用隔离测试邮箱模拟收件 |
| 定时备份执行 | 已提供 systemd 服务、定时器和每日 7 份/每周 4 份保留脚本，尚未安装到服务器 |
| 服务器恢复演练 | 本机真实 SQLite/PDF 恢复已通过，服务器独立目录演练尚未执行 |
| GitHub 私有仓库 | 尚未取得实际账号和仓库地址，未创建仓库、未推送代码 |

服务器就绪后的操作顺序为：设置解析、配置 `deploy/.env`、构建镜像、隐藏输入管理员密码、启动网站、核对公网健康接口与登录、发送实际验证及重置邮件、安装备份定时任务、做一次独立恢复演练。完整命令见项目根目录 `DEPLOY.md`。
