'use strict';

var debug = require('debug')('npos:mon');
var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var Promise = require('bluebird');
var inquirer = require('inquirer');
var npos = require('npos');
var humanSize = require('human-size');
var sp = require("serialport");
var SerialPort = sp.SerialPort;
var MutableBuffer = require('mutable-buffer');
var ignore = require('ignore');
var iconv = require('iconv-lite');
var moment = require('moment');
var ocr = require('npos-ocr').ocr;
var logger = require('../logger');

mon.describe = ['mon [options]', 'Monitor port data'];

mon.options = {
  interactive: {
    alias: 'I',
    describe: 'Start with interactive'
  },
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
    alias: 'i',
    type: 'number',
    default: '100',
    describe: 'The interval time (ms) on data within one page data'
  },
  parse: {
    alias: 'P',
    describe: 'Parse the data received.'
  },
  ocr: {
    describe: 'Enable Ocr. Parsing enabled implied'
  },
  tessdata: {
    alias: 't',
    describe: 'Specify tessdata path used for Ocr. OCRing enabled implied.'
  },
  language: {
    alias: 'l',
    describe: 'Specify language(s) used for Ocr. OCRing enabled implied.'
  },
  psm: {
    alias: 'm',
    describe: 'Specify page segmentation mode. OCRing enabled implied.'
  },
  ranges: {
    alias: 'r',
    type: 'array',
    describe: 'Set line ranges array for Ocr. Ocr enabled implied.\n\n' +
    'A range is a array with tow numbers, the first number is line to start, second number is count. All numbers can be negative. \n\n' +
    'Negative `from` indicate start from bottom. Negative `count` indicate count before start\n\n' +
    'Example: "[1, 2]" "[-2, 2]" "[-5, -3]" 12'
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
          var done = this.async();
          listSerialPorts(PORTS_IGNORES, function (coms) {
            if (!coms || !coms.length) {
              throw new Error('No serial port found!');
            }
            done(coms);
          });
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
        message: 'Select a baud rate:',
        default: 0,
        choices: mon.options.baud.choices
      });
    } else {
      options.baud = DEFAULT_BAUDRATE;
    }
  }

  if (options.ranges) {
    options.segline = options.segline || {};
    options.segline.ranges = _.map(options.ranges, function (range) {
      return typeof range === 'string' ? JSON.parse(range) : range;
    });
  }
  var ocropts = _.pick(options, ['language', 'psm', 'tessdata', 'segline']);
  if (options.ocr || !_.isEmpty(ocropts)) {
    options.ocr = ocropts;
  }
  options.parse = options.parse || options.ocr;

  options.text = _.pick(options, ['encoding']);

  if (questions.length > 0) {
    inquirer.prompt(questions, function (answer) {
      _.assign(options, answer);
      execute(options, logger);
    });
  } else {
    execute(options, logger);
  }

  function execute(options, logger) {
    debug(options);

    var port = new SerialPort(options.port, {
      baudrate: options.baud
    });

    port.on('open', function () {
      logger.info('mon', 'Serial port [%s] has been opened at baud rate %d', options.port, options.baud);
      logger.info('mon', 'Ready');
    });

    var receiver = new Receiver(port, options, logger);

    if (options.parse) {
      var parser = npos.parser();
      receiver.on('data', function (data) {
        logger.info('mon', 'Received %s data, Parsing ...', humanSize(data.length));
        console.time('npos-parse');
        console.time('npos-parse-escpos');

        parser.parse(data).then(function (ast) {
          console.timeEnd('npos-parse-escpos');
          console.time('npos-textualize');
          return npos.textualize(ast, options);
        }).then(function (results) {
          console.timeEnd('npos-textualize');
          console.timeEnd('npos-parse');
          var file = path.join(process.cwd(), moment().format('HHmmSS')), filename;
          logger.info('mon', 'Parsed a receipt ->', results.length);
          _.forEach(results, function (result, i) {
            if (!result) {
              return console.warn('[WARN] Some wrong data found');
            }
            if (typeof result === 'string') {
              filename = file + '-' + i + '.txt';
              fs.writeFileSync(filename, result);
              logger.info('mon', '  - Saved text decoded to', filename);
              // for debug output
              console.log(result);
            } else if (result.save) {
              filename = file + '-' + i + '.bmp';
              result.save(filename);
              logger.info('mon', '- Saved image decoded to', filename);
            }
          });
          logger.info('mon', 'Complete, Continue');
        }).catch(function (err) {
          logger.warn(err);
          logger.info('mon', 'Continue');
        })
      });
    } else {
      receiver.on('data', function (data) {
        var file = path.join(process.cwd(), moment().format('YYYYMMDDHHmmSS') + '.bin');
        logger.info('mon', 'Received %s data, saving to %s', humanSize(data.length), file);
        fs.writeFileSync(file, data);
        logger.info('mon', 'Complete, Continue');
      });
    }
  }
}

function listSerialPorts(ignores, done) {
  if (typeof ignores === 'function') {
    done = ignores;
    ignores = null;
  }
  ignores = ignores || [];
  var ig = ignore().add(ignores);
  sp.list(function (err, ports) {
    done(ig.filter(_.map(ports, function (port) {
      return port.comName;
    }).reverse()));
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

      resetTimer(options.interval || 500, function () {
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
