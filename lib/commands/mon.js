'use strict';

var debug = require('debug')('npos:mon');
var _ = require('lodash');
var path = require('path');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var inquirer = require('inquirer');
var npos = require('npos');
var humanSize = require('human-size');
var sp = require("serialport");
var SerialPort = sp.SerialPort;
var MutableBuffer = require('mutable-buffer');
const ignore = require('ignore');

mon.describe = ['mon [options]', 'Monitor port data'];

mon.options = {
  port: {
    alias: 'p',
    type: 'string',
    describe: 'The serial port'
  },
  baud: {
    alias: 'b',
    type: 'number',
    choices: ['921600', '230400', '115200', '57600', '38400', '19200', '9600'],
    describe: 'The baud rate'
  },
  interval: {
    alias: 't',
    type: 'number',
    default: '100',
    describe: 'The interval time (ms) on data within one page data'
  },
  interactive: {
    alias: 'I',
    describe: 'Start with interactive'
  }
};

var DEFAULT_BAUDRATE = 115200;
var PORTS_IGNORES = ['*WirelessiAP', '*Bluetooth-Incoming-Port'];

function mon(__, options, loader) {
  var logger = loader.logger;
  var questions = [];

  if (!options.port) {
    if (options.interactive) {
      questions.push({
        type: 'list',
        name: 'port',
        message: 'What port would you like to connect?',
        choices: function () {
          listSerialPorts(PORTS_IGNORES, this.async());
        }
      });
    } else {
      return logger.error('mon', '--port|-p is required');
    }
  }

  if (!options.baud) {
    if (options.interactive) {
      questions.push({
        type: 'list',
        name: 'baud',
        message: 'Select a baudrate:',
        default: 2,
        choices: mon.options.baud.choices
      });
    } else {
      options.baud = DEFAULT_BAUDRATE;
    }
  }

  if (questions.length > 0) {
    inquirer.prompt(questions, function (answer) {
      _.assign(options, answer);
      execute(options, logger);
    });
  } else {
    execute(options, logger);
  }

}

function execute(options, logger) {
  debug(options);

  var port = new SerialPort(options.port, {
    baudrate: options.baud
  });

  port.on('open', function () {
    logger.info('mon', 'Serial port [%s] has been opened at baud rate %d', options.port, options.baud);
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

function listSerialPorts(ignores, done) {
  if (typeof ignores === 'function') {
    done = ignores;
    ignores = null;
  }
  ignores = ignores || [];
  var ig = ignore().add(ignores);
  sp.list(function (err, ports) {
    done(ig.filter(ports.map(function (port) {
      return port.comName;
    })))
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
