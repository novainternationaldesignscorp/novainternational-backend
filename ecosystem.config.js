module.exports = {
  apps: [
    // ======================
    // 🟢 DEVELOPMENT
    // ======================
    {
      name: "nova-backend-dev",
      script: "server.js",
      cwd: "/home/m4x6rl78j7mz/nova_backend",
      watch: true,
      env: {
        NODE_ENV: "development",
        PORT: 5000
      }
    },

    // ======================
    // 🔵 PRODUCTION
    // ======================
    {
      name: "nova-backend",
      script: "server.js",
      cwd: "/home/m4x6rl78j7mz/nova_backend",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 5000
      }
    }
  ]
};