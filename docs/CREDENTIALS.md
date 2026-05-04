# claude-hud-deepseek — 凭证说明

> 本文档登记的密码均为**开发期默认值**。
> 生产部署必须新建项目根 `.env`（git ignore）覆盖。

## 无内置凭证

本项目为本地 CLI 插件，不涉及数据库、消息队列、对象存储等需要凭证的服务。

## 第三方 API key

如需查询 DeepSeek API 用量（可选功能），在 `.env` 中配置：
- `DEEPSEEK_API_KEY=<your_key>`

## JWT / 加密密钥

无。
