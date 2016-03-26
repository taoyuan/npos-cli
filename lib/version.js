var path = require('path');
var util = require('util');

function formatReport(info, prefix) {
  var result = '';
  var names = Object.keys(info);
  for (var i = 0; i < names.length; i++) {
    var childPrefix = prefix;
    result += prefix;
    if (i === names.length - 1) {
      result += '└─';
      childPrefix += '  ';
    } else {
      result += '├─';
      childPrefix += '│ ';
    }

    var objInfo = info[names[i]];
    if (Object.keys(objInfo.dependencies).length > 0) {
      result += '┬';
    } else {
      result += '─';
    }
    if (objInfo.gitCommit) {
      result += util.format(' %s@%s (%s)\n', names[i], objInfo.version,
        objInfo.gitCommit.slice(0, 7));
    } else {
      result += util.format(' %s@%s\n', names[i], objInfo.version);
    }
    result += formatReport(objInfo.dependencies, childPrefix);
  }
  return result;
}

// The dependencies we are primarily interested in reporting about are
// those that the adm commands directly depend on. In addition, report
// the version of strong-agent.
var REPORT_DEPENDENCIES = [
  'node-inspector'
];

module.exports = function() {
  var result = {};
  REPORT_DEPENDENCIES.forEach(function(name) {
    try {
      var pkg = require(path.join(name, 'package.json'));
      result[name] = {
        version: pkg.version, dependencies: {}, gitCommit: pkg.gitHead
      };
    } catch (er) {
      console.error(
        'Dependency %s not found, try `npm install -g adm`.',
        name
      );
    }
  });

  var PACKAGE = require('../package.json');
  var peerDeps = PACKAGE.peerDependencies || [];
  Object.keys(peerDeps).forEach(function(name) {
    try {
      var pkg = require(path.join(name, 'package.json'));
      result[name] = {
        version: pkg.version, dependencies: {}, gitCommit: pkg.gitHead
      };
    } catch (er) {
      console.error(
        'Peer dependency %s not found, try `npm install -g %s`.',
        name, name
      );
    }
  });

  return [
    util.format('adm v%s (node %s)', PACKAGE.version, process.version),
    formatReport(result, '')
  ].join('\n');
};

// For unit test
module.exports.__REPORT_DEPENDENCIES = REPORT_DEPENDENCIES;
