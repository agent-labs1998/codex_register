# Byte-V-Forge 组织仓库详细分析报告

**报告日期**: 2026-06-14
**组织地址**: https://github.com/byte-v-forge

---

## 📋 项目概览表

| 项目名称 | 功能简介 |
|---------|---------|
| [SMS](#1-sms) | SMS provider 集成服务，负责取号、验证码生命周期管理、provider 管理和报价推荐 |
| [Mailbox](#2-mailbox) | 邮箱能力服务，负责邮箱账号、provider adapter、注册/OAuth 编排和邮件信号解析 |
| [browser-automation](#3-browser-automation) | 浏览器自动化服务，为注册、登录、OAuth 等流程提供统一执行能力 |
| [workflow-runtime](#4-workflow-runtime) | 工作流运行时控制面，负责 n8n 编排状态接入、平台 run/step 投影和状态事件流 |
| [deploy](#5-deploy) | 唯一部署入口，负责将各服务、前端模块和基础设施声明式组合为可发布环境 |
| [WebUI](#6-webui) | Dashboard shell 与前端装载基础仓，提供统一布局、主题、导航和远程模块加载能力 |
| [gpt](#7-gpt) | GPT 业务核心仓，承载公开账号能力、注册/登录/探测、Codex OAuth 和 typed action API |
| [proxy-runtime](#8-proxy-runtime) | 统一出口代理网关，提供稳定入口地址并管理代理商账号、动态 IP 租约和出口策略 |
| [common-lib](#9-common-lib) | 跨仓公共能力仓，沉淀稳定契约、基础设施 helper 和共享前端基础组件 |
| [gpt-private](#10-gpt-private) | GPT 私有扩展仓，承载私有 provider、私有动作元数据和私有 workflow |
| [gopay-app](#11-gopay-app) | GoPay App 账号与支付运行时服务，负责多用户状态、设备指纹和 GoPay payment runtime |

---

## 📖 项目详细介绍

<a id="1-sms"></a>
### 1. SMS

**仓库地址**: https://github.com/byte-v-forge/sms

#### 核心能力

`sms` 是独立 SMS provider 集成服务，负责取号、验证码生命周期、provider 管理、报价推荐和自带 dashboard。

- **Provider 聚合**: 聚合多个 SMS provider，提供报价、库存、余额、取号、查码、取消和完成等能力
- **路由推荐**: 基于 provider capability 与 route recommendation 选择可用号码渠道
- **状态管理**: 管理订单状态、验证码 TTL secret、provider 配置和失败熔断状态
- **API 提供**: 提供 gRPC API、HTTP dashboard BFF 和独立静态 Web UI
- **灵活存储**: PostgreSQL、Redis、NATS/JetStream 均为可选增强；未配置时保持 standalone 可启动

#### 使用方式

业务服务通过 SMS 契约申请号码、查询订单或消费验证码事件；provider API key 通过设置页或管理 API 写入，不写入业务仓。验证码原文只进入服务自有 TTL secret store，对外返回引用。

#### 入口

- **服务入口**: `cmd/sms-service`
- **公开契约**: `proto/byte/v/forge/contracts/sms/v1/`
- **内部/provider 契约**: `proto/byte/v/forge/sms/`
- **Provider adapter**: `internal/providers/`
- **Dashboard**: `webui/`

#### 常用检查

```sh
sh scripts/generate-proto.sh
(cd webui && npm run proto)
git diff --check
```

---

<a id="2-mailbox"></a>
### 2. Mailbox

**仓库地址**: https://github.com/byte-v-forge/mailbox

#### 核心能力

`mailbox` 是邮箱能力仓，负责邮箱账号、provider adapter、注册/OAuth 编排、收件、邮件信号解析和独立 dashboard。

- **API 提供**: 提供 Mailbox gRPC API、Dashboard HTTP API 和自带静态 Web UI
- **Outlook 集成**: 内置 Outlook 注册/OAuth、Microsoft Graph 收件和 Cloudflare Email Routing webhook 链路
- **信号解析**: 解析入站邮件中的验证码等可复用信号，并以 secret ref/artifact ref 对外暴露
- **状态管理**: 支持 mailbox 自有事件、operation 投影、收件缓存和跨副本抓取协调
- **Provider 抽象**: 通过 provider capability 描述 Outlook、Cloudflare 等能力差异，避免业务侧硬编码 provider 细节

#### 使用方式

业务服务通过 mailbox API、事件或查询读取邮箱状态与邮件信号；真实凭据、provider raw shape 和内部 operation 状态只留在 mailbox 内部。Outlook 浏览器动作可接入 `browser-automation`，Cloudflare 入站邮件通过 webhook 或 relay pull 进入本服务。

#### 入口

- **服务入口**: `services/mailbox-api/`
- **Cloudflare relay worker**: `workers/cloudflare-email-relay/`
- **契约真源**: `proto/`
- **Dashboard**: `webui/`

#### 常用检查

```sh
sh scripts/generate-proto.sh
git diff --check
```

---

<a id="3-browser-automation"></a>
### 3. browser-automation

**仓库地址**: https://github.com/byte-v-forge/browser-automation

#### 核心能力

`browser-automation` 是可独立部署的浏览器自动化服务，为注册、登录、OAuth、页面探测等需要真实浏览器的流程提供统一执行能力。

- **多功能 API**: 提供 gRPC 与 HTTP API，支持会话创建、页面操作、表单输入、元素读取、截图、Cookie/Storage 和网络信息采集
- **持久化管理**: 持久化 session、task 与 artifact，调用方可用 TTL 管理浏览器流程生命周期
- **运行时隔离**: 通过 runtime adapter 隔离 Camoufox、CloakBrowser、Playwright/CDP 等浏览器实现细节
- **调试支持**: 自带独立 Web UI，用于查看会话、任务、执行结果和调试材料
- **专注通用能力**: 只提供通用浏览器能力，不内置 GPT、邮箱或其他业务注册流程

#### 使用方式

业务服务通过公开 proto/gRPC 或 HTTP 边界调用浏览器能力；业务状态机、站点规则和账号流程留在各业务仓。运行时、代理引用、artifact 存储和数据库连接由部署配置注入。

#### 入口

- **服务入口**: `cmd/browser-automation-service`
- **契约真源**: `proto/browser/automation/v1/`
- **内部 runtime 契约**: `proto/browser/automation/private/v1/`
- **独立前端**: `webui/`

#### 常用检查

```sh
sh scripts/generate-proto.sh
(cd webui && npm run proto)
git diff --check
```

---

<a id="4-workflow-runtime"></a>
### 4. workflow-runtime

**仓库地址**: https://github.com/byte-v-forge/workflow-runtime

#### 核心能力

`workflow-runtime` 是工作流运行时控制面，负责 n8n 编排状态接入、平台 run/step 投影、状态事件流和 Workflow dashboard 远程模块。

- **状态汇总**: 通过 n8n Public API 汇总引擎状态、workflow 定义和最近 execution
- **流程图投影**: 将 n8n 节点、连线和位置投影为平台流程图，保持与管理员 editor 一致
- **运行状态接收**: 接收 n8n HTTP Request 节点上报的 run/step 状态，维护当前运行投影
- **实时推送**: 通过 SSE/HotStream 向前端推送工作流状态变化
- **Dashboard 集成**: 提供 Workflow dashboard 远程模块；n8n editor 仅作为管理员编排入口

#### 使用方式

业务前端查询平台原生状态页，不直接 iframe 或跳转到 n8n editor。业务服务通过 API、事件或 workflow 节点上报协作；GPT、Mailbox、SMS、Proxy 等业务状态机留在各自服务内。

#### 入口

- **服务入口**: `cmd/workflow-runtime`
- **Dashboard 模块**: `webui/`
- **状态 API**: `/api/workflow-runtime/*`
- **步骤上报**: `POST /api/workflow-runtime/runs/steps`
- **状态流**: `GET /api/workflow-runtime/streams/state`

#### 常用检查

```sh
(cd webui && npm run lint)
git diff --check
```

---

<a id="5-deploy"></a>
### 5. deploy

**仓库地址**: https://github.com/byte-v-forge/deploy

#### 核心能力

`deploy` 是 byte-v-forge 的唯一部署入口，负责把各子仓服务、前端模块、基础设施和运行配置声明式组合为可发布环境。

- **部署管理**: 维护 Docker Compose、Helm chart、values、环境示例和部署脚本
- **服务组合**: 组合 WebUI shell、业务远程模块、service catalog、路由、导航和运行时配置
- **拓扑声明**: 声明平台事件拓扑、runtime/provider adapter catalog、chart source 装载清单和多仓发布批次
- **运维入口**: 统一远程构建、镜像导入、Helm 渲染、部署升级和日志查看入口

#### 使用方式

本仓只维护部署组合与运行配置，不承载业务实现。源码编辑可在本机完成；镜像构建、部署验证和发布动作统一由远程宿主机环境执行。

#### 入口

- **Compose**: `docker-compose.yml`
- **Helm chart**: `iac/helm/byte-v-forge/`
- **环境示例**: `.env.example`
- **远程部署**: `scripts/deploy-remote.sh`
- **配置检查**: `scripts/validate-deploy-config.sh`
- **日志查看**: `scripts/logs-remote.sh`

#### 常用命令

```sh
scripts/validate-deploy-config.sh
scripts/deploy-remote.sh --validate-only webui gpt-service
scripts/deploy-remote.sh all
scripts/logs-remote.sh -f all
```

---

<a id="6-webui"></a>
### 6. WebUI

**仓库地址**: https://github.com/byte-v-forge/webui

#### 核心能力

`webui` 是 byte-v-forge 的 dashboard shell 与前端装载基础仓，提供统一布局、主题、导航、service catalog 和远程模块加载能力。

- **平台 Shell**: 提供平台 dashboard shell、基础路由、布局、主题和导航框架
- **Service Catalog**: 提供 service catalog Web/API 基础入口，支撑部署期声明式装载业务模块
- **模块集成**: 通过模块装载接口集成 GPT、Mailbox、SMS、GoPay、Proxy、Workflow 等服务拥有方前端
- **组件复用**: 前端基础组件、uikit 和通用数据驱动组件来自 `common-lib/ui`，本仓只保留 shell 与装载边界
- **职责分离**: 后端 server 只负责 shell/API gateway/service catalog 基础能力，不承载业务动作或 provider 状态机

#### 使用方式

业务页面、业务数据请求和资源详情归各业务仓；最终组合由 `deploy` 的 dashboard catalog 和部署配置声明。本仓通过 npm 包边界消费公共 UI 能力，不直接 import sibling repo 业务源码。

#### 入口

- **前端源码**: `src/`
- **Shell server**: `server/`
- **契约生成脚本**: `scripts/generate-proto.sh`
- **静态资源**: `public/`

#### 常用检查

```sh
npm run proto:frontend
npm run lint
git diff --check
```

---

<a id="7-gpt"></a>
### 7. gpt

**仓库地址**: https://github.com/byte-v-forge/gpt

#### 核心能力

`gpt` 是 GPT 业务核心仓，承载公开账号能力、注册/登录/探测、Codex OAuth、typed action API 和公共编排 host。

- **账号管理**: 管理 GPT 账号库存、邮箱分配、任务状态和业务状态投影
- **Action API**: 提供注册、登录、探测、Codex OAuth、OTP checkpoint 等可编排 action API
- **Runtime Host**: 作为公共 GPT runtime host，承接 n8n workflow 与 dashboard 的状态查询和动作入口
- **插件 SPI**: 提供插件 SPI，让私有 provider/action 通过 `gpt-private` 注册，而不侵入核心实现
- **Dashboard 模块**: 提供 GPT dashboard 模块，业务列表、动作区和详情展示保持数据驱动

#### 使用方式

公开流程和稳定契约放在本仓；私有 provider runtime、私有 workflow 和私有动作元数据放在 `gpt-private`。浏览器、邮箱、SMS、GoPay 等外部能力通过 proto/gRPC、HTTP、事件或部署配置集成。

#### 入口

- **账号模块**: `gpt-account/`
- **编排服务**: `orchestrator/`
- **插件 SPI**: `pkg/gptplugin/`
- **部署入口**: `gpt-service/`
- **契约真源**: `proto/`
- **前端模块**: `webui/`

#### 常用检查

```sh
./scripts/generate-proto.sh
(cd orchestrator && go list ./...)
(cd webui && npm run lint)
git diff --check
```

---

<a id="8-proxy-runtime"></a>
### 8. proxy-runtime

**仓库地址**: https://github.com/byte-v-forge/proxy-runtime

#### 核心能力

`proxy-runtime` 是统一出口代理网关，为业务服务提供稳定入口地址，并把代理商账号、动态 IP 租约、出口策略和 Mihomo 数据面配置集中在本服务内管理。

- **统一入口**: 以"固定网关地址 + 代理用户名/密码"向业务侧提供出口选择能力
- **资源管理**: 统一管理代理用户、出口 profile、动态 IP provider、provider account、租约和并发槽位
- **Mihomo 集成**: 生成并协调 Mihomo 配置，让 Mihomo 负责真实转发、认证、规则路由、proxy group 和健康检查
- **风险检查**: 提供出口 IP、地理位置、风控风险、Cloudflare canary 和目标连通性检查
- **运维 Dashboard**: 基于项目自有 MetaCubeXD fork 提供代理运维 dashboard，覆盖入口用户、动态 provider、原生配置和运行连接观察

#### 使用方式

业务仓只通过 proxy ref、固定网关账号或契约调用本服务，不接触上游 provider 代理地址、密码、session material 或动态租约细节。provider 控制面访问与业务数据面出口在本服务内分离建模。

#### 入口

- **服务入口**: `cmd/proxy-runtime`
- **契约真源**: `proto/byte/v/forge/contracts/proxyruntime/v1/`
- **控制面实现**: `internal/app/`
- **Mihomo 数据面适配**: `internal/dataplane/`、`internal/sourceplane/`
- **Dashboard fork**: `metacubexd-fork/`

#### 常用检查

```sh
sh scripts/generate-proto.sh
sh scripts/generate-web-proto.sh
gofmt -w ./cmd ./internal
git diff --check
```

---

<a id="9-common-lib"></a>
### 9. common-lib

**仓库地址**: https://github.com/byte-v-forge/common-lib

#### 核心能力

`common-lib` 是 byte-v-forge 的跨仓公共能力仓，沉淀稳定契约、基础设施 helper 和共享前端基础组件。

- **公共契约**: 提供跨服务公开 proto 契约与 Go/TypeScript 生成物，作为平台公共模型和 gRPC service 的真源
- **通用库**: 提供无业务语义的通用库：HTTP/gRPC client、Redis、事件总线、outbox、分页、时间、随机、脱敏、JSON、proto JSON 等基础能力
- **共享 UI**: 提供共享 React/shadcn dashboard uikit 与通用数据驱动组件，支撑业务模块轻量装配页面
- **边界检查**: 提供契约边界、事件 catalog 和破坏性变更检查脚本，辅助多仓协同演进

#### 边界

本仓只放跨仓稳定能力，不承载 GPT、Mailbox、SMS、Proxy、Browser Automation 等业务流程、provider 分支、页面或私有状态机。业务仓通过发布包、proto/gRPC、HTTP 或事件边界消费公共能力。

#### 入口

- **公共契约**: `proto/byte/v/forge/contracts/`
- **Go 生成物**: `gen/go/byte/v/forge/contracts/`
- **共享前端包**: `ui/`
- **分层说明**: `docs/layers.md`

#### 常用检查

```sh
sh scripts/generate-proto.sh
sh scripts/generate-web-proto.sh
sh scripts/check-boundaries.sh
git diff --check
```

---

<a id="10-gpt-private"></a>
### 10. gpt-private

**仓库地址**: https://github.com/byte-v-forge/gpt-private

#### 核心能力

本仓承载 GPT 私有 provider、私有动作元数据、私有 workflow，以及 GPT checkout/Stripe/Midtrans `snap_token` 准备 sidecar 源码。

#### 目录结构

- **`plugins/`**: 通过 `gpt/pkg/gptplugin` 注册私有 action/config/workflow 元数据
- **`proto/`**: 本仓私有 action 元数据的 proto 真源
- **`gopay/`**: GPT checkout sidecar 源码、协议 client 与准备逻辑；服务契约来自 `gpt/proto/payment.proto`
- **`gopay-sidecar/`**: GoPay checkout sidecar 本地/镜像内启动脚本
- **`workflows/`**: 私有 n8n workflow JSON/catalog
- **`webui/`**: 私有 dashboard 扩展源码与 proto 生成脚本

#### 边界

- 本仓不再提供 `gpt-service` 镜像 overlay、不嵌入 `gpt/orchestrator`，也不承载 GoPay App/payment runtime 迁移
- GoPay checkout sidecar 只负责 GPT checkout/Stripe/Midtrans `snap_token` 准备；GoPay App 与 payment runtime 归属 `gopay-app`
- 私有 action/config 通过 `gpt/pkg/gptplugin` 注册，不 import `gpt/orchestrator/internal/...`
- 私有 workflow 通过公开 GPT/gopay-app HTTP 或 gRPC 边界集成

#### Proto 生成

GoPay checkout sidecar proto 只在本仓生成：

```sh
cd gopay
./scripts/generate-proto.sh
```

WebUI 扩展 proto 类型通过 `webui/scripts/generate-proto.sh` 从 `gpt/proto`、`gopay-app/proto`、`common-lib/proto` 与本仓 `proto/` 生成。

---

<a id="11-gopay-app"></a>
### 11. gopay-app

**仓库地址**: https://github.com/byte-v-forge/gopay-app

#### 核心能力

`gopay-app` 是 GoPay App 账号与支付运行时服务，负责多用户状态、设备指纹、账号动作、OTP 接入和 GoPay payment runtime。

- **账号管理**: 管理 GoPay App 账号、设备指纹、代理会话、token 生命周期和多用户运行态
- **账号动作**: 支持登录、注册、改绑手机号、PIN、注销、余额检查和账号状态查询
- **OTP 集成**: 接收 WhatsApp/SMS OTP webhook，并把验证码投递到等待中的业务流程
- **支付运行时**: 承载 Midtrans + GoPay linking/payment runtime；GPT 侧只传入已准备好的 checkout 参数
- **API 提供**: 提供 gRPC、Dashboard HTTP API 和 GoPay 管理前端模块

#### 使用方式

业务服务通过 proto/gRPC、HTTP webhook 或部署配置集成 GoPay 能力，不直接读写本服务状态存储。短期运行态进入 Redis TTL，长期事实由服务自有存储维护。

#### 入口

- **服务入口**: `cmd/gopay-app-server`
- **契约真源**: `proto/gopay_app.proto`
- **Dashboard API**: `/api/gopay/*`
- **前端模块**: `webui/`
- **工作流素材**: `workflows/`

#### 常用检查

```sh
./scripts/generate-proto.sh
git diff --check
```

---

## 🏗️ 系统架构特点

### 1. 微服务架构
各服务独立部署，通过 gRPC、HTTP 和事件驱动进行通信，实现高度解耦。

### 2. 统一前端
WebUI shell 集成各业务模块的远程前端，通过 service catalog 声明式装载，实现统一的用户体验。

### 3. 声明式部署
通过 Helm chart 和 Docker Compose 声明式管理，支持多环境部署和版本管理。

### 4. 契约驱动
Proto 文件作为 API 真源，自动生成 Go/TypeScript 代码，确保接口一致性和类型安全。

### 5. 插件系统
通过 SPI 支持私有扩展（如 gpt-private），允许业务定制而不侵入核心实现。

### 6. 分层清晰
业务逻辑、基础设施、公共组件严格分离，各仓库职责明确，便于维护和扩展。

---

## 📝 总结

Byte-V-Forge 是一个**高度模块化、可扩展**的企业级自动化平台，专注于：

- **GPT 账号管理与自动化**
- **多渠道通信集成**（SMS、邮箱）
- **浏览器自动化流程**
- **工作流编排与执行**
- **代理网络管理**
- **支付集成**（GoPay/Stripe/Midtrans）

平台采用现代化的微服务架构，具有清晰的边界和良好的扩展性，适用于需要复杂自动化流程的业务场景。

---

**报告生成时间**: 2026-06-14 14:30:00
