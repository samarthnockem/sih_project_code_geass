// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract KryptoVaultAccess {
    enum Permission {
        NONE,
        READ,
        WRITE
    }

    struct AccessWindow {
        Permission permission;
        uint64 validFrom;
        uint64 validUntil;
    }

    struct Asset {
        address owner;
        bytes32 currentHash;
        uint256 currentVersion;
        bool exists;
    }

    mapping(uint256 => Asset) private assets;
    mapping(uint256 => mapping(address => AccessWindow)) private permissions;

    event AssetRegistered(uint256 indexed assetId, address indexed owner, bytes32 sha256Hash, uint256 version);
    event AccessGranted(
        uint256 indexed assetId,
        address indexed owner,
        address indexed grantee,
        Permission permission,
        uint64 validFrom,
        uint64 validUntil
    );
    event AccessRevoked(uint256 indexed assetId, address indexed owner, address indexed grantee);
    event VersionCommitted(
        uint256 indexed assetId,
        address indexed committer,
        bytes32 sha256Hash,
        uint256 version
    );

    error AssetAlreadyExists();
    error AssetNotFound();
    error NotAssetOwner();
    error NotAuthorizedWriter();
    error InvalidAddress();
    error InvalidPermission();
    error InvalidAccessWindow();

    modifier assetExists(uint256 assetId) {
        if (!assets[assetId].exists) revert AssetNotFound();
        _;
    }

    modifier onlyOwner(uint256 assetId) {
        if (msg.sender != assets[assetId].owner) revert NotAssetOwner();
        _;
    }

    function registerAsset(uint256 assetId, bytes32 sha256Hash) external {
        if (assets[assetId].exists) revert AssetAlreadyExists();

        assets[assetId] = Asset({
            owner: msg.sender,
            currentHash: sha256Hash,
            currentVersion: 1,
            exists: true
        });

        emit AssetRegistered(assetId, msg.sender, sha256Hash, 1);
    }

    function grantAccess(
        uint256 assetId,
        address grantee,
        Permission permission,
        uint64 validFrom,
        uint64 validUntil
    ) external assetExists(assetId) onlyOwner(assetId) {
        if (grantee == address(0)) revert InvalidAddress();
        if (permission == Permission.NONE) revert InvalidPermission();
        if (validUntil != 0 && validUntil <= validFrom) revert InvalidAccessWindow();

        permissions[assetId][grantee] = AccessWindow({
            permission: permission,
            validFrom: validFrom,
            validUntil: validUntil
        });

        emit AccessGranted(assetId, msg.sender, grantee, permission, validFrom, validUntil);
    }

    function revokeAccess(uint256 assetId, address grantee) external assetExists(assetId) onlyOwner(assetId) {
        if (grantee == address(0)) revert InvalidAddress();

        delete permissions[assetId][grantee];

        emit AccessRevoked(assetId, msg.sender, grantee);
    }

    function commitVersion(uint256 assetId, bytes32 sha256Hash) external assetExists(assetId) {
        if (msg.sender != assets[assetId].owner && getPermission(assetId, msg.sender) != Permission.WRITE) {
            revert NotAuthorizedWriter();
        }

        assets[assetId].currentVersion += 1;
        assets[assetId].currentHash = sha256Hash;

        emit VersionCommitted(assetId, msg.sender, sha256Hash, assets[assetId].currentVersion);
    }

    function getAsset(uint256 assetId)
        external
        view
        assetExists(assetId)
        returns (address owner, bytes32 currentHash, uint256 currentVersion)
    {
        Asset storage asset = assets[assetId];
        return (asset.owner, asset.currentHash, asset.currentVersion);
    }

    function ownerOf(uint256 assetId) external view assetExists(assetId) returns (address) {
        return assets[assetId].owner;
    }

    function currentHashOf(uint256 assetId) external view assetExists(assetId) returns (bytes32) {
        return assets[assetId].currentHash;
    }

    function currentVersionOf(uint256 assetId) external view assetExists(assetId) returns (uint256) {
        return assets[assetId].currentVersion;
    }

    function getPermission(uint256 assetId, address user) public view assetExists(assetId) returns (Permission) {
        if (user == assets[assetId].owner) {
            return Permission.WRITE;
        }

        AccessWindow memory access = permissions[assetId][user];
        if (access.permission == Permission.NONE) {
            return Permission.NONE;
        }

        uint64 nowTs = uint64(block.timestamp);
        if (access.validFrom != 0 && nowTs < access.validFrom) {
            return Permission.NONE;
        }
        if (access.validUntil != 0 && nowTs > access.validUntil) {
            return Permission.NONE;
        }

        return access.permission;
    }

    function getAccessWindow(uint256 assetId, address user)
        external
        view
        assetExists(assetId)
        returns (Permission permission, uint64 validFrom, uint64 validUntil)
    {
        if (user == assets[assetId].owner) {
            return (Permission.WRITE, 0, 0);
        }

        AccessWindow memory access = permissions[assetId][user];
        return (getPermission(assetId, user), access.validFrom, access.validUntil);
    }
}
