module.exports = {
  apps: [{
    name: 'cf-bypass',
    script: 'server.js',
    max_memory_restart: '1500M',
    autorestart: true,
  }],
};
