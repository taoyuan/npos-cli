'use strict';
//
// # CommandLoader
//
// The CommandLoader is responsible for loading and validating Command modules
// present at a configurable location in the filesystem.
//
var debug = require('debug')('adm');
var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var P = require('bluebird');
var fs = require('fs');
var path = require('path');
var yargs = require('yargs');
var util = require('util');
var needs = require('needs');
var logger = require('./logger');

//
// ## CommandLoader `CommandLoader(obj)`
//
// Creates a new instance of CommandLoader with the following options:
//  * root - The location of Command modules in the filesystem, represented as a
//    String. Defaults to a sibling 'commands' folder.
//  * strict - If true, CommandLoader will emit 'error' events if its run with a
//    primary argument that doesn't exist as a command. Otherwise, that argument
//    will be included in the fallback command's arguments. Defaults to `true`.
//  * usage - If `--help` or `-h` are passed as options, this command will be
//    used to generate a usage summary. Defaults to 'help'.
//  * fallback - If an unknown command is specified while running, this command
//    is used instead. Defaults to the same as `usage`.
//  * default - The command to run when no command is specified in argv.
//    Defaults to the same as `usage`.
//  * manuals - If set, this location will be used as a repository of named
//    manual files by loadManual()
//
// Commands are modules required from `root`. They must have a .run function,
// and a .usage string. Or, if module exports justa a function, that function
// will be used as the .run function, and if .usage is undefined it will be
// loaded by loadManual().
/**
 * 
 * @param obj
 * @returns {CommandLoader}
 * @constructor
 */
function CommandLoader(obj) {
  if (!(this instanceof CommandLoader)) {
    return new CommandLoader(obj);
  }

  obj = obj || {};

  this.root = obj.root || path.resolve(__dirname, 'commands');
  this.strict = true;
  this.usage = obj.usage || 'help';
  this.fallback = obj.fallback || this.usage;
  this.default = obj.default || this.usage;
  this.manuals = obj.manuals || null;

  this.logger = logger;

  this.commands = needs(__dirname, './commands');
}
util.inherits(CommandLoader, EventEmitter);
CommandLoader.createLoader = CommandLoader;
//
// ## run `run([argv])`
//
// Synchronously parses **argv**, or `process.argv` otherwise. If a command is
// present, that command is run. If no command is run, the configured `fallback`
// command is run instead.
//
CommandLoader.prototype.run = function run(argv) {
  var that = this;

  if (process.env.NPOS_ALIAS) {
    process.argv[1] = process.env.NPOS_ALIAS;
  }

  argv = argv || process.argv.slice(2);

  yargs(argv)
    .usage("$0 <command> [options]")
    .version(function () {
      return require('./version')();
    })
    .alias('V', 'version')
    .help('h')
    .alias('h', 'help');


  _.forEach(this.commands, function (action, name) {
    var description = '';
    if (Array.isArray(action.describe)) {
      name = action.describe[0];
      description = action.describe[1] || '';
    } else if (_.isString(action.describe)) {
      description = action.describe;
    }

    yargs.command(name, description, that.transformOptions(action.options), function (options) {
      process.env.NPOS_COMMAND = name;
      P.resolve(action(argv.slice(1), options, that)).catch(done);
    });

  });

  var options = yargs.argv;

  if (!process.env.NPOS_COMMAND) {
    return yargs.showHelp();
  }

  function done(err) {
    if (err) {
      that.emit('error', err);
    }
  }

  return that;
};

CommandLoader.prototype.transformOptions = function (options) {
  options = options || {};
  var result = {};
  _.forEach(options, function (spec, name) {
    spec = _.clone(spec);
    if ((typeof spec.alias === 'string') && spec.alias.length === 1) {
      // exchange alias and name
      result[spec.alias] = _.assign(spec, {alias: name});
    } else {
      result[name] = spec;
    }
  });
  return result;
};

module.exports = CommandLoader;
