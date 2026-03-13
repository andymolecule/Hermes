const workerName = process.env.AGORA_WORKER_PM2_NAME || "agora-worker";

module.exports = {
  apps: [
    {
      name: "agora-api",
      cwd: process.cwd(),
      script: "pnpm",
      args: "--filter @agora/api start",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "512M",
      time: true,
    },
    {
      name: "agora-indexer",
      cwd: process.cwd(),
      script: "pnpm",
      args: "--filter @agora/chain indexer",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "256M",
      time: true,
    },
    {
      name: workerName,
      cwd: process.cwd(),
      script: "bash",
      args: "scripts/ops/start-worker.sh",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      exp_backoff_restart_delay: 3000,
      max_memory_restart: "512M",
      time: true,
    },
    {
      name: "agora-mcp",
      cwd: process.cwd(),
      script: "pnpm",
      args: "--filter @agora/mcp-server start",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "256M",
      time: true,
    },
  ],
};
