// Dev helper for networks whose DNS server intermittently fails (ENOTFOUND for a host that exists).
// Preloaded with NODE_OPTIONS="--require ./scripts/dns-fix.cjs": it resolves hostnames through public
// DNS servers first and falls back to the system resolver. Needs outbound UDP/53 to reach 8.8.8.8.
const dns = require("node:dns");
const net = require("node:net");

const resolver = new dns.Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);
const original = dns.lookup;

dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (typeof options === "number") options = { family: options };
  options = options || {};
  const local = !hostname || net.isIP(hostname) || hostname === "localhost";
  if (local || options.family === 6) return original.call(dns, hostname, options, callback);
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      return original.call(dns, hostname, options, callback);
    }
    if (options.all)
      return callback(
        null,
        addresses.map((address) => ({ address, family: 4 })),
      );
    return callback(null, addresses[0], 4);
  });
};
