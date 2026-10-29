const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();

module.exports = {
  apps: [
    {
      name: 'cloudcoder',
      script: 'node',
      args: 'server/dist/index.js',
      cwd: path.join(HOME, 'Projects', 'CloudCoder'),
      restart_delay: 2000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        CLOUDCODER_PORT: '4060',
        // Resolved automatically by server/src/config.ts when unset:
        // ~/.local/bin/claude, /opt/homebrew/bin/claude, /usr/local/bin/claude.
        CLOUDCODER_PROJECTS: path.join(HOME, 'Projects'),
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
