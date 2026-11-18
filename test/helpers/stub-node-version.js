// Preloaded with `node --import`: replaces process.version with MHW_TEST_NODE_VERSION before mhw runs,
// so the NODE line of `mhw status` can be exercised as an older node would see it. Tests only.
const wanted = process.env.MHW_TEST_NODE_VERSION;
if (wanted) Object.defineProperty(process, 'version', { value: wanted, configurable: true });
