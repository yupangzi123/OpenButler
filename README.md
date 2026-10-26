# OpenButler · Open家庭管家

**你的开源 AI 家庭管家，让生活琐事有人记、有人提醒。**

可自行部署的家庭记事、待办、周期提醒和 AI 管家。支持网页 / PWA、QQ 机器人、Siri / Apple Watch，以及私有产品说明书资料库。

**这是实现方案与源码，不是公共在线服务。** 使用者需自行创建数据库、存储和机器人，填写自己的密钥、域名与账号。仓库只包含建表结构，不包含家庭记录、数据库备份、上传文件、登录凭据或作者的线上资源配置。

## 产品预览

以下为真实应用界面，使用本地隔离环境中的虚构演示数据。AI 产品资料卡为演示状态；不包含真实家庭记录、账号、密钥或上传资料，安装后也不会自动生成这些数据。

### 一眼看清今天的安排

![OpenButler 首页：今日待办、后续安排与家庭成员](docs/images/dashboard.png)

### 把说明书交给管家，核对后归档

![OpenButler 管家对话：PDF 附件与可确认的产品资料卡](docs/images/ai-product-import.png)

### 说明书与使用笔记，集中收藏

![OpenButler 产品资料库：按产品分类和关键词查找说明书与笔记](docs/images/product-library.png)

<details>
<summary>查看手机待办界面</summary>
<br />
<img src="docs/images/mobile-tasks.png" alt="OpenButler 手机端：待办分组、成员筛选和底部导航" width="320" />
</details>

## 功能

- 家庭角色、生活记录、待办、周期事项、日历和具体时间提醒。
- AI 将自然语言整理为提案，确认后再保存；未接入 AI 时可使用表单和本地解析。
- QQ 官方机器人私聊 / 群聊绑定、群提醒；Siri 和 Apple Watch 通过快捷指令输入。
- iOS / Android / 桌面 PWA 安装和 Web Push 通知；不包含原生系统小组件。
- 私有产品资料库：PDF / 图片 / TXT、全文关键词搜索、PDF 阅读和页码笔记。
- 在管家聊天中上传 PDF，AI 识别产品信息，确认入库；同品牌同型号可归入已有档案。扫描版识别前 3 页图像，不等于整本 OCR。

技术栈：Next.js 16、React 19、TypeScript、Tailwind CSS 4、Prisma 7、PostgreSQL。文件资料库使用 Supabase 私有 Storage；AI 默认直连 DeepSeek。

## 1. 本地开始

需要 Node.js 24+、pnpm 10，以及一套**自己管理的空 PostgreSQL 数据库**。首次安装：

```bash
git clone https://github.com/askxiaozhang/OpenButler.git
cd OpenButler
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

编辑 `.env.local`，至少配置：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 自己的 PostgreSQL 运行时连接串 |
| `DATABASE_URL_UNPOOLED` | 迁移用直连 / session pooler；普通 PostgreSQL 可不填，复用上一项 |
| `AUTH_SECRET` | 自己生成的随机会话签名密钥，至少 32 字符 |
| `SEED_USERNAME` / `SEED_PASSWORD` | 首次管理员账号；密码至少 12 字符，无默认密码 |
| `APP_URL` | 本地 `http://localhost:3000`，部署后换为自己的 HTTPS 站点 |
| `APP_TIMEZONE` | 家庭时区，默认 `Asia/Shanghai` |

生成随机密钥（每种用途分别生成，不要复用）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

创建结构、初始化自己的管理员、启动：

```bash
pnpm db:setup
pnpm dev
```

打开 `http://localhost:3000`，用自己填写的管理员账号登录。在“我的 → 角色管理 / 账号管理”创建家庭成员。初始化不预填家人、宠物、生活记录或绑定；再次运行不会覆盖已有账号的密码和权限。

### 仅使用本地数据库

例如用 Docker 创建全新的测试库。先自行设置 `POSTGRES_PASSWORD`，不要使用现有业务库：

```bash
docker run -d --name family-note-postgres \
  -e POSTGRES_DB=family_note -e POSTGRES_USER=family_note \
  -e POSTGRES_PASSWORD -p 127.0.0.1:5432:5432 \
  -v family-note-pgdata:/var/lib/postgresql postgres:18-alpine
```

把对应的本地连接串填入 `DATABASE_URL`；密码中有特殊字符需 URL 编码。没有 Supabase、QQ 或 AI 的密钥，也可以运行核心记事和待办功能。

## 2. 自己配置 Supabase

1. 新建自己的 Supabase 项目，复制 **Connect** 面板提供的连接串，密码填写自己的数据库密码。
2. `DATABASE_URL` 使用适合运行环境的连接方式；Serverless 通常使用 transaction pooler。`DATABASE_URL_UNPOOLED` 使用 session pooler / 可达的直连，不能用 transaction pooler 跑迁移。以自己的项目面板给出的主机、用户名和端口为准。
3. 远程 PostgreSQL 默认校验证书。若供应商需要专用 CA，从自己的项目下载，填写 `PG_CA_CERT` 的 PEM 内容，或保存为根目录 `prod-ca-2021.crt`。证书校验失败应修正 CA；`PG_TLS_REJECT_UNAUTHORIZED=false` 仅作为明确选择的临时排障选项。
4. 运行 `pnpm db:setup`。初始迁移仅创建表、索引和约束，开启所有应用表的 RLS，并撤销 `PUBLIC` 及存在时的 `anon` / `authenticated` 访问权限。应用使用服务端 PostgreSQL 账号和自己的登录会话鉴权，不使用 Supabase Auth；数据库连接角色需拥有应用表的服务端读写权限。
5. 可选资料库：填写自己的 `SUPABASE_URL` 和服务端 `SUPABASE_SECRET_KEY`（兼容旧 `SUPABASE_SERVICE_ROLE_KEY`）。首次上传自动创建私有 `product-library` bucket，文件限制 50 MB。

不要把 Secret key 加上 `NEXT_PUBLIC_` 前缀。文件通过鉴权后签发的短时 URL 上传 / 阅读；未确认入库的聊天附件只对上传账号开放，入库后家庭账号共享。PDF 生成的页面预览在启用识别时会交给所配置的 AI 服务处理。

`prisma/migrations/` 是从空库开始的建表结构，**不是任何现有数据库的导出**。需要迁移已有部署时先自行备份并核对迁移基线，不要直接对其他业务库执行初始化。

## 3. 可选集成

### DeepSeek

```dotenv
DEEPSEEK_API_KEY="填写自己的服务端密钥"
AI_MODEL="deepseek-flash"
AI_ENABLED="true"
```

服务端直连 `https://api.deepseek.com`，不需要 AI Gateway。未配置、请求失败或超时会退回本地解析 / 可编辑表单。生活事项和产品建档均需确认才写库。未配置模型时，聊天会提示回退方式；请使用首页的本地解析 / 预填表单或手动表单创建事项。

### QQ 官方机器人

自行在 QQ 开放平台创建机器人，配置 `QQ_BOT_APP_ID`、`QQ_BOT_APP_SECRET`、`QQ_BOT_SANDBOX`，回调为 `自己的 APP_URL/api/qq/webhook`。正式机器人保持 sandbox 为 `false`。

登录网站“管家 → 连接 QQ”，生成短码，在目标私聊或群内 `@机器人 /bind 短码`。短码 10 分钟有效且单次使用；每位家人使用自己的网页账号绑定。群主动提醒还需要平台允许主动消息，并由群管理员开启对应权限；网页中发送测试成功后启用。角色关联账号、账号在目标群绑定后，可用于提醒执行人的提及，效果受平台能力与权限限制。

### Siri 与 Apple Watch

在管家页生成个人快捷指令密钥；iPhone 快捷指令“听写文本 → 获取 URL 内容”，POST 到页面显示的接口，请求头 `Authorization: Bearer 个人密钥`，JSON 正文包含 `text`。从响应取出 `reply` 朗读；在快捷指令详情打开“在 Apple Watch 上显示”。密钥可随时轮换 / 停用，服务端只保存哈希。

### PWA 与 Web Push

```bash
pnpm exec web-push generate-vapid-keys --json
```

填写自己的 `WEB_PUSH_VAPID_PUBLIC_KEY`、`WEB_PUSH_VAPID_PRIVATE_KEY` 和 `WEB_PUSH_SUBJECT`（自己的 HTTPS 站点或 `mailto:` 联系地址）。iPhone 使用 Safari 添加到主屏幕后开启通知；Android / 桌面兼容浏览器可安装 PWA。通知展示受设备系统、权限和网络影响。

### 定时调度

- 每日汇总：生成 `CRON_SECRET`，部署后由 `vercel.ts` 的日程调用 `/api/cron/roll`。密钥未配置时接口拒绝请求。
- 具体时刻：另生成 `REMINDER_CRON_SECRET`，配置自己的 HTTPS `APP_URL`，然后运行 `pnpm exec tsx scripts/setup-reminder-cron.mts`。该可选脚本需要自己的 Supabase 数据库已提供 Vault，以及创建 `pg_cron`、`pg_net` 扩展的权限；它把密钥存入 Vault，并建立每分钟检查任务。
- 非 Supabase 环境可自行用调度器 POST `/api/cron/reminders`，发送 `Authorization: Bearer 自己的REMINDER_CRON_SECRET`。不要把密钥放进 URL。
- **只选一套调度方案**，确认使用自己的域名和数据库；本仓库没有预设的作者调度器或线上绑定。

## 4. 部署

不想花月费的话，[零成本部署指南](docs/deploy-free.md) 走的是 Vercel + Supabase + Cloudflare 的免费额度组合，包含域名解析、分钟级提醒和国内访问调优。

### Vercel

1. Fork / 导入自己的 GitHub 仓库，创建自己的 Vercel 项目。
2. 在项目环境变量中填入自己的配置。生产和预览使用不同数据库、密钥和存储项目；不要把生产凭据提供给不可信的预览构建。
3. 按数据库位置设置 `VERCEL_FUNCTION_REGION`（示例默认 `sin1`，可改成自己的区域）。
4. 在自己的环境执行 `pnpm db:setup` 初始化空库；Vercel 构建只生成代码，不自动连接数据库、灌数据或迁移。
5. 部署成功后把 `APP_URL` 改为自己的正式 HTTPS 域名，重新部署；再接通所需机器人、通知和调度器。

### 自己的 Node.js 服务器

```bash
pnpm build
pnpm start
```

通过自己的反向代理提供 HTTPS，设置同样的环境变量并配置自己的调度器。代码不包含 DNS 记录或固定线上域名；网站和数据库的区域、网络可达性由部署者自行选择和验证。

## 开发与发布检查

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm check:release
```

`pnpm check:release` 检查 Git 跟踪文件中的敏感文件类型、凭据格式、个人路径和非示例连接串。CI 另用 Gitleaks 扫描提交历史。不要依赖 `.gitignore` 清除已经提交过的秘密；如果误传，先撤销 / 轮换密钥，再处理历史。

`scripts/verify-*.mts` 为可选浏览器验证工具，部分会创建和清理测试记录。只对自己的独立测试数据库执行；需要 Chromium 的 CDP 调试端口和显式配置的测试账号，不要连接真实家庭数据库。基础自动测试和构建不需要真实服务凭据。

## 数据边界与授权

每套实例对应一个家庭，登录账号共享家庭记录和产品资料；这是家庭内部使用模型，不是多租户 SaaS。产品笔记 / 文件删除按作者 / 管理员控制。部署者自行管理访问权限、备份、数据保留和第三方服务费用。

详见 [安全说明](SECURITY.md) 与 [贡献指南](CONTRIBUTING.md)。源码采用 [MIT License](LICENSE)。用户自行上传的说明书和个人数据不属于本仓库的授权范围。
