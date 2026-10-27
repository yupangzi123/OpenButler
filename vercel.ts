import { type VercelConfig } from "@vercel/config/v1";

/**
 * Vercel 项目配置。
 *
 * 用 `vercel.ts` 而不是 `vercel.json` —— 支持 TypeScript、能读环境变量、
 * 能写动态逻辑，且是 Vercel 现在推荐的写法。
 */
export const config: VercelConfig = {
  framework: "nextjs",
  // 与当前 Supabase 数据库同在新加坡；使用固定值确保部署前的配置校验可用。
  regions: ["sin1"],

  crons: [
    {
      path: "/api/cron/roll",
      /**
       * UTC 01:00 = 北京时间上午 9:00。
       *
       * 选这个点是因为：用户早上打开应用时，今天该做的事已经排好了，
       * 不需要先触发一次读取去补齐。而且凌晨跑不影响任何人。
       *
       * 注意这只是**加速器** —— 即使它从不触发，应用也是正确的，
       * 所有读路径都会惰性补齐（见 lib/recurrence/engine.ts）。
       */
      schedule: "0 1 * * *",
    },
  ],
};
