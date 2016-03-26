'use strict';

var debug = require('debug')('npos:mon');
var path = require('path');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var npos = require('npos');
var humanSize = require('human-size');
var sp = require("serialport");
var SerialPort = sp.SerialPort;
var MutableBuffer = require('mutable-buffer');

mon.describe = ['mon [options]', 'Monitor port data'];

mon.options = {
  port: {
    alias: 'p',
    describe: 'The serial port',
    required: true
  },
  baud: {
    alias: 'b',
    choices: [921600, 230400, 115200, 57600, 38400, 19200, 9600],
    default: 115200,
    required: true,
    describe: 'The baud rate'
  },
  verbose: {
    alias: 'v',
    describe: 'Verbose'
  }
};

function mon(args, options, loader) {
  var logger = loader.logger;

  debug(options);

  var port = new SerialPort(options.port, {
    baudrate: options.baud
  });

  port.on('open', function () {
    logger.info('mon', 'Serial port %s:%d has been opened', options.port, options.baud);
  });

  var receiver = new Receiver(port, options, logger);
  receiver.on('data', function (data) {
    logger.info('mon', 'Received %s data, decoding ...', humanSize(data.length));
    var decoded = data;
    var image = npos.bitimage();
    while (decoded = npos.codecs.raster.decode(decoded)) {
      image.append(decoded);
    }

    var filename = Date.now() + '.png';
    image.toJimp().write(path.join(process.cwd(), filename));
    logger.info('mon', 'Decoded and saved to', filename);
  });
}

function Receiver(port, options, logger) {
  EventEmitter.call(this);

  var timer, mutable = new MutableBuffer(10 * 1024, 10 * 1024);

  function resetTimer(timeout, cb) {
    timer && clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      cb && cb();
    }, timeout);
  }

  var that = this;
  port.on('open', function () {
    port.on('data', function (data) {
      mutable.write(data);

      if (!timer) {
        logger.info('mon', 'Receiving data ...');
      }

      resetTimer(100, function () {
        if (options.verbose) {
          process.stdout.write('\n');
        }
        that.emit('data', mutable.flush());
      });
    });
  });
}

util.inherits(Receiver, EventEmitter);

module.exports = mon;
