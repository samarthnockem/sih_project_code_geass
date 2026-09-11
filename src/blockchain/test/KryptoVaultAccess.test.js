const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("KryptoVaultAccess", function () {
  const assetId = 1;
  const initialHash = `0x${"a".repeat(64)}`;
  const nextHash = `0x${"b".repeat(64)}`;

  async function deployFixture() {
    const [owner, writer, reader, other] = await ethers.getSigners();
    const KryptoVaultAccess = await ethers.getContractFactory("KryptoVaultAccess");
    const vault = await KryptoVaultAccess.deploy();
    return { vault, owner, writer, reader, other };
  }

  it("registers an asset with msg.sender as owner and emits immutable metadata event", async function () {
    const { vault, owner } = await deployFixture();

    await expect(vault.connect(owner).registerAsset(assetId, initialHash))
      .to.emit(vault, "AssetRegistered")
      .withArgs(assetId, owner.address, initialHash, 1);

    const asset = await vault.getAsset(assetId);
    expect(asset.owner).to.equal(owner.address);
    expect(asset.currentHash).to.equal(initialHash);
    expect(asset.currentVersion).to.equal(1);
    expect(await vault.getPermission(assetId, owner.address)).to.equal(2);
  });

  it("prevents duplicate asset registration", async function () {
    const { vault, owner } = await deployFixture();

    await vault.connect(owner).registerAsset(assetId, initialHash);

    await expect(vault.connect(owner).registerAsset(assetId, nextHash)).to.be.revertedWithCustomError(
      vault,
      "AssetAlreadyExists"
    );
  });

  it("allows only the owner to grant and revoke access", async function () {
    const { vault, owner, reader, other } = await deployFixture();

    await vault.connect(owner).registerAsset(assetId, initialHash);

    await expect(vault.connect(other).grantAccess(assetId, reader.address, 1, 0, 0)).to.be.revertedWithCustomError(
      vault,
      "NotAssetOwner"
    );

    await expect(vault.connect(owner).grantAccess(assetId, reader.address, 1, 0, 0))
      .to.emit(vault, "AccessGranted")
      .withArgs(assetId, owner.address, reader.address, 1, 0, 0);
    expect(await vault.getPermission(assetId, reader.address)).to.equal(1);

    await expect(vault.connect(other).revokeAccess(assetId, reader.address)).to.be.revertedWithCustomError(
      vault,
      "NotAssetOwner"
    );

    await expect(vault.connect(owner).revokeAccess(assetId, reader.address))
      .to.emit(vault, "AccessRevoked")
      .withArgs(assetId, owner.address, reader.address);
    expect(await vault.getPermission(assetId, reader.address)).to.equal(0);
  });

  it("resolves permissions outside validFrom and validUntil as NONE", async function () {
    const { vault, owner, reader } = await deployFixture();
    const latest = await ethers.provider.getBlock("latest");
    const validFrom = latest.timestamp + 100;
    const validUntil = latest.timestamp + 200;

    await vault.connect(owner).registerAsset(assetId, initialHash);
    await vault.connect(owner).grantAccess(assetId, reader.address, 1, validFrom, validUntil);

    expect(await vault.getPermission(assetId, reader.address)).to.equal(0);

    await network.provider.send("evm_setNextBlockTimestamp", [validFrom + 1]);
    await network.provider.send("evm_mine");
    expect(await vault.getPermission(assetId, reader.address)).to.equal(1);

    await network.provider.send("evm_setNextBlockTimestamp", [validUntil + 1]);
    await network.provider.send("evm_mine");
    expect(await vault.getPermission(assetId, reader.address)).to.equal(0);
  });

  it("lets owner and authorized writer commit new versions", async function () {
    const { vault, owner, writer } = await deployFixture();
    const writerHash = `0x${"c".repeat(64)}`;

    await vault.connect(owner).registerAsset(assetId, initialHash);

    await expect(vault.connect(owner).commitVersion(assetId, nextHash))
      .to.emit(vault, "VersionCommitted")
      .withArgs(assetId, owner.address, nextHash, 2);
    expect(await vault.currentHashOf(assetId)).to.equal(nextHash);
    expect(await vault.currentVersionOf(assetId)).to.equal(2);

    await vault.connect(owner).grantAccess(assetId, writer.address, 2, 0, 0);

    await expect(vault.connect(writer).commitVersion(assetId, writerHash))
      .to.emit(vault, "VersionCommitted")
      .withArgs(assetId, writer.address, writerHash, 3);
    expect(await vault.currentHashOf(assetId)).to.equal(writerHash);
    expect(await vault.currentVersionOf(assetId)).to.equal(3);
  });

  it("blocks readers, revoked writers, and expired writers from committing versions", async function () {
    const { vault, owner, writer, reader } = await deployFixture();
    const latest = await ethers.provider.getBlock("latest");

    await vault.connect(owner).registerAsset(assetId, initialHash);
    await vault.connect(owner).grantAccess(assetId, reader.address, 1, 0, 0);
    await vault.connect(owner).grantAccess(assetId, writer.address, 2, 0, latest.timestamp + 10);

    await expect(vault.connect(reader).commitVersion(assetId, nextHash)).to.be.revertedWithCustomError(
      vault,
      "NotAuthorizedWriter"
    );

    await vault.connect(owner).revokeAccess(assetId, writer.address);
    await expect(vault.connect(writer).commitVersion(assetId, nextHash)).to.be.revertedWithCustomError(
      vault,
      "NotAuthorizedWriter"
    );

    await vault.connect(owner).grantAccess(assetId, writer.address, 2, 0, latest.timestamp + 20);
    await network.provider.send("evm_setNextBlockTimestamp", [latest.timestamp + 21]);
    await network.provider.send("evm_mine");
    await expect(vault.connect(writer).commitVersion(assetId, nextHash)).to.be.revertedWithCustomError(
      vault,
      "NotAuthorizedWriter"
    );
  });

  it("rejects invalid grants", async function () {
    const { vault, owner, reader } = await deployFixture();

    await vault.connect(owner).registerAsset(assetId, initialHash);

    await expect(vault.connect(owner).grantAccess(assetId, ethers.ZeroAddress, 1, 0, 0)).to.be.revertedWithCustomError(
      vault,
      "InvalidAddress"
    );
    await expect(vault.connect(owner).grantAccess(assetId, reader.address, 0, 0, 0)).to.be.revertedWithCustomError(
      vault,
      "InvalidPermission"
    );
    await expect(vault.connect(owner).grantAccess(assetId, reader.address, 1, 100, 99)).to.be.revertedWithCustomError(
      vault,
      "InvalidAccessWindow"
    );
  });
});
