module.exports = {
  apps: [
    {
      name: "hermes-api",
      cwd: process.cwd(),
      script: "node",
      args: "apps/api/dist/index.js",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
    {
      name: "hermes-indexer",
      cwd: process.cwd(),
      script: "node",
      args: "packages/chain/dist/indexer.js",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
  ],
};
