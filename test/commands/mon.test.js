"use strict";

var assert = require('chai').assert;
var fs = require('fs');
var npos = require('npos');
var s = require('../support');
var mon = require('../../lib/commands/mon');

describe('mon', function () {
  it('should translate image to text', function () {
    var raw = fs.readFileSync(s.fixtures('raster.bin'));
    var parser = npos.parser().use(mon.translate());
    return parser.parse(raw).then(function (result) {
      console.log(result.text);
      assert.include(result.text, '单号');
    });
  });
});

