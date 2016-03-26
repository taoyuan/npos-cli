"use strict";

var logu = require('logu');

function createLogger(host, options) {
  if (typeof host === 'object') {
    options = host;
    host = null;
  }
  options = options || {};
  host = options.host = host || options.host || 'npos';
  options.level = options.level || 'info';
  options.transports = [
    new logu.transports.Console({
      sizes: {
        id: 13
      }
    })
  ];

  var logger = new logu.Logger(options);

  logger.on('logged', function (log) {
    if (log.level === 'error' && logger.exitOnError) {
      process.exit(1);
    }
  });

  logger.cli(host, {timestamp: 'short', showLevel: false, showLabel: false});

  return logger;
}

module.exports = exports = createLogger({level: 'debug'});
exports.createLogger = createLogger;
