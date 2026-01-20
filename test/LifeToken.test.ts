import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("LifeToken", function () {
  async function deployFixture() {
    const [owner, other] = await ethers.getSigners();

    const LifeToken = await ethers.getContractFactory("LifeToken");
    const token = await LifeToken.deploy(owner.address);
    await token.waitForDeployment();

    return { token, owner, other };
  }

  it("dovrebbe avere nome e simbolo corretti", async function () {
    const { token } = await loadFixture(deployFixture);

    expect(await token.name()).to.equal("LifeQuest Token");
    expect(await token.symbol()).to.equal("LIFE");
  });

  it("dovrebbe permettere all'owner di mintare 100 token", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("100", 18);

    await expect(token.mint(owner.address, amount))
      .to.emit(token, "Transfer")
      .withArgs(ethers.ZeroAddress, owner.address, amount);
  });

  it("dovrebbe aumentare il saldo dell'owner dopo il mint", async function () {
    const { token, owner } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("100", 18);

    await token.mint(owner.address, amount);

    expect(await token.balanceOf(owner.address)).to.equal(amount);
  });

  it("dovrebbe impedire a un non-owner di mintare", async function () {
    const { token, other } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("100", 18);

    await expect(token.connect(other).mint(other.address, amount))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });
});
