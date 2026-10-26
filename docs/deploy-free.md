# 零成本部署：Vercel + Supabase + Cloudflare

本文从「什么都没有」开始，走完一遍可以公网访问的完整部署。整条链路月费为 0，唯一的固定支出是域名（可用免费二级域名代替）。

文中域名统一写作 `home.example.org`，请替换成你自己的域名。

```
用户 ──HTTPS──> Cloudflare（仅权威 DNS，不开代理）
                     │
                     ▼
                Vercel（Next.js 函数，单区域）
                     │
                     ├──> Supabase Postgres（连接池）
                     └──> Supabase Storage（私有 bucket）

Supabase pg_cron ──每分钟──> Vercel /api/cron/reminders
Vercel Cron ────每天一次──> Vercel /api/cron/roll
```

---

## 0. 准备账号

| 用途 | 网站 | 说明 |
| --- | --- | --- |
| 代码托管 | github.com | 免费仓库，Vercel 从这里拉代码 |
| 应用托管 | vercel.com | Hobby 计划，免费用，限非商业个人用途 |
| 数据库 + 文件存储 | supabase.com | Free 计划，建一个项目 |
| DNS | cloudflare.com | Free 计划，只做权威解析 |
| 域名 | digitalplat.org | 免费二级域名（也可用自己买的） |

可选：`platform.deepseek.com`（AI）、`q.qq.com`（QQ 机器人）。

> DigitalPlat 只负责注册和委派，**没有 DNS 编辑器**。所以必须把 NS 指到 Cloudflare。

---

## 1. 创建 Supabase 项目

1. 登录 Supabase → **New project**。
2. **Region 选 Tokyo (`ap-northeast-1`)**。这是对大陆用户最均衡的选择；备选 Singapore。
3. 设置数据库密码（自己保存好，后面连接串要用）。
4. 项目建好后，打开 **Connect** 面板，记下两串：

| 用途 | 面板上的名字 | 端口 | 环境变量 |
| --- | --- | --- | --- |
| 运行时查询 | Transaction pooler | 6543 | `DATABASE_URL` |
| 迁移 / 种子 | Session pooler | 5432 | `DATABASE_URL_UNPOOLED` |

**不要用 Direct connection。** 新项目的直连只有 AAAA 记录（IPv6），Vercel 函数没有 IPv6 出口，连不上。代码里也有同样的提示，见 `src/lib/db-url.ts`。

同时记下 **Project Settings → API** 里的：

- `Project URL`（形如 `https://<ref>.supabase.co`）→ `SUPABASE_URL`
- `Secret key`（`sb_secret_` 开头）→ `SUPABASE_SECRET_KEY`

Secret key 是服务端凭据，**永远不要加 `NEXT_PUBLIC_` 前缀**。

还需要下载 **SSL CA 证书**（这个很容易漏，漏了会导致「迁移能过、应用连不上」）：

- 面板 **Database → Connect → Connection string / SSL** 区域，下载根证书（文件名类似 `prod-ca-2021.crt`）。
- 本地：把 PEM 存到项目根目录 `prod-ca-2021.crt`（`.gitignore` 已排除 `*.crt`，不会进 git）。
- Vercel：由于构建只拉 git 文件，根目录证书不会上去，必须把证书 **PEM 内容整段** 填进环境变量 `PG_CA_CERT`。

为什么必须：池化端点（pooler）的证书链根是 Supabase 私有 CA（`Supabase Root 2021 CA`），不在 Node 的 Mozilla 信任库。Node 客户端不配 CA 就会在 TLS 校验时报 `P1011 / self-signed certificate in certificate chain`。Prisma 迁移 CLI（Rust/libpq）不校验证书所以能跑，容易麻痹你。代码见 `src/lib/db-url.ts` 的 `sslConfig()`。

---

## 2. 本地初始化数据库

需要 Node.js 24+ 和 pnpm 10。

```bash
git clone <你的仓库地址>
cd OpenButler
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

### 2.1 生成密钥

三种用途各生成一次，**不要复用**：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

需要生成：

- `AUTH_SECRET`
- `CRON_SECRET`
- `REMINDER_CRON_SECRET`

### 2.2 填写 `.env.local`

```dotenv
DATABASE_URL="<Transaction pooler 连接串>"
DATABASE_URL_UNPOOLED="<Session pooler 连接串>"

AUTH_SECRET="<随机串>"
APP_URL="https://home.example.org"
APP_TIMEZONE="Asia/Shanghai"

SEED_USERNAME="admin"
SEED_DISPLAY_NAME="管理员"
SEED_PASSWORD="<至少 12 位，无默认值>"

CRON_SECRET="<随机串>"
REMINDER_CRON_SECRET="<另一串随机串>"

VERCEL_FUNCTION_REGION="hkg1"

AI_ENABLED="false"
```

### 2.3 建表并初始化管理员

```bash
pnpm db:setup
```

这条命令等于 `prisma migrate deploy` + `prisma/seed.ts`，会创建表、索引、约束，开启全部应用表的 RLS，撤销 `PUBLIC` / `anon` / `authenticated` 的访问权限，然后创建第一个管理员账号。

再次运行不会覆盖已有账号的密码和权限。

> 迁移必须走 session pooler（5432）。Supavisor 的事务模式不支持迁移所需的会话级操作。

---

## 3. 推送到自己的 GitHub

```bash
git add -A
git commit -m "deploy"
git push
```

提交前确认 `.env.local` 没有被跟踪。仓库自带检查：

```bash
pnpm check:release
```

---

## 4. 创建 Vercel 项目

1. vercel.com → **Add New → Project** → 导入你的仓库。
2. Framework 会自动识别为 Next.js，保持默认构建命令即可。
3. **Settings → General → Node.js Version** 确认是 24.x。
4. **Settings → Functions → Function Regions** 选 **Hong Kong (`hkg1`)**。

   Hobby 计划只能选**一个**区域。`vercel.ts` 里读取 `VERCEL_FUNCTION_REGION`，填 `hkg1` 即可；想对比东京就改成 `hnd1` 重新部署。

5. 打开 **Settings → Environment Variables**，按下面的表填。全部填在 **Production** 环境。

| 变量 | 值 | 必填 |
| --- | --- | --- |
| `DATABASE_URL` | Supabase Transaction pooler | ✅ |
| `DATABASE_URL_UNPOOLED` | Supabase Session pooler | ✅ |
| `PG_CA_CERT` | 上一节下载的根证书 **PEM 全文** | ✅ |
| `AUTH_SECRET` | 自己生成 | ✅ |
| `APP_URL` | `https://home.example.org` | ✅ |
| `APP_TIMEZONE` | `Asia/Shanghai` | ✅ |
| `CRON_SECRET` | 自己生成 | ✅ |
| `VERCEL_FUNCTION_REGION` | `hkg1` 或 `hnd1` | ✅ |
| `SEED_USERNAME` / `SEED_PASSWORD` | 首次管理员 | 仅本地需要 |
| `SUPABASE_URL` | Supabase Project URL | 可选 |
| `SUPABASE_SECRET_KEY` | Supabase Secret key | 可选 |
| `DEEPSEEK_API_KEY` | DeepSeek 控制台 | 可选 |
| `AI_ENABLED` | `true` / `false` | 可选 |
| `WEB_PUSH_VAPID_*` | 见 §8.2 | 可选 |
| `REMINDER_CRON_SECRET` | 自己生成 | 见 §7 |

> ⚠️ **不要往 `vercel.ts` 的 `crons` 里加高频任务。** Hobby 计划只允许每天执行一次的 cron，`*/5 * * * *` 这类表达式会在构建阶段直接失败。每分钟提醒走 Supabase `pg_cron`，见第 7 步。

6. 点 **Deploy**。

构建过程不连接数据库，也不会跑迁移——这是设计如此，别指望部署时自动建表。

---

## 5. 用 Cloudflare 接管 DNS

### 5.1 添加站点

Cloudflare → **Add a site** → 输入完整域名 `home.example.org` → 选 **Free**。

Cloudflare 会分配两条 NS，形如：

```
ada.ns.cloudflare.com
bob.ns.cloudflare.com
```

复制的是**主机名**，不是 IP。

### 5.2 在域名服务商处改 NS

DigitalPlat Dashboard → 你的域名 → Nameservers → 填入这两条 → 保存。

等待 Cloudflare 面板从 *Pending Nameserver Update* 变成 **Active**，通常几分钟到几小时。

验证：

```bash
dig +short NS home.example.org
```

### 5.3 在 Vercel 添加域名

Vercel 项目 → **Settings → Domains → Add** → `home.example.org`。

Vercel 会显示需要配置的记录，通常是：

- 三级域名 / 子域名 → 一条 **CNAME**，target 形如 `<hash>.vercel-dns-0xx.com`
- 顶点域名 → **A** 记录 `76.76.21.21`

**以页面显示的值准。** 每个项目的 CNAME target 是唯一的，不要照抄别人的。

### 5.4 在 Cloudflare 添加记录

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| CNAME | `@` | Vercel 显示的 target | **DNS only（灰云）** |
| CNAME | `www` | 同上 | DNS only |

Cloudflare 在 zone apex 支持 CNAME flattening，`@` 写 CNAME 是合法的。

**必须关掉橙色云。** 开着橙云等于 Cloudflare 再代理一层 Vercel：两次 TLS、两条链路，通常更慢，还容易出证书和缓存问题。Vercel 官方文档也明确不建议在它前面放代理。

---

## 6. 验证首次上线

```bash
# 解析是否生效
dig +short home.example.org

# 看请求落在哪个 POP 和哪个函数区域
curl -sI https://home.example.org | grep -i x-vercel-id

# 分段耗时
curl -w "\nDNS:%{time_namelookup} TCP:%{time_connect} TLS:%{time_appconnect} TTFB:%{time_starttransfer}\n" \
  -o /dev/null -s https://home.example.org
```

`x-vercel-id` 形如 `hkg1::abcde`，第一段是 POP，第二段是函数区域。如果第二段是 `iad1`，说明区域没生效——检查环境变量并重新部署。

然后在浏览器打开域名，用 `SEED_USERNAME` / `SEED_PASSWORD` 登录。首次进去在「我的 → 角色管理 / 账号管理」里创建家庭成员。

> 生产环境 Session Cookie 带 `secure` 标志。如果 `APP_URL` 还是 `http://`，会出现「登录成功但立刻跳回登录页」。

---

## 7. 启用每分钟提醒

Vercel Hobby 的 cron 只能每天跑一次，所以 `reminderAt` 这种具体时刻提醒交给 Supabase 的 `pg_cron` + `pg_net`。仓库自带脚本，不需要额外服务。

前提：`.env.local` 里的 `APP_URL` 已经是真实的 **HTTPS** 地址，并且 `REMINDER_CRON_SECRET` 已填。

```bash
pnpm exec tsx scripts/setup-reminder-cron.mts
```

脚本会：

1. `CREATE EXTENSION pg_cron` / `pg_net`
2. 把密钥写进 Supabase Vault（不写进 cron 命令）
3. 注册 `* * * * *` 任务，每分钟检查一次
4. 只有真的存在到期提醒时才发起 HTTP 请求（`WHERE EXISTS`），不会白烧额度

验证——在 Supabase SQL Editor 执行：

```sql
select jobid, schedule, command from cron.job;
select * from cron.job_run_details order by start_time desc limit 5;
```

同时确认 `REMINDER_CRON_SECRET` 与 Vercel 里的值**完全一致**，否则接口返回 401。

> 只启用这一套调度。不要再给 Vercel 加高频 cron，也不要同时跑别的调度器。

---

## 8. 可选功能

### 8.1 产品资料库

在 Vercel 补上 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY` 后重新部署。首次上传会自动创建私有 `product-library` bucket，单文件上限 50 MB。

未配置时上传接口返回 503，其余功能不受影响。

### 8.2 Web Push 通知

```bash
pnpm exec web-push generate-vapid-keys --json
```

填入 `WEB_PUSH_VAPID_PUBLIC_KEY`、`WEB_PUSH_VAPID_PRIVATE_KEY`，`WEB_PUSH_SUBJECT` 填站点地址或 `mailto:` 地址。

iPhone 需要先用 Safari「添加到主屏幕」，再从主屏图标打开并授权通知。

### 8.3 AI 管家

```dotenv
AI_ENABLED="true"
DEEPSEEK_API_KEY="<自己的密钥>"
AI_MODEL="deepseek-flash"
AI_TIMEOUT_MS="8000"
```

服务端直连 DeepSeek。不配置、超时或请求失败时会退回本地解析和可编辑表单，AI 只产生提案，写入仍需确认。

### 8.4 QQ 机器人

QQ 开放平台创建机器人 → 拿到 `AppID` / `AppSecret` → 回调填 `https://home.example.org/api/qq/webhook`。

登录网站「管家 → 连接 QQ」生成短码，在目标会话里 `@机器人 /bind 短码`。短码 10 分钟有效且单次使用。

### 8.5 Siri / Apple Watch

「管家」页生成个人快捷指令密钥（服务端只存哈希）。iPhone 快捷指令：听写文本 → 获取 URL 内容 → POST `https://home.example.org/api/shortcuts/chat`，请求头 `Authorization: Bearer <个人密钥>`，JSON 正文 `{"text": "..."}`。

---

## 9. 国内访问调优

Vercel 官方明确说明它在中国大陆**没有服务器和 CDN 节点**，请求由附近区域处理，延迟必然更高；网络管控也可能临时限制境外域名。它给的建议只有：用自定义域名（比 `*.vercel.app` 更不容易被干扰）、自托管静态资源、或上静态镜像。

在这个前提下，免费能做的只有两件事：

1. **区域对齐。** 分别用 `hkg1` 和 `hnd1` 部署一次，用第 6 步的命令对比 TTFB 中位数，选更低的。函数在境外、数据库在东京时，跨区查询会多约 30 ms/次，一页多次查询后可能反超，所以必须实测。
2. **不要开橙云。** 两层 CDN 叠加通常更慢。

`home.example.org` 这类免费二级域名**无法 ICP 备案**：后缀不在工信部批复名单、也不能在境内完成实名。因此国内 CDN 的大陆节点和境内服务器都不可用，不要在这上面花时间。

需要进一步提速时，现实的选择是：

- 香港/东京的小机器做反向代理（免备案，但每月有成本）
- 或整体搬到境外 VPS 自托管（省掉 Vercel 这一跳）

---

## 10. 日常运维

### 备份

Free 计划不含 PITR，自己定期导出：

```bash
pg_dump "$DATABASE_URL_UNPOOLED" -Fc -f openbutler-$(date +%F).dump
```

没有本地 `pg_dump` 时可以用容器：

```bash
docker run --rm -e PGURL -v "$PWD:/out" postgres:18-alpine \
  sh -c 'pg_dump "$PGURL" -Fc -f /out/openbutler.dump'
```

### 免费额度的硬限制

| 资源 | 额度 | 触发后的表现 |
| --- | --- | --- |
| Supabase 数据库 | 500 MB | 写入失败 |
| Supabase Storage | 1 GB | 上传失败 |
| Supabase 出站 | 5 GB/月 | 资源读取失败 |
| Supabase 活跃项目 | 2 个 | 无法新建第三个 |
| Supabase 闲置暂停 | 7 天无活动 | 站点报数据库错误，需去控制台恢复 |

> 免费额度都按「月」算，注意 Supabase 的**闲置暂停**：Free 项目连续 7 天没有请求就会暂停，暂停后访问会报数据库连接错误，去控制台点 Resume 即可恢复。
| Vercel 函数调用 | 100 万次/月 | 超出后等待 30 天 |
| Vercel 数据传输 | 100 GB/月 | 同上 |
| Vercel 活跃 CPU | 4 CPU·小时/月 | 同上（家庭规模基本用不到） |

### 域名续期

免费域名通常一年一续，到期前有窗口期。**不要忘了**——`APP_URL`、Web Push 的 subject、QQ 回调全绑在它上面，过期会同时失效。

### 密钥轮换

`AUTH_SECRET` 轮换会让所有会话失效（家人需重新登录），这是正常行为。`REMINDER_CRON_SECRET` 轮换后要重跑 §7 的脚本，并同步更新 Vercel 环境变量。

---

## 附录 A：故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 登录成功但立刻跳回登录页 | `APP_URL` 不是 HTTPS；或 `AUTH_SECRET` 在多次部署间变化 | 改 `APP_URL` 后重新部署 |
| 500，日志报连不上数据库 | 用了 Direct connection（IPv6）；或 Supabase 项目已暂停 | 换成 session pooler；去 Supabase 恢复项目 |
| `pnpm db:setup` 报迁移失败 | 用了事务模式（6543）连接串 | 迁移必须用 `DATABASE_URL_UNPOOLED` |
| 迁移成功但 seed 报「初始化失败」/应用 `P1011 self-signed certificate` | 没配 CA：Supabase 私有根不在 Node 信任库 | 本地放 `prod-ca-2021.crt` 到项目根；Vercel 设 `PG_CA_CERT` 为 PEM 全文 |
| 上传文件 503 | 未配置 `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | 补齐后重新部署 |
| 定时提醒不触发 | `REMINDER_CRON_SECRET` 不一致；`pg_cron` 未启用；`APP_URL` 不是 HTTPS | 查 `cron.job_run_details`，核对密钥 |
| 部署失败：*Hobby accounts are limited to daily cron jobs* | `vercel.ts` 里加了高频 cron | 删掉，改用 Supabase `pg_cron` |
| `x-vercel-id` 第二段还是 `iad1` | 区域变量没生效或没重新部署 | 检查 `VERCEL_FUNCTION_REGION` 并 Redeploy |
| 域名在 Vercel 显示 *Invalid Configuration* | Cloudflare 记录没加、加错层级，或存在冲突的 A/AAAA | 对照 Vercel Domains 页面逐条核对 |
| Cloudflare 一直 *Pending Nameserver Update* | NS 填成了 IP，或填在了错误的域名下 | 重新复制主机名 |
| Cloudflare 拒绝添加这个子域名 | 部分情况下子域名独立成 zone 需要更高计划 | 改用 Vercel 自己的 NS（`ns1/ns2.vercel-dns.com`）或 DNSPod |
| 证书签发失败 | 橙云开着，或 DNS 尚未生效 | 关橙云，等解析生效后重新验证 |

---

## 附录 B：最小可用清单

只要「记事 + 待办 + 提醒 + 公网访问」，需要准备的值只有这些：

```
Supabase：DATABASE_URL、DATABASE_URL_UNPOOLED、PG_CA_CERT、SUPABASE_URL、SUPABASE_SECRET_KEY
自己生成：AUTH_SECRET、CRON_SECRET、REMINDER_CRON_SECRET、SEED_PASSWORD
域名：APP_URL
```

AI、QQ、推送、资料库都是后加的，不影响主线跑通。