# HoldU backend-service

HoldU / 同频 B2 的后端服务。当前实现为 **Node.js + NestJS + TypeScript + MySQL 8** 的模块化单体，不引入 Redis、Kafka 或 RabbitMQ；MySQL 是唯一状态事实来源。

## 文档入口

| 内容 | 位置 |
|---|---|
| AI 友好型 PRD | [`docs/product/AI-friendly-PRD-v1.0.md`](../docs/product/AI-friendly-PRD-v1.0.md) |
| 后端技术方案 | [`docs/engineering/backend-architecture-v1.2.md`](../docs/engineering/backend-architecture-v1.2.md) |
| 前后端接口文档 | [`docs/engineering/API-contract-v1.3.md`](../docs/engineering/API-contract-v1.3.md) |
| OpenAPI 规范 | [`public/openapi.yaml`](public/openapi.yaml) |
| Swagger UI | [`public/index.html`](public/index.html) |
| PRD V0.4 | [`docs/product/PRD-v0.4.md`](../docs/product/PRD-v0.4.md) |
| 数据字典 | [`docs/rules/data-dictionary-v0.4.md`](../docs/rules/data-dictionary-v0.4.md) |
| 触发规则 | [`docs/rules/trigger-rules-v0.4.md`](../docs/rules/trigger-rules-v0.4.md) |

## 功能范围

- 匿名用户会话、志愿者 / 管理端登录、刷新与退出
- 用户端资料、授权、设备摘要、日记、聊天、安全升级、跟练、量表和支援请求
- 志愿者端个案列表、原子接单、会话、结束、休息、自检、排班、容量、交接和专业求助
- 管理端辖区总览、用户摘要、人员、排班、交接确认、专业接管、分层复核、审计和资源维护
- AI：DeepSeek `deepseek-v4-flash` 调用、提示词、skills、tools、配置版本、发布门禁、白名单工具执行、安全检查与降级
- 事件：MySQL 事务性 Outbox、SSE 推送、断线轮询
- 基础设施：MySQL 幂等、全局变更审计、CORS、OpenAPI / Swagger、健康检查

## 环境要求

- Node.js `>=20`
- MySQL `8.x`
- npm `>=10`

## 安装

```bash
cd backend-service
npm install
cp .env.example .env
```

按实际环境修改 `.env`：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=tongpin_app
DB_PASSWORD=your-password
DB_NAME=tongpin_b2
```

不要提交 `.env`、数据库密码、DeepSeek API Key 或任何真实用户数据。

## 数据库迁移与种子数据

```bash
npm run db:migrate
npm run db:seed
```

种子数据仅用于本地和演示，包含合成志愿者、负责人、专业督导、AI 配置管理员、资源和默认 AI 配置。

默认演示账号：

| 角色 | 账号 | 密码 |
|---|---|---|
| 志愿者 | `volunteer.lin` | `TongpinDemo2026!` |
| 志愿者 | `volunteer.zhou` | `TongpinDemo2026!` |
| 值班负责人 | `manager.xu` | `TongpinDemo2026!` |
| 专业督导 | `supervisor.chen` | `TongpinDemo2026!` |
| AI 配置管理员 | `ai.admin` | `TongpinDemo2026!` |

## 启动

开发模式：

```bash
npm run dev
```

生产构建与启动：

```bash
npm run build
npm run start
```

默认地址：

```text
API:     http://localhost:8080/api/v1
Swagger: http://localhost:8080/api/v1/docs
Health:  http://localhost:8080/api/v1/health
```

## 测试与验证

```bash
npm test
npm run test:e2e
npm run verify
```

- `npm test`：单元测试
- `npm run test:e2e`：真实 HTTP + MySQL 集成测试
- `npm run verify`：类型检查、单元测试、E2E 测试和构建的完整门禁

E2E 测试默认使用 `tongpin_b2_test` 数据库，不会写入业务库。

## AI 配置

默认模型：

```text
deepseek-v4-flash
```

支持配置：

- 模型参数
- 提示词
- skills
- tools
- 任务级参数覆盖
- 发布门禁
- 合成输入测试
- 安全检查
- 白名单只读工具
- Token 用量与审计

未配置 DeepSeek API Key 时，可使用本地 mock 模式进行演示和测试；生产环境必须配置真实密钥并通过机构安全评审。

## 子模块使用

本目录是 HoldU 的 Git 子模块：

```bash
git submodule update --init --recursive
```

更新子模块：

```bash
git submodule update --remote backend-service
```

进入子模块开发：

```bash
cd backend-service
git checkout main
```

## 安全边界

本服务不提供医疗诊断、疾病预测、自动报警、自动外呼或替代专业心理服务。AI 输出必须经人工确认，不能自动发送给用户或触发外部动作。

当前实现仍属于黑客松原型和工程验证，不代表真实机构服务、临床效果或全天候值守能力。
