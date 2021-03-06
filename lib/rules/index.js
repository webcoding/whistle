var util = require('../../util');
var rulesUtil = require('./util');
var url = require('url');
var net = require('net');
var dns = require('dns');
var extend = require('util')._extend;

var rules, hosts, heads, req, res, proxy, weinre;
rules = hosts = heads = req = res = proxy = weinre = [];

function parse(text) {
	rules = [];
	hosts = [];
	heads = [];
	req = [];
	res = [];
	weinre = [];
	proxy = [];
	if (!text || !(text = text.trim())) {
		return;
	}
	
	text.split(/\n|\r\n|\r/g).forEach(pareLine);
}

function pareLine(line) {
	var raw = line;
	line = line.replace(/#.*$/, '').trim();
	if (!line) {
		return;
	}
	
	line = line.split(/\s+/);
	var pattern = line[0];
	if (net.isIP(pattern) || (util.hasProtocol(pattern) && !/^https?:\/\//.test(pattern))) {
		line.slice(1).forEach(function(matcher) {
			parseRule(matcher, pattern, raw);
		});
	} else if (!util.isRegExp(pattern) && util.isRegExp(line[1])) {
		parseRule(line[1], pattern, raw);
	} else {
		parseRule(pattern, line[1], raw);
	}
}

function parseRule(pattern, matcher, raw) {
	var isRegExp;
	if (!pattern || !matcher || 
			((isRegExp = util.isRegExp(pattern)) && !(pattern = util.toRegExp(pattern)))) {
		return;
	}
	
	var rule = {
			isRegExp: isRegExp,
			protocol: isRegExp ? null : util.getProtocol(pattern),
			pattern: isRegExp ? pattern : formatUrl(pattern),
			matcher: matcher,
			raw: raw,
			rawPattern: pattern
		};
	
	if (net.isIP(matcher)) {
		hosts.push(rule);
	} else if (/^head:\/\//.test(matcher)) {
		heads.push(rule);
	} else if (/^req:\/\//.test(matcher)) {
		req.push(rule);
	} else if (/^res:\/\//.test(matcher)) {
		res.push(rule);
	} else if (/^proxy:\/\//.test(matcher)) {
		proxy.push(rule);
	} else if (/^weinre:\/\//.test(matcher)) {
		weinre.push(rule);
	} else {
		rules.push(rule);
	}
}

exports.parse = parse;

function resolveHost(_url, callback) {
	_url = formatUrl(util.setProtocol(_url));
	var options = url.parse(_url);
	if (!util.isWebProtocol(options.protocol)) {
		
		return callback(null, null);
	}
	
	var host = getRule(_url, hosts);
	if (host) {
		return callback(null, host.matcher);
	}
	
	try {
		dns.lookup(options.hostname, function(err, ip, addressType) {
		      callback(err, err ? null : (ip || (!addressType || addressType === 4 ? '127.0.0.1' : '0:0:0:0:0:0:0:1')));
		  });
	} catch(err) {//如果断网，可能直接抛异常，https代理没有用到error-handler
		callback(err);
	}
}

function formatUrl(pattern) {
	
	return pattern.indexOf('/', util.getProtocol(pattern) == null ? 0 : pattern.indexOf('://') + 3) == -1 ? 
			pattern + '/' : pattern;
}

exports.resolveHost = resolveHost;


function getRule(url, _rules) {
	var rules = _getRule(url, _rules);
	//支持域名匹配
	if (!rules && (rules = _getRule(url.replace(/^(https?:\/\/[^\/]+):\d*(\/.*)/i, '$1$2'), _rules))
			&& util.removeProtocol(rules.rawPattern, true).indexOf('/') != -1) {
		rules = null;
	}
	if (rules) {
		url = rules.url;
		var index = url.indexOf('://') + 3;
		var protocol = url.substring(0, index);
		url = url.substring(index);
		var key = getKey(url);
		if (key) {
			rules.key = key;
		}
		var value = key && rulesUtil.getValue(key);
		if (value == null) {
			value = false;
		}
		if (value !== false || (value = getValue(url)) !== false) {
			rules.value = protocol + value;
		} else if ((value = getPath(url)) !== false) {
			rules.path = protocol + value;
		}
	}
	
	return rules;
}

function getKey(url) {
	if (url.indexOf('{') == 0) {
		var index = url.lastIndexOf('}');
		return index > 1 && url.substring(1, index);
	}
	
	return false;
}

function getValue(url) {
	if (url.indexOf('(') == 0) {
		var index = url.lastIndexOf(')');
		return index != -1 && url.substring(1, index) || '';
	}
	
	return false;
}

function getPath(url) {
	if (url.indexOf('<') == 0) {
		var index = url.lastIndexOf('>');
		return index != -1 && url.substring(1, index) || '';
	}
	
	return false;
}

function _getRule(url, _rules) {
	_rules = _rules || rules;
	if (util.removeProtocol(url, true).indexOf('/') == -1) {
		url += '/';
	}
	var _url = url.replace(/(?:\?|#).*$/, '');
	for (var i = 0, rule; rule = _rules[i]; i++) {
		var pattern = rule.pattern;
		if (rule.isRegExp) {
			if (pattern.test(url)) {
				var regExp = {};
				for (var i = 1; i < 10; i++) {
					regExp['$' + i] = RegExp['$' + i] || '';
				}
				
				return extend({
					url: setProtocol(rule.matcher.replace(/(^|.)?(\$[1-9])/g, 
							function(matched, $1, $2) {
						return $1 == '\\' ? $2 : ($1 || '') + regExp[$2];
					}), url)
				}, rule);;
			}
		} else {
			pattern = setProtocol(pattern, url);
			if (_url.indexOf(pattern) === 0) {
				var len = pattern.length;
				if (pattern == _url || isPathSeparator(_url[len]) || isPathSeparator(pattern[len - 1])) {
					return extend({
						url: join(setProtocol(rule.matcher, url), url.substring(len))
					}, rule);
				}
			}
		}
	}
}

function setProtocol(target, source) {
	if (util.hasProtocol(target)) {
		return target;
	}
	
	var protocol = util.getProtocol(source);
	if (protocol == null) {
		return target;
	}
	
	return protocol + '//' + target;
}

function resolveRule(url) {
	return getRule(url);
}

function resolveHead(url) {
	return getRule(url, heads);
}

function resolveReq(url) {
	return getRule(url, req);
}

function resolveRes(url) {
	return getRule(url, res);
}

function resolveProxy(url) {
	return getRule(url, proxy);
}

function resolveWeinre(url) {
	return getRule(url, weinre);
}

function isPathSeparator(ch) {
	return ch == '/' || ch == '\\';
}

function join(first, last) {
	if (!first || !last) {
		return first + last;
	}
	
	var len = first.length - 1;
	if (isPathSeparator(first[len])) {
		return isPathSeparator(last[0]) ? first.substring(0, len) + last : first + last;
	}
	
	return isPathSeparator(last[0]) ? first + last : first + '/' + last;
}

exports.resolveRules = function resolveRules(url) {
	url = formatUrl(util.setProtocol(url));

	var rules = {};
	var rule = resolveRule(url);
	if (rule) {
		rules.rule = rule;
	}
	if (rule = resolveHead(url)) {
		rules.head = rule;
	}
	if (rule = resolveReq(url)) {
		rules.req = rule;
	}
	if (rule = resolveRes(url)) {
		rules.res = rule;
	}
	if (rule = resolveProxy(url)) {
		rules.proxy = rule;
	}
	if (rule = resolveWeinre(url)) {
		rules.weinre = rule;
	}
	
	return rules;
};
