module.exports = {
  apps: [
    {
      name: "nova-backend",
      script: "server.js",
      cwd: "/home/m4x6rl78j7mz/nova_backend",
      env: {
        NODE_ENV: "production",
        RESEND_API_KEY: "re_HZAGhRGo_CXncjksGWTH5ScqT7S4qBSpc",
        RESEND_FROM_EMAIL: "shila@novainternationaldesigns.com",
        ADMIN_EMAIL: "admin@novainternationaldesigns.com"
      }
    }
  ]
};