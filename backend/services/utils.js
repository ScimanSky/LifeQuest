const { ethers } = require("ethers");

function normalizeWallet(address) {
  if (!address || typeof address !== "string") return null;
  if (!ethers.isAddress(address)) return null;
  return address.toLowerCase();
}

function normalizeActivityId(activityId) {
  if (activityId === null || activityId === undefined) return null;
  const text = String(activityId).trim();
  return text.length ? text : null;
}

module.exports = {
  normalizeWallet,
  normalizeActivityId
};
