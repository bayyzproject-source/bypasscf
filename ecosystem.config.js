module.exports = {
  apps: [{
    name: 'cf-bypass',
    script: 'start.sh',
    interpreter: 'bash',
    max_memory_restart: '1500M',
    autorestart: true,
  }],
};
