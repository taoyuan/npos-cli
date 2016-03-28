'use strict';

var debug = require('debug')('npos:mon');
var _ = require('lodash');
var fs = require('fs');
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
var ignore = require('ignore');
var iconv = require('iconv-lite');
var moment = require('moment');

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
    alias: 't',
    type: 'number',
    default: '100',
    describe: 'The interval time (ms) on data within one page data'
  },
  ocr: {
    alias: 'o',
    describe: 'Enable ocr'
  },
  lang: {
    alias: 'l',
    describe: 'Specify language(s) used for OCR.'
  },
  psm: {
    describe: 'Specify page segmentation mode.'
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
        default: 0,
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

  function execute(options, logger) {
    debug(options);

    var port = new SerialPort(options.port, {
      baudrate: options.baud
    });

    port.on('open', function () {
      logger.info('mon', 'Serial port [%s] has been opened at baud rate %d', options.port, options.baud);
      logger.info('mon', 'Waiting data ...');
    });

    var parser = npos.parser().use(translate({
      ocr: options.ocr,
      l: options.l,
      psm: options.psm
    }));
    var receiver = new Receiver(port, options, logger);
    receiver.on('data', function (data) {
      logger.info('mon', 'Received %s data, Parsing ...', humanSize(data.length));
      logger.profile('data-parsing');
      parser.parse(data).then(function (result) {
        logger.profile('data-parsing');
        var file = path.join(process.cwd(), moment().format('YYYYMMDDHHmmSS')), filename;
        logger.info('mon', 'Parsed a receipt:');
        if (result.image) {
          filename = file + '.png';
          result.image.toJimp().write(filename);
          console.log('  - Saved the image to', filename);
        }
        if (result.text) {
          filename = file + '.txt';
          fs.writeFileSync(filename, result.text);
          console.log('  - Saved the text to', filename);
        }
        logger.info('mon', 'Waiting data ...');
      });
    });
  }
}

// expose for testing
mon.translate = translate;
function translate(options) {
  options = options || {};
  options.ocr = !!(options.ocr || options.l || options.psm);
  return function (ctx, next) { // don't remove `next`
    if (ctx.node.type === 'raster') {
      ctx.image = ctx.image || npos.bitimage();
      ctx.image.append(ctx.node.data);
    }

    if (options.ocr && ctx.image && (ctx.last || ctx.node.type === 'text')) {
      return require('npos-tesseract').ocr(ctx.image, options).then(function (text) {
        ctx.text = ctx.text || '';
        ctx.text += text || '';
        ctx.image = null;
        tryTranslateText(ctx);
        ctx.end();
      }).catch(function (err) {
        throw err;
      })
    }

    tryTranslateText(ctx);
    ctx.end();

    function tryTranslateText(ctx) {
      if (ctx.node.type === 'text') {
        ctx.text = ctx.text || '';
        ctx.text += iconv.decode(ctx.node.data, ctx.options.encoding || 'GB2312');
      }
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
