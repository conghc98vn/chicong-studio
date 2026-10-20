module.exports = {
  apps: [{
    name: 'chicong-photo',
    script: 'studio/server/start.mjs',
    cwd: '/var/www/chicongphoto',
    node_args: '--env-file-if-exists=.env',
    max_memory_restart: '1500M',
    exp_backoff_restart_delay: 200,
    listen_timeout: 10000,
    // Drain media writers under the maintenance lease before stopping the app.
    // Allow outstanding HTTP responses/cleanup to finish before PM2 sends SIGKILL.
    kill_timeout: 120000,
    env: {
      NODE_ENV: 'production',
      NODE_EXTRA_CA_CERTS: '/var/www/chicongphoto/certs/supabase-root-2021.crt'
    }
  }]
};
