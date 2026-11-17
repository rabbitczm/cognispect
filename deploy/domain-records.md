# cognispect.tech 域名

当前目标是 Cloudflare Pages 托管，Cloudflare 账号已注册；Resend 尚未配置。

1. 在 Cloudflare 添加域名，把注册商的 NS 改成 Cloudflare 分配的两条值，等待显示 Active。
2. 发布 Pages 项目后，在项目的 Custom domains 添加 cognispect.tech，按控制台完成 DNS。此方案不需要单独购买 VPS 或填写服务器 IP。
3. 在 Resend 添加发信域，把提供的 DNS 记录原样填入 Cloudflare，验证通过后配置发信密钥。
4. 实测 HTTPS、手机中文搜索、站主验证码和私人 PDF，完成后再确认公网可用。

完整操作见 [cloudflare.md](cloudflare.md)。名称服务器、邮件 DNS 与项目地址均取实际控制台值。
