"use strict";

var assert = require('chai').assert;
var fs = require('fs');
var npos = require('npos');
var s = require('../support');
var mon = require('../../lib/commands/mon');
var logger = require('../../lib/logger');

describe('mon', function () {
  it('should translate image to text', function () {
    var raw = fs.readFileSync(s.fixtures('raster.bin'));
    var parser = npos.parser().use(mon.translate({ocr: true}));
    logger.profile('data');
    return parser.parse(raw).then(function (result) {
      logger.profile('data');
      console.log(result.text);
      assert.include(result.text, '单号');
    });
  });
});

