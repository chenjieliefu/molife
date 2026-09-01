# Molife

Molife 把“今天做了什么”整理成简短工作留痕，并生成一张准点下班车票。同事通过真实邀请码进入同一个车站，检票后共享候车人数和领队抽选结果。

## 本地启动

```bash
npm install
npm run dev
```

- 前端：http://127.0.0.1:4173
- API：http://127.0.0.1:8787/api/health
- SQLite 数据：`data/molife.db`

不配置密钥也能完整体验，系统会使用本地总结。要启用真实 AI，只在项目根目录可见的 `molife.env` 中填写：

```dotenv
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

不要把 `molife.env` 提交到代码仓库，也不要把密钥发到聊天里。密钥仅由后端读取，不会进入前端构建产物。

## 验证与生产构建

```bash
npm test
npm run build
npm start
```

`npm start` 会由 Fastify 在 8787 端口同时提供 API 和构建后的前端。

## 当前后端边界

- Fastify：HTTP 接口、输入校验、静态前端服务
- SQLite：车站、成员、工作总结、车票、检票和每日抽选
- DeepSeek Adapter：通过 OpenAI 兼容的 Responses API 生成结构化总结；无密钥或调用失败时本地降级
- 本地访问令牌：区分同一车站里的成员与站长权限

当前是可运行 MVP。本地访问令牌保存在浏览器中，适合内测；正式公网部署前建议补充账号体系、限流、审计日志和数据库备份。
