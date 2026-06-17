module.exports = {
  apps: [
    {
      name: 'cloudcoder',
      script: 'node',
      args: 'server/dist/index.js',
      cwd: 'C:/Users/devserver/Projects/CloudCoder',
      restart_delay: 2000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        CLOUDCODER_PORT: '4060',
        CLOUDCODER_CLAUDE: 'C:/Users/devserver/.local/bin/claude.exe',
        CLOUDCODER_PROJECTS: 'C:/Users/devserver/Projects',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
