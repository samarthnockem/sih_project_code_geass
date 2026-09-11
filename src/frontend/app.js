const PREFERENCES_STORAGE_KEY = "kryptovault-preferences-v1";
const DEMO_MODE_STORAGE_KEY = "kryptovault-demo-mode-enabled";
const DEMO_STATE_STORAGE_KEY = "kryptovault-demo-state-v1";

const defaultPreferences = () => ({
  requireKyc: true,
  requireWallet: true,
  showProgress: true,
  theme: "dark"
});

const emptyUser = () => ({
  name: "Guest",
  email: "",
  walletAddress: "",
  kycStatus: "PENDING"
});

const emptyAppData = () => ({
  user: emptyUser(),
  folders: [],
  documents: [],
  shared: [],
  activities: []
});

const initialState = () => ({
  user: {
    name: "Rohit Sharma",
    email: "rohit@example.com",
    walletAddress: "",
    kycStatus: "PENDING"
  },
  settings: defaultPreferences(),
  folders: [
    { id: "personal", name: "Personal", createdAt: Date.now() },
    { id: "certificates", name: "Certificates", createdAt: Date.now() },
    { id: "projects", name: "Projects", createdAt: Date.now() }
  ],
  documents: [
    {
      id: "doc-1001",
      name: "Employment_Agreement.pdf",
      size: 428000,
      mimeType: "application/pdf",
      folderId: "personal",
      accessType: "private",
      hash: "a84d11e93f96c55c91708b98b9c5e1abc73d1db1f239d105d1c1dd32b91f167c",
      verified: true,
      txHash: "0x8d5b0f4f726cb29a7b2227e1f4c4c8a713e4189fd7061628b211674ff0119b7a",
      blockNumber: 193244,
      createdAt: Date.now() - 1000 * 60 * 53,
      permissions: [
        {
          id: "perm-a1",
          name: "Ananya Gupta",
          recipient: "ananya@example.com",
          wallet: "0xa17c...81c0",
          role: "VIEW",
          expiresAt: Date.now() + 6 * 86400000,
          reason: "Contract review",
          active: true
        }
      ]
    },
    {
      id: "doc-1002",
      name: "Project_IP_Documentation.docx",
      size: 932000,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      folderId: "projects",
      accessType: "team",
      hash: "b931641c5601510ad08ce4a69db51ae715321c45f9a81e9c89d092c63c08d8fb",
      verified: true,
      txHash: "0xc7de8ae550467e3e4f62ad2bf40fb61a2be1602f9f6d56ed34ff3f11eaed4820",
      blockNumber: 193211,
      createdAt: Date.now() - 1000 * 60 * 60 * 5,
      permissions: []
    }
  ],
  shared: [
    {
      id: "shared-1",
      name: "Research_Paper.pdf",
      owner: "Arjun Mehta",
      access: "VIEW",
      expiresAt: Date.now() + 2 * 86400000,
      verified: true
    },
    {
      id: "shared-2",
      name: "CAD_Prototype_v4.zip",
      owner: "Riya Kapoor",
      access: "DOWNLOAD",
      expiresAt: null,
      verified: true
    }
  ],
  activities: [
    { id: crypto.randomUUID(), action: "Access granted", detail: "Ananya Gupta received VIEW access to Employment_Agreement.pdf", time: Date.now() - 1000 * 60 * 16 },
    { id: crypto.randomUUID(), action: "Document registered", detail: "Project_IP_Documentation.docx fingerprint recorded", time: Date.now() - 1000 * 60 * 60 * 5 },
    { id: crypto.randomUUID(), action: "Document uploaded", detail: "Employment_Agreement.pdf added to secure storage", time: Date.now() - 1000 * 60 * 53 }
  ]
});

let state = loadState();
let currentDocId = null;
let pendingRevoke = null;
let selectedUploadFile = null;
let blockchainRecordsRequestId = 0;
let accountStateGeneration = 0;
let walletEventsRegistered = false;
let toastTimer = null;

function isDemoModeEnabled() {
  return window.KRYPTO_DEMO_MODE === true || localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "true";
}

function setDemoModeEnabled(enabled) {
  if (enabled) {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, "true");
    return;
  }

  localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
  localStorage.removeItem(DEMO_STATE_STORAGE_KEY);
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY));
    if (saved && typeof saved === "object") {
      return {
        ...defaultPreferences(),
        showProgress: typeof saved.showProgress === "boolean" ? saved.showProgress : defaultPreferences().showProgress,
        theme: saved.theme === "light" ? "light" : "dark"
      };
    }
  } catch (_) {}

  return defaultPreferences();
}

function savePreferences() {
  const safePreferences = {
    showProgress: !!state.settings.showProgress,
    theme: state.settings.theme === "light" ? "light" : "dark"
  };
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(safePreferences));
}

function loadDemoState() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_STATE_STORAGE_KEY));
    if (saved && typeof saved === "object") return saved;
  } catch (_) {}

  const fresh = initialState();
  localStorage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function loadState() {
  const settings = loadPreferences();

  if (isDemoModeEnabled()) {
    return { ...loadDemoState(), settings };
  }

  return { ...emptyAppData(), settings };
}

function normalizeKycStatus(status) {
  const normalized = String(status || "PENDING").toUpperCase();
  return ["PENDING", "VERIFIED", "REJECTED"].includes(normalized) ? normalized : "PENDING";
}

function isKycVerified() {
  return normalizeKycStatus(state.user.kycStatus) === "VERIFIED";
}

function saveState() {
  savePreferences();
  if (isDemoModeEnabled()) {
    localStorage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(state));
  }
  renderAll();
}

async function loadAuthenticatedUser() {
  if (!window.KryptoVaultApi) return emptyUser();

  try {
    const profile = await window.KryptoVaultApi.get("/api/users/me");
    return {
      name: profile?.displayName || profile?.walletAddress || "Authenticated User",
      email: profile?.email || "",
      walletAddress: profile?.walletAddress || "",
      kycStatus: normalizeKycStatus(profile?.kycStatus)
    };
  } catch (error) {
    if (error?.status === 401 || error?.status === 404) return emptyUser();
    return emptyUser();
  }
}

async function loadKycStatus() {
  if (!window.KryptoVaultApi || isDemoModeEnabled()) {
    return {
      walletAddress: state.user.walletAddress,
      kycStatus: normalizeKycStatus(state.user.kycStatus),
      verificationMethod: null,
      verifiedAt: null
    };
  }

  const status = await window.KryptoVaultApi.get("/api/kyc/status");
  state.user.kycStatus = normalizeKycStatus(status?.kycStatus);
  if (status?.walletAddress) {
    state.user.walletAddress = status.walletAddress;
  }
  renderAll();
  return status;
}

async function mockVerifyKyc() {
  const file = document.getElementById("kycFile").files[0];
  if (!file) return toast("Choose a demo identity document first.");

  if (isDemoModeEnabled()) {
    state.user.kycStatus = "VERIFIED";
    addActivity("Mock KYC verified", `${document.getElementById("kycType").value} demo KYC completed without uploading file contents`);
    saveState();
    toast("Mock KYC verified. Demo file was not uploaded.");
    return;
  }

  if (!state.user.walletAddress) {
    toast("Connect and authenticate your wallet before mock KYC.");
    return;
  }

  try {
    await window.KryptoVaultApi.post("/api/kyc/mock-verify", {
      kycStatus: "VERIFIED"
    });
    const status = await loadKycStatus();
    addActivity("Mock KYC verified", `Mock verification recorded for ${shortHash(status.walletAddress)}`);
    renderAll();
    toast("Mock KYC verified. Demo file was not uploaded.");
  } catch (error) {
    toast(error?.message || "Mock KYC verification failed.");
  }
}

async function loadOwnedAssets() {
  if (!window.KryptoVaultApi) return [];

  try {
    const response = await window.KryptoVaultApi.get("/api/assets/my");
    return (response?.assets || []).map(normalizeBackendAsset);
  } catch (error) {
    if (error?.status === 401) return [];
    toast(error?.message || "Documents could not be loaded.");
    return [];
  }
}

async function loadSharedAssets() {
  if (!window.KryptoVaultApi) return [];

  try {
    const response = await window.KryptoVaultApi.get("/api/assets/shared-with-me");
    return (response?.assets || []).map(normalizeBackendSharedAsset);
  } catch (error) {
    if (error?.status === 401) return [];
    toast(error?.message || "Shared documents could not be loaded.");
    return [];
  }
}

async function loadFolders() {
  if (!window.KryptoVaultApi) return [];

  try {
    const response = await window.KryptoVaultApi.get("/api/folders");
    return (response?.folders || []).map(normalizeBackendFolder);
  } catch (error) {
    if (error?.status === 401) return [];
    toast(error?.message || "Folders could not be loaded.");
    return [];
  }
}

async function loadAuditActivity() {
  if (!window.KryptoVaultApi) return [];

  try {
    const response = await window.KryptoVaultApi.get("/api/activity");
    return (response?.activity || []).map(normalizeAuditEvent);
  } catch (error) {
    if (error?.status === 401) return [];
    toast(error?.message || "Activity could not be loaded.");
    return [];
  }
}

function normalizeAuditEvent(event) {
  return {
    id: event.id,
    assetId: event.assetId,
    time: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
    action: String(event.action || "").replaceAll("_", " "),
    detail: event.detail || "",
    blockchainTxHash: event.blockchainTxHash || ""
  };
}

async function loadDocumentActivity(doc, force = false) {
  if (isDemoModeEnabled()) {
    return state.activities.filter(a => a.detail.includes(doc.name));
  }

  if (!window.KryptoVaultApi) return [];
  if (!force && doc.activityLoadedFor === doc.id) return doc.activity || [];

  doc.activityLoading = true;
  try {
    const response = await window.KryptoVaultApi.get(`/api/assets/${encodeURIComponent(doc.id)}/activity`);
    doc.activity = (response?.activity || []).map(normalizeAuditEvent);
    doc.activityLoadedFor = doc.id;
    return doc.activity;
  } catch (error) {
    doc.activityError = error?.message || "Document activity could not be loaded.";
    return [];
  } finally {
    doc.activityLoading = false;
  }
}

async function loadBlockchainRecords() {
  // Blockchain summary endpoints are not implemented yet.
  return [];
}

async function loadBackendState() {
  if (isDemoModeEnabled()) return;
  const generation = accountStateGeneration;

  const [user, folders, documents, shared, activities] = await Promise.all([
    loadAuthenticatedUser(),
    loadFolders(),
    loadOwnedAssets(),
    loadSharedAssets(),
    loadAuditActivity()
  ]);

  if (generation !== accountStateGeneration) return;

  state = {
    ...state,
    user,
    folders,
    documents,
    shared,
    activities
  };
  renderAll();
}

async function refreshWorkspaceState() {
  if (isDemoModeEnabled()) {
    renderAll();
    return;
  }
  const generation = accountStateGeneration;

  const [folders, documents, shared] = await Promise.all([
    loadFolders(),
    loadOwnedAssets(),
    loadSharedAssets()
  ]);

  if (generation !== accountStateGeneration) return;

  state = {
    ...state,
    folders,
    documents,
    shared
  };
  renderAll();
}

function normalizeBackendFolder(folder) {
  return {
    id: folder.id,
    name: folder.name || "Untitled Folder",
    parentFolderId: folder.parentFolderId || null,
    createdAt: folder.createdAt ? new Date(folder.createdAt).getTime() : Date.now(),
    updatedAt: folder.updatedAt ? new Date(folder.updatedAt).getTime() : undefined
  };
}

function normalizeBackendAsset(asset) {
  const verificationStatus = String(asset.blockchainVerificationStatus || "pending").toLowerCase();

  return {
    id: asset.assetId || asset.id,
    name: asset.filename || "Untitled Document",
    size: typeof asset.size === "number" ? asset.size : 0,
    mimeType: asset.mimeType || "application/octet-stream",
    folderId: asset.folderId || null,
    accessType: "private",
    hash: asset.sha256 || "",
    verified: verificationStatus === "verified",
    status: asset.status || "active",
    passwordProtectionEnabled: asset.passwordProtectionEnabled === true,
    blockchainVerificationStatus: verificationStatus,
    blockchainAssetId: asset.blockchainAssetId || "",
    txHash: asset.registrationTransactionHash || "",
    blockNumber: asset.registrationBlockNumber || "",
    createdAt: asset.createdAt ? new Date(asset.createdAt).getTime() : Date.now(),
    permissions: [],
    accessGrants: [],
    accessGrantsLoadedFor: null,
    accessGrantsLoading: false
  };
}

function normalizeBackendAccessGrant(grant) {
  const recipientWallet = grant.granteeWallet || "";
  const displayName = grant.granteeDisplayName || shortHash(recipientWallet);
  return {
    id: grant.blockchainTxHash || recipientWallet,
    name: displayName,
    recipient: recipientWallet,
    wallet: recipientWallet,
    role: grant.accessType,
    expiresAt: grant.validUntil ? new Date(grant.validUntil).getTime() : null,
    validFrom: grant.validFrom ? new Date(grant.validFrom).getTime() : null,
    reason: grant.reason || "",
    status: String(grant.status || "ACTIVE").toUpperCase(),
    blockchainTxHash: grant.blockchainTxHash || ""
  };
}

function normalizeBackendSharedAsset(asset) {
  const blockchainVerified = asset.blockchainVerified === true;
  return {
    id: asset.assetId || asset.id,
    assetId: asset.assetId || asset.id,
    name: asset.filename || "Untitled Document",
    owner: asset.ownerDisplayName || shortHash(asset.ownerWallet),
    ownerWallet: asset.ownerWallet || "",
    access: asset.permission || "READ",
    expiresAt: asset.expiry ? new Date(asset.expiry).getTime() : null,
    currentVersion: asset.currentVersion || "",
    hash: asset.sha256 || "",
    blockchainVerified,
    status: blockchainVerified ? "VERIFIED" : "PENDING",
    size: typeof asset.size === "number" ? asset.size : 0,
    mimeType: asset.mimeType || "application/octet-stream",
    blockchainAssetId: asset.blockchainAssetId || ""
  };
}

function normalizeBlockchainRecord(record) {
  const latest = record.latestKnownTransaction || null;
  const registration = record.registration || {};
  const current = record.current || {};
  return {
    assetId: record.assetId || record.id || "",
    filename: record.filename || "Untitled Document",
    ownerWallet: current.ownerWallet || record.ownerWallet || "",
    currentHash: current.hash || record.currentHash || "",
    currentVersion: current.version || record.currentVersion || "",
    registrationTxHash: registration.transactionHash || record.registrationTxHash || record.registrationTransactionHash || "",
    blockNumber: registration.blockNumber || record.blockNumber || "",
    status: record.status || record.blockchainVerificationStatus || "pending",
    confirmationState: record.confirmationState || record.blockchainVerificationStatus || record.status || "pending",
    latestKnownTransaction: latest
      ? {
          action: latest.action || "",
          detail: latest.detail || "",
          blockchainTxHash: latest.blockchainTxHash || "",
          timestamp: latest.timestamp || ""
        }
      : null
  };
}

function blockchainStatusBadge(status) {
  const normalized = String(status || "pending").toUpperCase();
  if (normalized === "VERIFIED" || normalized === "ACTIVE" || normalized === "CONFIRMED") {
    return `<span class="badge green">Verified</span>`;
  }
  if (normalized.includes("FAILED") || normalized.includes("MISMATCH") || normalized === "FAILED") {
    return `<span class="badge red">${escapeHtml(normalized.replaceAll("_", " "))}</span>`;
  }
  return `<span class="badge blue">${escapeHtml(normalized.replaceAll("_", " "))}</span>`;
}

function renderBlockchainTable(records) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Document</th><th>Owner</th><th>Hash</th><th>Transaction</th><th>Block</th><th>Status</th></tr></thead>
        <tbody>
          ${records.map(record => `
            <tr>
              <td class="file-name">${escapeHtml(record.filename)}</td>
              <td>${record.ownerWallet ? shortHash(record.ownerWallet) : "Pending"}</td>
              <td class="hash-text">${record.currentHash ? shortHash(record.currentHash) : "Pending"}</td>
              <td class="hash-text">${record.registrationTxHash ? shortHash(record.registrationTxHash) : "Pending"}</td>
              <td>${record.blockNumber || "Pending"}</td>
              <td>${blockchainStatusBadge(record.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function clearAuthenticatedUser() {
  state.user = emptyUser();
  renderAll();
}

function normalizeWalletAddressForUi(walletAddress) {
  return String(walletAddress || "").trim().toLowerCase();
}

function closeAccountScopedModals() {
  document.querySelectorAll(".modal.open").forEach((modal) => modal.classList.remove("open"));
}

function resetAccountScopedState(message = "Guest", walletAddress = "") {
  accountStateGeneration += 1;
  blockchainRecordsRequestId += 1;
  const settings = { ...state.settings };
  state = {
    ...emptyAppData(),
    settings,
    user: {
      ...emptyUser(),
      name: message,
      walletAddress: normalizeWalletAddressForUi(walletAddress)
    }
  };
  currentDocId = null;
  pendingRevoke = null;
  selectedUploadFile = null;
  closeAccountScopedModals();
  renderAll();
}

function assignWalletConnectionState(walletAddress, message = "Wallet connected - authenticating...") {
  state.user = {
    ...emptyUser(),
    name: message,
    walletAddress: normalizeWalletAddressForUi(walletAddress)
  };
  console.debug("[wallet] state assigned");
  renderAll();
  console.debug("[wallet] render called");
}

async function initializeWalletSession(walletAddress, message = "Wallet connected - authenticating...") {
  const selectedWallet = normalizeWalletAddressForUi(walletAddress);
  assignWalletConnectionState(selectedWallet, message);
  const user = await authenticateWallet(selectedWallet);
  await loadBackendState();
  return user;
}

async function getSelectedMetaMaskAccount() {
  if (!window.ethereum?.request) return "";
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  return normalizeWalletAddressForUi(accounts?.[0] || "");
}

async function assertAuthenticatedWalletMatches(expectedWallet) {
  const expected = normalizeWalletAddressForUi(expectedWallet);
  const [selectedWallet, backendUser] = await Promise.all([
    getSelectedMetaMaskAccount(),
    loadAuthenticatedUser()
  ]);
  const backendWallet = normalizeWalletAddressForUi(backendUser.walletAddress);

  if (!expected || selectedWallet !== expected || backendWallet !== expected) {
    throw new Error("Selected wallet and authenticated backend session do not match.");
  }

  state.user = backendUser;
  return backendUser;
}

async function refreshAuthenticatedUser() {
  state.user = await loadAuthenticatedUser();
  renderAll();
  return state.user;
}

async function saveUserProfile() {
  const displayName = document.getElementById("profileName").value.trim();
  const email = document.getElementById("profileEmail").value.trim();

  if (isDemoModeEnabled()) {
    state.user.name = displayName || state.user.name;
    state.user.email = email;
    saveState();
    toast("Demo profile saved.");
    return;
  }

  if (!state.user.walletAddress) {
    toast("Connect and authenticate your wallet before saving profile.");
    return;
  }

  try {
    const profile = await window.KryptoVaultApi.patch("/api/users/me", {
      displayName,
      email
    });

    state.user = {
      name: profile?.displayName || profile?.walletAddress || "Authenticated User",
      email: profile?.email || "",
      walletAddress: profile?.walletAddress || "",
      kycStatus: normalizeKycStatus(profile?.kycStatus)
    };
    saveState();
    toast("Profile saved.");
  } catch (error) {
    toast(error?.message || "Profile could not be saved.");
    renderAccount();
  }
}

async function logoutWalletSession(message = "Guest", resetUi = true) {
  if (window.KryptoVaultApi) {
    try {
      await window.KryptoVaultApi.post("/api/auth/logout");
    } catch (_) {}
  }

  if (resetUi) {
    resetAccountScopedState(message);
  }
}

async function requestWalletAccount() {
  if (!window.ethereum?.request) {
    throw new Error("MetaMask is required for wallet authentication.");
  }

  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  console.debug("[wallet] accounts returned", accounts);
  if (!accounts?.[0]) {
    throw new Error("No MetaMask account was selected.");
  }

  console.debug("[wallet] selected account", accounts[0]);
  return accounts[0];
}

async function requestLoginChallenge() {
  if (!window.KryptoVaultApi) {
    throw new Error("API client is not available.");
  }

  return window.KryptoVaultApi.get("/api/auth/challenge");
}

async function signLoginChallenge(account, challenge) {
  if (!challenge?.message || !challenge?.nonce) {
    throw new Error("Backend returned an invalid login challenge.");
  }

  return window.ethereum.request({
    method: "personal_sign",
    params: [challenge.message, account]
  });
}

async function verifySignedChallenge(challenge, signature) {
  return window.KryptoVaultApi.post("/api/auth/verify", {
    message: challenge.message,
    nonce: challenge.nonce,
    signature
  });
}

async function authenticateWallet(account) {
  const generation = accountStateGeneration;
  const walletAddress = account || await requestWalletAccount();
  const expectedWallet = normalizeWalletAddressForUi(walletAddress);
  assignWalletConnectionState(expectedWallet, "Authenticating wallet...");

  console.debug("[wallet] auth started");
  const challenge = await requestLoginChallenge();
  const signature = await signLoginChallenge(walletAddress, challenge);
  if (generation !== accountStateGeneration) {
    throw new Error("Wallet authentication was superseded by another account change.");
  }
  if ((await getSelectedMetaMaskAccount()) !== expectedWallet) {
    throw new Error("MetaMask account changed while authentication was in progress.");
  }

  await verifySignedChallenge(challenge, signature);
  console.debug("[wallet] auth success");
  const user = await assertAuthenticatedWalletMatches(expectedWallet);
  if (generation !== accountStateGeneration) {
    throw new Error("Wallet authentication was superseded by another account change.");
  }
  if (!window.KryptoVaultCrypto) {
    throw new Error("Document encryption identity support is not available.");
  }
  if (user.walletAddress) {
    await window.KryptoVaultCrypto.ensureDocumentEncryptionIdentityRegistered(user.walletAddress);
  }
  if (generation !== accountStateGeneration) {
    throw new Error("Wallet authentication was superseded by another account change.");
  }
  addActivity("Wallet authenticated", `Verified wallet session for ${shortHash(user.walletAddress)}`);
  renderAll();
  return user;
}

async function handleWalletAccountChanged(accounts) {
  if (isDemoModeEnabled()) return;

  const nextWallet = normalizeWalletAddressForUi(accounts?.[0] || "");
  resetAccountScopedState(nextWallet ? "Switching account..." : "Guest", nextWallet);
  console.debug("[wallet] state assigned");
  console.debug("[wallet] render called");
  await logoutWalletSession("Switching account...", false);

  if (!nextWallet) {
    toast("MetaMask account disconnected.");
    return;
  }

  try {
    await initializeWalletSession(nextWallet, "Switching account...");
    toast("MetaMask account changed. Session re-authenticated.");
  } catch (_) {
    console.debug("[wallet] auth failure");
    await logoutWalletSession("Guest", false);
    resetAccountScopedState("Wallet connected - authentication failed", nextWallet);
    toast("MetaMask account changed. Please sign in again.");
  }
}

async function restoreConnectedWallet() {
  if (isDemoModeEnabled()) return;

  const selectedWallet = await getSelectedMetaMaskAccount();
  if (!selectedWallet) return;

  resetAccountScopedState("Authenticating wallet...", selectedWallet);
  console.debug("[wallet] accounts returned", [selectedWallet]);
  console.debug("[wallet] selected account", selectedWallet);
  console.debug("[wallet] state assigned");
  console.debug("[wallet] render called");

  try {
    await initializeWalletSession(selectedWallet, "Authenticating wallet...");
  } catch (_) {
    console.debug("[wallet] auth failure");
    await logoutWalletSession("Guest", false);
    resetAccountScopedState("Wallet connected - authentication failed", selectedWallet);
  }
}

async function handleWalletChainChanged() {
  if (isDemoModeEnabled()) return;

  resetAccountScopedState("Network changed...");
  await logoutWalletSession("Network changed...", false);
  try {
    const status = await window.KryptoVaultBlockchain?.getCurrentNetworkStatus?.();
    if (status && !status.isExpectedChain) {
      toast(`Network changed. Switch MetaMask to ${status.expectedChainName || "Sepolia"} and sign in again.`);
      return;
    }

    const selectedWallet = await getSelectedMetaMaskAccount();
    if (selectedWallet) {
      await initializeWalletSession(selectedWallet, "Network changed...");
      toast("Network changed. Session re-authenticated.");
      return;
    }
  } catch (_) {}

  toast("Network changed. Please sign in again.");
}

function registerWalletEvents() {
  if (!window.ethereum?.on) return;
  if (walletEventsRegistered) return;

  window.ethereum.on("accountsChanged", handleWalletAccountChanged);
  window.ethereum.on("chainChanged", handleWalletChainChanged);
  walletEventsRegistered = true;
}

window.KryptoVaultState = {
  isDemoModeEnabled,
  loadAuthenticatedUser,
  loadKycStatus,
  loadOwnedAssets,
  loadSharedAssets,
  loadFolders,
  loadAuditActivity,
  loadBlockchainRecords,
  loadBackendState
};

window.KryptoVaultAuth = {
  authenticateWallet,
  logout: logoutWalletSession,
  refreshAuthenticatedUser,
  saveUserProfile,
  mockVerifyKyc
};

function toast(message) {
  const el = document.getElementById("toast");
  if (toastTimer) clearTimeout(toastTimer);
  el.classList.remove("action-toast");
  el.textContent = message;
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function toastAction(message, actionLabel, action) {
  const el = document.getElementById("toast");
  if (toastTimer) clearTimeout(toastTimer);
  el.textContent = "";
  const text = document.createElement("span");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toast-action";
  button.textContent = actionLabel;
  button.addEventListener("click", action);
  el.append(text, button);
  el.classList.add("action-toast");
  el.classList.add("show");
}

function isWrongNetworkError(error) {
  return error?.code === "WRONG_NETWORK";
}

function showNetworkSwitchAction(error) {
  const chainName = error?.details?.expectedChainName || "Sepolia";
  toastAction(error?.message || `Wrong network. Switch MetaMask to ${chainName}.`, `Switch to ${chainName}`, async () => {
    try {
      await window.KryptoVaultBlockchain.switchToExpectedChain();
      toast(`MetaMask switched to ${chainName}.`);
      renderAll();
    } catch (switchError) {
      toast(switchError?.message || `Could not switch to ${chainName}.`);
    }
  });
}

function toastError(error, fallbackMessage) {
  if (isWrongNetworkError(error) && window.KryptoVaultBlockchain?.switchToExpectedChain) {
    showNetworkSwitchAction(error);
    return;
  }

  toast(error?.message || fallbackMessage);
}

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

function fmtDate(ts) {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function shortHash(h) {
  if (!h) return "—";
  return `${h.slice(0, 10)}...${h.slice(-8)}`;
}
function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return "0x" + [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256File(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function addActivity(action, detail) {
  state.activities.unshift({
    id: crypto.randomUUID(),
    action, detail, time: Date.now()
  });
}
function folderName(id) {
  return state.folders.find(f => f.id === id)?.name || "Unfiled";
}

function activeDocumentTabName() {
  return document.querySelector("[data-doc-tab].active")?.dataset.docTab || "overview";
}

function switchPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === name));
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add("active");
  document.getElementById("pageTitle").textContent = ({
    dashboard: "Dashboard",
    documents: "My Documents",
    shared: "Shared With Me",
    folders: "Folders",
    activity: "Activity",
    blockchain: "Blockchain Records",
    account: "Account",
    security: "Security",
    settings: "Settings"
  })[name] || "KryptoVault";

  if (name === "activity" && !isDemoModeEnabled()) {
    const generation = accountStateGeneration;
    loadAuditActivity().then((activities) => {
      if (generation !== accountStateGeneration) return;
      state.activities = activities;
      renderActivity();
    });
  }
}

function applyTheme() {
  const theme = state.settings?.theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById("themeToggle");
  if (toggle) toggle.checked = theme === "light";
}

function renderAll() {
  applyTheme();
  renderHeader();
  renderDashboard();
  renderDocuments();
  renderShared();
  renderFolders();
  renderActivity();
  renderBlockchain();
  renderAccount();
  renderSecurity();
  renderSettings();
  populateFolderSelect();
  if (currentDocId) renderDocumentModal();
}

function renderHeader() {
  document.getElementById("welcomeName").textContent = state.user.name;
  const kycPill = document.getElementById("kycPill");
  kycPill.textContent = `Mock KYC: ${isKycVerified() ? "Verified" : "Pending"}`;
  kycPill.classList.toggle("verified", isKycVerified());

  const walletBtn = document.getElementById("walletBtn");
  walletBtn.textContent = state.user.walletAddress
    ? `${state.user.walletAddress.slice(0, 6)}...${state.user.walletAddress.slice(-4)}`
    : "Connect Wallet";
}

function renderDashboard() {
  document.getElementById("statDocs").textContent = state.documents.length;
  document.getElementById("statShared").textContent = state.shared.length;
  const verified = state.documents.filter(d => d.blockchainVerificationStatus === "verified" || d.verified).length;
  document.getElementById("statVerified").textContent = `${verified}/${state.documents.length}`;
  document.getElementById("statStorage").textContent = fmtSize(state.documents.reduce((a, d) => a + Number(d.size || 0), 0));
  document.getElementById("recentDocs").innerHTML = documentsTable(state.documents.slice(0, 5), true);
}

function documentsTable(docs, compact = false) {
  if (!docs.length) return `<div class="empty-state">No documents yet.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Status</th><th>Folder</th><th>Access</th><th>Uploaded</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${docs.map(d => `
            <tr>
              <td><span class="file-name">${escapeHtml(d.name)}</span><br><span class="muted">${fmtSize(d.size)}</span></td>
              <td><span class="badge ${d.verified ? "green" : "red"}">${d.verified ? "Verified ✓" : "Unverified"}</span></td>
              <td>${escapeHtml(folderName(d.folderId))}</td>
              <td>${documentAccessLabel(d)}</td>
              <td>${fmtDate(d.createdAt)}</td>
              <td class="actions-cell">
                <button class="btn secondary small" onclick="openDocument('${d.id}')">Open</button>
                ${compact ? "" : `<button class="btn ghost small" onclick="moveDocument('${d.id}')">Move</button>`}
                ${compact ? "" : `<button class="btn ghost small" onclick="openShare('${d.id}')">Share</button>`}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function documentAccessLabel(doc) {
  if (isDemoModeEnabled()) {
    const active = doc.permissions.filter(p => p.active).length;
    return active ? `${active} user(s)` : "Private";
  }

  if (doc.accessGrantsLoadedFor === doc.id) {
    const active = doc.accessGrants.filter(p => p.status === "ACTIVE").length;
    return active ? `${active} user(s)` : "Private";
  }

  return "Manage";
}

function renderDocuments() {
  const q = (document.getElementById("docSearch")?.value || "").toLowerCase();
  const docs = state.documents.filter(d => d.name.toLowerCase().includes(q));
  document.getElementById("documentsList").innerHTML = documentsTable(docs);
}

function renderShared() {
  const el = document.getElementById("sharedList");
  if (!state.shared.length) {
    el.innerHTML = `<div class="empty-state">Nothing has been shared with this wallet yet.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Document</th><th>Owner</th><th>Permission</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${state.shared.map(s => `
            <tr>
              <td class="file-name">${escapeHtml(s.name)}</td>
              <td>${escapeHtml(s.owner)}</td>
              <td><span class="badge blue">${escapeHtml(s.access)}</span></td>
              <td>${fmtDate(s.expiresAt)}</td>
              <td>${blockchainStatusBadge(s.status)}</td>
              <td><button class="btn secondary small" onclick="openSharedDocument('${s.id}')">Open</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFolders() {
  const el = document.getElementById("foldersGrid");
  if (!state.folders.length) {
    el.innerHTML = `<div class="empty-state">No folders yet. Create your first folder.</div>`;
    return;
  }
  el.innerHTML = state.folders.map(f => {
    const count = state.documents.filter(d => d.folderId === f.id).length;
    return `
      <button class="folder-card" type="button" onclick="openFolder('${f.id}')">
        <div class="folder-icon">📁</div>
        <strong>${escapeHtml(f.name)}</strong>
        <small>${count} document${count === 1 ? "" : "s"}</small>
        <span class="folder-open-label">Open folder →</span>
      </button>
    `;
  }).join("");
}

window.openFolder = async function(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;
  document.getElementById("folderViewTitle").textContent = folder.name;
  document.getElementById("folderViewMeta").textContent = "Loading documents...";
  document.getElementById("folderDocuments").innerHTML = `<div class="empty-state">Loading documents...</div>`;
  openModal("folderViewModal");

  if (isDemoModeEnabled()) {
    const docs = state.documents.filter(d => d.folderId === folderId);
    document.getElementById("folderViewMeta").textContent = `${docs.length} document${docs.length === 1 ? "" : "s"}`;
    document.getElementById("folderDocuments").innerHTML = documentsTable(docs);
    return;
  }

  try {
    const response = await window.KryptoVaultApi.get("/api/assets/my", { query: { folderId } });
    const docs = (response?.assets || []).map(normalizeBackendAsset);
    state.documents = [
      ...state.documents.filter(d => d.folderId !== folderId),
      ...docs
    ];
    renderFolders();
    document.getElementById("folderViewMeta").textContent = `${docs.length} document${docs.length === 1 ? "" : "s"}`;
    document.getElementById("folderDocuments").innerHTML = documentsTable(docs);
  } catch (error) {
    document.getElementById("folderViewMeta").textContent = "Unable to load documents";
    document.getElementById("folderDocuments").innerHTML = `<div class="empty-state">${escapeHtml(error?.message || "Folder documents could not be loaded.")}</div>`;
  }
};

function renderActivity() {
  const el = document.getElementById("activityTimeline");
  const clearBtn = document.getElementById("clearActivityBtn");
  if (clearBtn) {
    clearBtn.hidden = !isDemoModeEnabled();
    clearBtn.disabled = !isDemoModeEnabled();
  }

  if (!state.activities.length) {
    el.innerHTML = `<div class="empty-state">No activity yet.</div>`;
    return;
  }
  el.innerHTML = state.activities.map(a => `
    <div class="timeline-item">
      <div class="timeline-time">${fmtDate(a.time)}</div>
      <div class="timeline-line"><div class="timeline-dot"></div></div>
      <div class="timeline-content"><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(a.detail)}</span></div>
    </div>
  `).join("");
}

function renderBlockchain() {
  const el = document.getElementById("blockchainList");
  if (isDemoModeEnabled()) {
    if (!state.documents.length) {
      el.innerHTML = `<div class="empty-state">No blockchain records.</div>`;
      return;
    }

    el.innerHTML = renderBlockchainTable(state.documents.map(d => ({
      assetId: d.id,
      filename: d.name,
      ownerWallet: state.user.walletAddress,
      currentHash: d.hash,
      currentVersion: d.currentVersion || 1,
      registrationTxHash: d.txHash,
      blockNumber: d.blockNumber,
      status: d.verified ? "VERIFIED" : "PENDING"
    })));
    return;
  }

  if (!state.user.walletAddress) {
    el.innerHTML = `<div class="empty-state">Connect your wallet to view blockchain records.</div>`;
    return;
  }

  const requestId = ++blockchainRecordsRequestId;
  el.innerHTML = `<div class="empty-state">Loading blockchain records...</div>`;

  window.KryptoVaultApi.get("/api/blockchain/records")
    .then((response) => {
      if (requestId !== blockchainRecordsRequestId) return;
      const records = (response?.records || []).map(normalizeBlockchainRecord);
      el.innerHTML = records.length ? renderBlockchainTable(records) : `<div class="empty-state">No blockchain records.</div>`;
    })
    .catch((error) => {
      if (requestId !== blockchainRecordsRequestId) return;
      el.innerHTML = `<div class="empty-state">${escapeHtml(error?.message || "Blockchain records could not be loaded.")}</div>`;
    });
}

function renderAccount() {
  document.getElementById("profileName").value = state.user.name;
  document.getElementById("profileEmail").value = state.user.email;
  document.getElementById("profileWallet").value = state.user.walletAddress || "Not connected";
  document.getElementById("kycDescription").textContent = isKycVerified()
    ? "Mock KYC verified for this demo account."
    : "Select a demo document, then run mock KYC. The file is never uploaded.";
}

function calculateSecurityScore() {
  let score = 30; // Base score for SHA-256 integrity + protected workflow.
  if (isKycVerified()) score += 20;
  if (state.user.walletAddress) score += 20;
  if (state.settings.requireKyc) score += 10;
  if (state.settings.requireWallet) score += 10;
  if (!state.documents.length || state.documents.every(d => d.verified && !d.tampered)) score += 10;
  return Math.min(score, 100);
}

function renderSecurity() {
  const kyc = document.getElementById("securityKycStatus");
  const wallet = document.getElementById("securityWalletStatus");
  const hash = document.getElementById("securityHashStatus");
  const docs = document.getElementById("securityDocumentStatus");
  const scoreEl = document.getElementById("securityScore");
  const scoreText = document.getElementById("securityScoreText");
  if (!kyc || !wallet || !hash || !docs || !scoreEl || !scoreText) return;

  const kycVerified = isKycVerified();
  kyc.textContent = kycVerified
    ? "Mock KYC verified"
    : "Mock KYC pending";
  kyc.parentElement?.classList.toggle("secure", kycVerified);
  kyc.parentElement?.classList.toggle("warning", !kycVerified);

  const walletConnected = !!state.user.walletAddress;
  wallet.textContent = walletConnected
    ? `✓ Connected: ${shortHash(state.user.walletAddress)}`
    : "⚠ Wallet not connected";
  wallet.parentElement?.classList.toggle("secure", walletConnected);
  wallet.parentElement?.classList.toggle("warning", !walletConnected);

  hash.textContent = "✓ SHA-256 browser verification active";
  hash.parentElement?.classList.add("secure");

  const verifiedDocs = state.documents.filter(d => d.verified && !d.tampered).length;
  const documentsSecure = !state.documents.length || verifiedDocs === state.documents.length;
  docs.textContent = `${verifiedDocs}/${state.documents.length} documents currently verified`;
  docs.parentElement?.classList.toggle("secure", documentsSecure);
  docs.parentElement?.classList.toggle("warning", !documentsSecure);

  const score = calculateSecurityScore();
  scoreEl.textContent = `${score}%`;
  scoreText.textContent = score >= 90
    ? "Strong protection"
    : score >= 70
      ? "Good protection"
      : "Security setup incomplete";

  const fill = document.getElementById("securityScoreFill");
  if (fill) fill.style.width = `${score}%`;
}

function renderSettings() {
  document.getElementById("requireKyc").checked = !!state.settings.requireKyc;
  document.getElementById("requireWallet").checked = !!state.settings.requireWallet;
  document.getElementById("showProgress").checked = !!state.settings.showProgress;
}

function populateFolderSelect() {
  const sel = document.getElementById("uploadFolder");
  sel.innerHTML = `
    <option value="">Unfiled</option>
    ${state.folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("")}
  `;
}

function resetUploadModal() {
  selectedUploadFile = null;
  document.getElementById("uploadFile").value = "";
  document.getElementById("selectedFileLabel").textContent = "No file selected";
  document.getElementById("uploadPassword").value = "";
  document.getElementById("uploadStepForm").classList.remove("hidden");
  document.getElementById("uploadProgress").classList.add("hidden");
  document.getElementById("uploadSuccess").classList.add("hidden");
}

async function startSecureUpload() {
  const file = selectedUploadFile;
  if (!file) return toast("Choose a file first.");

  document.getElementById("uploadStepForm").classList.add("hidden");
  document.getElementById("uploadProgress").classList.remove("hidden");

  const steps = [
    "Reading file metadata",
    "Generating SHA-256 fingerprint",
    "Simulating AES-256 encryption layer",
    "Saving protected file record",
    "Registering mock blockchain ownership",
    "Completing audit log"
  ];

  const progressEl = document.getElementById("progressSteps");
  progressEl.innerHTML = steps.map((s, i) => `<div class="progress-step" id="prog-${i}"><span class="marker">○</span><span>${s}</span></div>`).join("");

  let hash = "";
  for (let i = 0; i < steps.length; i++) {
    const row = document.getElementById(`prog-${i}`);
    row.classList.add("active");
    row.querySelector(".marker").textContent = "…";

    if (i === 1) hash = await sha256File(file);
    await delay(state.settings.showProgress ? 420 : 50);

    row.classList.remove("active");
    row.classList.add("done");
    row.querySelector(".marker").textContent = "✓";
  }

  const doc = {
    id: `doc-${Date.now()}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    folderId: document.getElementById("uploadFolder").value || null,
    accessType: document.getElementById("uploadAccess").value,
    hash,
    verified: true,
    txHash: randomHex(32),
    blockNumber: 190000 + Math.floor(Math.random() * 9999),
    createdAt: Date.now(),
    permissions: []
  };

  state.documents.unshift(doc);
  addActivity("Document uploaded", `${doc.name} added to protected storage`);
  addActivity("Blockchain proof registered", `${doc.name} fingerprint ${shortHash(doc.hash)} recorded`);
  saveState();

  document.getElementById("uploadProgress").classList.add("hidden");
  document.getElementById("uploadSuccess").classList.remove("hidden");
  document.getElementById("successHash").textContent = hash;
}

async function startEncryptedUpload() {
  if (isDemoModeEnabled()) {
    return startSecureUpload();
  }

  const file = selectedUploadFile;
  if (!file) return toast("Choose a file first.");
  if (!state.user.walletAddress) return toast("Connect and authenticate your wallet before uploading.");
  if (!window.KryptoVaultCrypto) return toast("Document encryption support is not available.");
  if (!window.KryptoVaultApi) return toast("API client is not available.");
  if (!window.KryptoVaultBlockchain) return toast("Blockchain support is not available.");

  document.getElementById("uploadStepForm").classList.add("hidden");
  document.getElementById("uploadProgress").classList.remove("hidden");
  document.getElementById("uploadSuccess").classList.add("hidden");

  const steps = [
    "Reading plaintext file locally",
    "Calculating plaintext SHA-256 fingerprint",
    "Generating random AES-256-GCM key",
    "Encrypting file locally with unique IV",
    "Wrapping AES key with owner public key or password",
    "Uploading ciphertext and safe metadata",
    "Registering asset hash with MetaMask",
    "Confirming blockchain transaction",
    "Syncing verified blockchain registration"
  ];

  const progressEl = document.getElementById("progressSteps");
  progressEl.innerHTML = steps.map((step, index) => `<div class="progress-step" id="real-prog-${index}"><span class="marker">...</span><span>${step}</span></div>`).join("");

  async function completeStep(index, operation) {
    const row = document.getElementById(`real-prog-${index}`);
    row.classList.add("active");
    row.querySelector(".marker").textContent = "...";
    const result = operation ? await operation() : undefined;
    await delay(state.settings.showProgress ? 420 : 50);
    row.classList.remove("active");
    row.classList.add("done");
    row.querySelector(".marker").textContent = "OK";
    return result;
  }

  try {
    const password = document.getElementById("uploadPassword").value;
    const passwordProtectionEnabled = password.length > 0;
    const ownerIdentity = passwordProtectionEnabled
      ? null
      : await window.KryptoVaultCrypto.getDocumentEncryptionIdentity(state.user.walletAddress);
    const plaintext = await completeStep(0, () => file.arrayBuffer());
    const sha256 = await completeStep(1, () => window.KryptoVaultCrypto.sha256Hex(plaintext));
    const aesKey = await completeStep(2, () => window.KryptoVaultCrypto.generateDocumentAesKey());
    const encrypted = await completeStep(3, () => window.KryptoVaultCrypto.encryptBytesWithAesGcm(plaintext, aesKey));
    const wrappedKey = await completeStep(4, async () => {
      if (passwordProtectionEnabled) {
        return window.KryptoVaultCrypto.wrapDocumentAesKeyWithPassword(aesKey, password);
      }

      return {
        wrappedAESKey: await window.KryptoVaultCrypto.wrapDocumentAesKey(aesKey, ownerIdentity.publicEncryptionKey),
        wrappingMetadata: {
          algorithm: "RSA-OAEP",
          keyId: ownerIdentity.keyId
        }
      };
    });
    const uploadResult = await completeStep(5, async () => {
      const form = new FormData();
      const folderId = document.getElementById("uploadFolder").value;

      form.append("filename", file.name);
      form.append("mimeType", file.type || "application/octet-stream");
      form.append("originalSize", String(file.size));
      form.append("sha256", sha256);
      form.append("wrappedAESKey", wrappedKey.wrappedAESKey);
      form.append("encryptionMetadata", JSON.stringify(encrypted.encryptionMetadata));
      form.append("wrappingMetadata", JSON.stringify(wrappedKey.wrappingMetadata));
      form.append("passwordProtectionEnabled", passwordProtectionEnabled ? "true" : "false");
      if (folderId) form.append("folderId", folderId);
      form.append("encryptedFile", new Blob([encrypted.encryptedBytes], { type: "application/octet-stream" }), `${file.name}.enc`);

      return window.KryptoVaultApi.post("/api/assets", form);
    });

    const assetId = uploadResult?.asset?.id;
    if (!assetId) {
      throw new Error("Backend did not return an asset ID for blockchain registration.");
    }

    const registrationTx = await completeStep(6, () => window.KryptoVaultBlockchain.registerAsset(assetId, sha256));
    const receipt = await completeStep(7, () => registrationTx.wait(1));
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error("Blockchain registration transaction failed.");
    }
    await completeStep(8, () =>
      window.KryptoVaultApi.post(`/api/assets/${assetId}/blockchain-sync`, {
        transactionHash: registrationTx.hash
      })
    );

    await refreshWorkspaceState();
    document.getElementById("uploadProgress").classList.add("hidden");
    document.getElementById("uploadSuccess").classList.remove("hidden");
    document.getElementById("successHash").textContent = sha256;
    toast("Encrypted file uploaded and registered on-chain.");
  } catch (error) {
    document.getElementById("uploadStepForm").classList.remove("hidden");
    document.getElementById("uploadProgress").classList.add("hidden");
    toastError(error, "Encrypted upload failed.");
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

window.openDocument = function(id) {
  currentDocId = id;
  renderDocumentModal();
  openModal("documentModal");
};

function renderDocumentModal() {
  const d = state.documents.find(x => x.id === currentDocId);
  if (!d) return;
  document.getElementById("docModalName").textContent = d.name;

  document.getElementById("doc-tab-overview").innerHTML = `
    <div class="detail-grid">
      <div class="detail-card"><span>Status</span><strong>Verified ✓</strong></div>
      <div class="detail-card"><span>Folder</span><strong>${escapeHtml(folderName(d.folderId))}</strong></div>
      <div class="detail-card"><span>File Size</span><strong>${fmtSize(d.size)}</strong></div>
      <div class="detail-card"><span>Uploaded</span><strong>${fmtDate(d.createdAt)}</strong></div>
      <div class="detail-card" style="grid-column:1/-1"><span>SHA-256 Fingerprint</span><code>${d.hash}</code></div>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn primary" onclick="openDecryptedDocument('${d.id}')">Open File</button>
      <button class="btn secondary" onclick="verifyIntegrity('${d.id}')">Verify Integrity</button>
      <button class="btn secondary" onclick="openShare('${d.id}')">Share</button>
      ${isDemoModeEnabled() ? `<button class="btn ghost" onclick="simulateTamper('${d.id}')">Simulate Tampering</button>` : ""}
    </div>
    <div class="inline-note" style="margin-top:14px">
      This demo does not upload plaintext file bytes to a server. It calculates a real SHA-256 hash in your browser and keeps mock records local to explicit demo mode.
    </div>
  `;

  const activePerms = isDemoModeEnabled()
    ? d.permissions.filter(p => p.active).map(p => ({ ...p, status: "ACTIVE" }))
    : d.accessGrants || [];
  const shouldLoadAccessGrants = !isDemoModeEnabled() && activeDocumentTabName() === "access" && d.accessGrantsLoadedFor !== d.id;
  if (shouldLoadAccessGrants && !d.accessGrantsLoading) {
    setTimeout(() => loadDocumentAccessGrants(d), 0);
  }
  document.getElementById("doc-tab-access").innerHTML = shouldLoadAccessGrants ? `<div class="empty-state">Loading access grants...</div>` : activePerms.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Recipient</th><th>Permission</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${activePerms.map(p => `
            <tr>
              <td class="file-name">${escapeHtml(p.name)}<br><span class="muted">${escapeHtml(p.recipient || p.wallet)}</span></td>
              <td><span class="badge blue">${p.role}</span></td>
              <td>${fmtDate(p.expiresAt)}</td>
              <td><span class="badge ${p.status === "ACTIVE" ? "green" : p.status === "EXPIRED" ? "blue" : "red"}">${escapeHtml(p.status || "ACTIVE")}</span></td>
              <td><button class="btn danger small" onclick="openRevoke('${d.id}','${p.id}')" ${p.status === "ACTIVE" ? "" : "disabled"}>Revoke</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="empty-state">This document is private. <br><br><button class="btn primary" onclick="openShare('${d.id}')">Grant Access</button></div>`;

  const activityTabActive = activeDocumentTabName() === "activity";
  const shouldLoadDocumentActivity = !isDemoModeEnabled() && activityTabActive && d.activityLoadedFor !== d.id;
  if (shouldLoadDocumentActivity && !d.activityLoading) {
    setTimeout(() => {
      loadDocumentActivity(d).then(() => {
        if (currentDocId === d.id && activeDocumentTabName() === "activity") renderDocumentModal();
      });
    }, 0);
  }
  const acts = isDemoModeEnabled() ? state.activities.filter(a => a.detail.includes(d.name)) : d.activity || [];
  document.getElementById("doc-tab-activity").innerHTML = acts.length
    ? acts.map(a => `<div class="detail-card" style="margin-bottom:8px"><strong>${escapeHtml(a.action)}</strong><br><span class="muted">${escapeHtml(a.detail)} • ${fmtDate(a.time)}</span></div>`).join("")
    : `<div class="empty-state">No document-specific activity yet.</div>`;

  renderDocumentBlockchainTab(d);
}

function normalizeHexHash(value) {
  return String(value || "").trim().replace(/^0x/i, "").toLowerCase();
}

function safeBlobFilename(filename) {
  const fallback = "kryptovault-document";
  return String(filename || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim() || fallback;
}

function openPlaintextBlob(plaintext, filename, mimeType) {
  const blob = new Blob([plaintext], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");

  if (!opened) {
    const link = document.createElement("a");
    link.href = url;
    link.download = safeBlobFilename(filename);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function recoverOpenedAssetAesKey(openedAsset, documentHint) {
  const wrappedAESKey = openedAsset.EK_User;
  const wrappingMetadata = openedAsset.wrappingMetadata;

  if (!wrappedAESKey || !wrappingMetadata) {
    throw new Error("Wrapped document key is missing for this wallet.");
  }

  let password;
  if (documentHint?.passwordProtectionEnabled || wrappingMetadata.algorithm === "PBKDF2-SHA-256+A256GCM") {
    password = window.prompt("Enter this file's password.");
    if (!password) {
      throw new Error("File password is required to open this password-protected document.");
    }
  }

  return window.KryptoVaultCrypto.recoverDocumentAesKey({
    wrappedAESKey,
    wrappingMetadata,
    walletAddress: state.user.walletAddress,
    password
  });
}

async function decryptEncryptedAsset(assetId, documentHint = {}) {
  if (!window.KryptoVaultApi) throw new Error("Document API is not available.");
  if (!window.KryptoVaultCrypto) throw new Error("Document encryption support is not available.");
  if (!state.user.walletAddress) throw new Error("Connect and authenticate your wallet before opening documents.");

  const openResponse = await window.KryptoVaultApi.get(`/api/assets/${encodeURIComponent(assetId)}/open`);
  const openedAsset = openResponse?.asset || {};
  const ciphertextUrl = openedAsset.ciphertextUrl;
  if (!ciphertextUrl) {
    throw new Error("Encrypted document bytes are not available.");
  }

  const aesKey = await recoverOpenedAssetAesKey(openedAsset, documentHint);
  const ciphertext = await window.KryptoVaultApi.get(ciphertextUrl, { responseType: "arrayBuffer" });
  const plaintext = await window.KryptoVaultCrypto.decryptBytesWithAesGcm(
    ciphertext,
    aesKey,
    openedAsset.encryptionMetadata
  );

  const actualSha256 = await window.KryptoVaultCrypto.sha256Hex(plaintext);
  const expectedSha256 = normalizeHexHash(openedAsset.expectedSha256 || openedAsset.sha256 || documentHint.hash);
  if (!expectedSha256 || normalizeHexHash(actualSha256) !== expectedSha256) {
    throw new Error("Document integrity check failed. The decrypted bytes do not match the authoritative SHA-256 hash.");
  }

  return {
    filename: openedAsset.filename || documentHint.name,
    mimeType: openedAsset.mimeType || documentHint.mimeType,
    plaintext,
    expectedSha256,
    sha256: actualSha256,
    permission: openedAsset.permission,
    currentVersion: openedAsset.currentVersion
  };
}

async function openEncryptedAsset(assetId, documentHint = {}) {
  const decrypted = await decryptEncryptedAsset(assetId, documentHint);
  openPlaintextBlob(decrypted.plaintext, decrypted.filename, decrypted.mimeType);
  return decrypted;
}

window.openDecryptedDocument = async function(docId) {
  const doc = state.documents.find(x => x.id === docId);
  if (!doc) return;

  if (isDemoModeEnabled()) {
    toast("Demo mode does not store encrypted document bytes.");
    return;
  }

  try {
    const opened = await openEncryptedAsset(doc.id, doc);
    addActivity("Document opened", `${opened.filename || doc.name} decrypted locally after integrity verification`);
    saveState();
    toast("Document decrypted locally and integrity verified.");
  } catch (error) {
    toast(error?.message || "Document could not be opened.");
  }
};

async function loadDocumentAccessGrants(doc, force = false) {
  const target = document.getElementById("doc-tab-access");
  if (!window.KryptoVaultApi) {
    target.innerHTML = `<div class="empty-state">Access API is not available.</div>`;
    return [];
  }
  if (!force && doc.accessGrantsLoadedFor === doc.id) {
    return doc.accessGrants;
  }

  doc.accessGrantsLoading = true;
  if (currentDocId === doc.id) {
    target.innerHTML = `<div class="empty-state">Loading access grants...</div>`;
  }

  try {
    const response = await window.KryptoVaultApi.get(`/api/assets/${encodeURIComponent(doc.id)}/access`);
    const latestDoc = state.documents.find(item => item.id === doc.id) || doc;
    latestDoc.accessGrants = (response?.access || []).map(normalizeBackendAccessGrant);
    latestDoc.accessGrantsLoadedFor = doc.id;
    latestDoc.accessGrantsLoading = false;
    if (currentDocId === doc.id) {
      renderDocumentModal();
    }
    renderDashboard();
    renderDocuments();
    return latestDoc.accessGrants;
  } catch (error) {
    doc.accessGrantsLoading = false;
    if (currentDocId === doc.id) {
      target.innerHTML = `<div class="empty-state">${escapeHtml(error?.message || "Access grants could not be loaded.")}</div>`;
    }
    return [];
  }
}

function renderDocumentBlockchainTab(doc) {
  const target = document.getElementById("doc-tab-blockchain");

  function renderDetail(record) {
    const latest = record.latestKnownTransaction;
    target.innerHTML = `
      <div class="detail-grid">
        <div class="detail-card"><span>Document</span><strong>${escapeHtml(record.filename || doc.name)}</strong></div>
        <div class="detail-card"><span>Owner</span><strong>${record.ownerWallet ? shortHash(record.ownerWallet) : "Pending"}</strong></div>
        <div class="detail-card"><span>Version</span><strong>${record.currentVersion || "Pending"}</strong></div>
        <div class="detail-card"><span>Confirmation</span><strong>${escapeHtml(String(record.confirmationState || record.status || "pending").replaceAll("_", " "))}</strong></div>
        <div class="detail-card"><span>Registration Block</span><strong>${record.blockNumber || "Pending"}</strong></div>
        <div class="detail-card"><span>Record Status</span><strong>${escapeHtml(String(record.status || "pending").replaceAll("_", " "))}</strong></div>
        <div class="detail-card" style="grid-column:1/-1"><span>Registration Transaction</span><code>${record.registrationTxHash || "Pending"}</code></div>
        <div class="detail-card" style="grid-column:1/-1"><span>Current Hash</span><code>${record.currentHash || doc.hash || "Pending"}</code></div>
        <div class="detail-card" style="grid-column:1/-1">
          <span>Latest Chain Action</span>
          <strong>${latest ? escapeHtml(String(latest.action || "").replaceAll("_", " ")) : "None known"}</strong>
          <br><span class="muted">${latest?.detail ? escapeHtml(latest.detail) : "No grant, revoke, or version transaction recorded yet."}</span>
          ${latest?.blockchainTxHash ? `<br><code>${escapeHtml(latest.blockchainTxHash)}</code>` : ""}
        </div>
      </div>
    `;
  }

  if (isDemoModeEnabled()) {
    renderDetail({
      filename: doc.name,
      ownerWallet: state.user.walletAddress,
      currentHash: doc.hash,
      registrationTxHash: doc.txHash,
      blockNumber: doc.blockNumber,
      status: doc.verified ? "VERIFIED" : "PENDING",
      confirmationState: doc.verified ? "CONFIRMED" : "PENDING",
      latestKnownTransaction: doc.txHash
        ? {
            action: "DOCUMENT_REGISTERED",
            detail: "Demo blockchain proof recorded",
            blockchainTxHash: doc.txHash
          }
        : null
    });
    return;
  }

  if (doc.blockchainDetail && doc.blockchainDetailLoadedFor === doc.id) {
    renderDetail(doc.blockchainDetail);
    return;
  }

  if (doc.blockchainDetailLoading) {
    target.innerHTML = `<div class="empty-state">Loading blockchain record...</div>`;
    return;
  }

  doc.blockchainDetailLoading = true;
  target.innerHTML = `<div class="empty-state">Loading blockchain record...</div>`;

  window.KryptoVaultApi.get(`/api/assets/${doc.id}/blockchain`)
    .then((response) => {
      const latestDoc = state.documents.find(item => item.id === doc.id) || doc;
      latestDoc.blockchainDetail = normalizeBlockchainRecord(response?.blockchain || {});
      latestDoc.blockchainDetailLoadedFor = doc.id;
      latestDoc.blockchainDetailLoading = false;
      if (currentDocId === doc.id) {
        renderDetail(latestDoc.blockchainDetail);
      }
    })
    .catch((error) => {
      doc.blockchainDetailLoading = false;
      if (currentDocId === doc.id) {
        target.innerHTML = `<div class="empty-state">${escapeHtml(error?.message || "Blockchain record could not be loaded.")}</div>`;
      }
    });
}

window.openShare = function(docId) {
  currentDocId = docId;
  if (state.settings.requireKyc && !isKycVerified()) {
    toast("Demo policy: complete KYC before sharing.");
    switchPage("account");
    return;
  }
  if (state.settings.requireWallet && !state.user.walletAddress) {
    toast("Demo policy: connect wallet before blockchain actions.");
    return;
  }
  document.getElementById("shareName").value = "";
  document.getElementById("shareRecipient").value = "";
  document.getElementById("shareReason").value = "";
  openModal("shareModal");
};

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function unixNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function accessWindowFromDurationDays(days) {
  const duration = Number(days);
  if (!duration) {
    return {
      validFrom: 0,
      validUntil: 0,
      expiresAt: null
    };
  }

  const validFrom = 0;
  const validUntil = unixNowSeconds() + duration * 86400;
  return {
    validFrom,
    validUntil,
    expiresAt: validUntil * 1000
  };
}

async function recoverOwnerDocumentAesKey(doc) {
  if (!doc.blockchainAssetId) {
    throw new Error("This document must be registered on-chain before sharing.");
  }

  const openResponse = await window.KryptoVaultApi.get(`/api/assets/${encodeURIComponent(doc.id)}/open`);
  const openedAsset = openResponse?.asset || {};
  const wrappingMetadata = openedAsset.wrappingMetadata;
  const wrappedAESKey = openedAsset.EK_User;

  if (!wrappedAESKey || !wrappingMetadata) {
    throw new Error("Owner wrapped key metadata is missing for this document.");
  }

  let password;
  if (doc.passwordProtectionEnabled || wrappingMetadata.algorithm === "PBKDF2-SHA-256+A256GCM") {
    password = window.prompt("Enter this file's password to share it.");
    if (!password) {
      throw new Error("File password is required to share this password-protected document.");
    }
  }

  return window.KryptoVaultCrypto.recoverDocumentAesKey({
    wrappedAESKey,
    wrappingMetadata,
    walletAddress: state.user.walletAddress,
    password
  });
}

async function grantAccess() {
  const d = state.documents.find(x => x.id === currentDocId);
  if (!d) return;
  const displayName = document.getElementById("shareName").value.trim();
  const recipient = document.getElementById("shareRecipient").value.trim();
  if (!recipient) return toast("Enter recipient wallet address.");

  const duration = Number(document.getElementById("shareDuration").value);
  const accessType = document.getElementById("shareRole").value;
  const reason = document.getElementById("shareReason").value.trim();

  if (isDemoModeEnabled()) {
    const p = {
      id: crypto.randomUUID(),
      name: displayName || shortHash(recipient),
      recipient,
      wallet: recipient.startsWith("0x") ? recipient : randomHex(20),
      role: accessType,
      expiresAt: duration ? Date.now() + duration * 86400000 : null,
      reason,
      active: true
    };
    d.permissions.push(p);
    d.txHash = randomHex(32);
    addActivity("Access granted", `${p.name} received ${p.role} access to ${d.name}`);
    addActivity("Blockchain permission recorded", `Mock permission transaction created for ${d.name}`);
    closeModal("shareModal");
    saveState();
    toast("Access granted and mock transaction recorded.");
    return;
  }

  if (!isWalletAddress(recipient)) return toast("Enter a valid recipient wallet address.");
  if (accessType !== "READ" && accessType !== "WRITE") return toast("Choose READ or WRITE access.");
  if (!d.blockchainAssetId || d.blockchainVerificationStatus !== "verified") {
    return toast("This document must be registered and verified on-chain before sharing.");
  }
  if (!window.KryptoVaultApi || !window.KryptoVaultCrypto || !window.KryptoVaultBlockchain) {
    return toast("Sharing services are not available.");
  }

  const grantButton = document.getElementById("grantAccessBtn");
  const previousButtonText = grantButton.textContent;
  grantButton.disabled = true;
  grantButton.textContent = "Granting...";

  try {
    const recipientKey = await window.KryptoVaultCrypto.getPublicEncryptionKey(recipient);
    if (!recipientKey?.publicEncryptionKey) {
      throw new Error("Recipient public encryption key was not found.");
    }

    const aesKey = await recoverOwnerDocumentAesKey(d);
    const wrappedAESKey = await window.KryptoVaultCrypto.wrapDocumentAesKey(aesKey, recipientKey.publicEncryptionKey);
    const wrappingMetadata = {
      algorithm: "RSA-OAEP",
      keyId: `recipient:${recipientKey.walletAddress || recipient.toLowerCase()}`
    };
    const accessWindow = accessWindowFromDurationDays(duration);
    const grantTx = await window.KryptoVaultBlockchain.grantAccess(
      d.blockchainAssetId,
      recipient,
      accessType,
      accessWindow.validFrom,
      accessWindow.validUntil
    );
    const receipt = await grantTx.wait(1);
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error("Blockchain access grant transaction failed.");
    }

    const syncResult = await window.KryptoVaultApi.post(`/api/assets/${d.id}/access/grant-sync`, {
      granteeWallet: recipient,
      wrappedAESKey,
      accessType,
      validFrom: accessWindow.validFrom,
      validUntil: accessWindow.validUntil,
      reason,
      ...(displayName ? { granteeDisplayName: displayName } : {}),
      blockchainTransactionHash: grantTx.hash,
      wrappingMetadata
    });

    await refreshWorkspaceState();
    const refreshedDoc = state.documents.find(x => x.id === d.id) || d;
    await loadDocumentAccessGrants(refreshedDoc, true);
    const syncedGrant = syncResult?.accessGrant;
    const recipientLabel = syncedGrant?.granteeDisplayName || displayName || shortHash(recipient);
    addActivity("Access granted", `${recipientLabel} received ${accessType} access to ${refreshedDoc.name}`);
    addActivity("Blockchain permission recorded", `Access grant transaction ${shortHash(grantTx.hash)} confirmed for ${refreshedDoc.name}`);
    currentDocId = refreshedDoc.id;
    closeModal("shareModal");
    saveState();
    toast("Access granted on-chain.");
  } catch (error) {
    toastError(error, "Access grant failed.");
  } finally {
    grantButton.disabled = false;
    grantButton.textContent = previousButtonText;
  }
}

window.openRevoke = function(docId, permId) {
  const d = state.documents.find(x => x.id === docId);
  const p = isDemoModeEnabled()
    ? d?.permissions.find(x => x.id === permId)
    : (d?.accessGrants || []).find(x => x.id === permId);
  if (!d || !p) return;
  pendingRevoke = { docId, permId };
  document.getElementById("revokeText").textContent = `Revoke ${p.name}'s access to ${d.name}?`;
  const standardMode = document.querySelector('input[name="revokeMode"][value="standard"]');
  const strongMode = document.querySelector('input[name="revokeMode"][value="strong"]');
  if (standardMode) standardMode.checked = true;
  if (strongMode) {
    strongMode.disabled = false;
    strongMode.closest(".radio-card")?.classList.remove("disabled");
  }
  openModal("revokeModal");
};

async function wrapStrongRevokeKeyForRecipients(aesKey, recipients, ownerPassword) {
  return Promise.all(recipients.map(async (recipient) => {
    if (recipient.requiresPasswordWrapping) {
      if (!ownerPassword) {
        throw new Error("File password is required to rotate this password-protected document.");
      }
      const wrapped = await window.KryptoVaultCrypto.wrapDocumentAesKeyWithPassword(aesKey, ownerPassword);
      return {
        walletAddress: recipient.walletAddress,
        wrappedAESKey: wrapped.wrappedAESKey,
        wrappingMetadata: wrapped.wrappingMetadata
      };
    }

    if (!recipient.publicEncryptionKey) {
      throw new Error(`Public encryption key is missing for ${shortHash(recipient.walletAddress)}.`);
    }

    return {
      walletAddress: recipient.walletAddress,
      wrappedAESKey: await window.KryptoVaultCrypto.wrapDocumentAesKey(aesKey, recipient.publicEncryptionKey),
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: `recipient:${recipient.walletAddress}`
      }
    };
  }));
}

async function completeStrongRevokeRotation(doc, granteeWallet, revokeTxHash) {
  if (!window.KryptoVaultCrypto) {
    throw new Error("Document encryption support is not available.");
  }

  const preparation = await window.KryptoVaultApi.post(
    `/api/assets/${encodeURIComponent(doc.id)}/access/strong-revoke/prepare`,
    {
      granteeWallet
    }
  );
  const strongRevoke = preparation?.strongRevoke;
  if (!strongRevoke?.recipients?.length) {
    throw new Error("Backend did not return authorized recipients for strong revocation.");
  }

  const decrypted = await decryptEncryptedAsset(doc.id, doc);
  const expectedSha256 = normalizeHexHash(strongRevoke.expectedSha256);
  if (normalizeHexHash(decrypted.sha256) !== expectedSha256) {
    throw new Error("Current plaintext does not match the authoritative asset hash.");
  }

  const nextAesKey = await window.KryptoVaultCrypto.generateDocumentAesKey();
  const encrypted = await window.KryptoVaultCrypto.encryptBytesWithAesGcm(decrypted.plaintext, nextAesKey);
  const nextSha256 = await window.KryptoVaultCrypto.sha256Hex(decrypted.plaintext);
  let ownerPassword;
  if (strongRevoke.passwordProtectionEnabled) {
    ownerPassword = window.prompt("Enter this file's password to wrap the rotated key.");
    if (!ownerPassword) {
      throw new Error("File password is required to finish strong revocation.");
    }
  }

  const wrappedKeys = await wrapStrongRevokeKeyForRecipients(nextAesKey, strongRevoke.recipients, ownerPassword);
  const revokedWallet = String(granteeWallet || "").trim().toLowerCase();
  if (wrappedKeys.some((key) => String(key.walletAddress || "").trim().toLowerCase() === revokedWallet)) {
    throw new Error("Revoked wallet must not receive the rotated document key.");
  }

  const versionTx = await window.KryptoVaultBlockchain.commitVersion(doc.blockchainAssetId, nextSha256);
  const versionReceipt = await versionTx.wait(1);
  if (!versionReceipt || Number(versionReceipt.status) !== 1) {
    throw new Error("Blockchain version commit transaction failed.");
  }

  const form = new FormData();
  form.append("expectedPreviousVersion", String(strongRevoke.currentVersion));
  form.append("newVersion", String(strongRevoke.nextVersion));
  form.append("sha256", nextSha256);
  form.append("encryptionMetadata", JSON.stringify(encrypted.encryptionMetadata));
  form.append("wrappedKeys", JSON.stringify(wrappedKeys));
  form.append("blockchainTransactionHash", versionTx.hash);
  form.append("commitMessage", `Strong revocation after revoke ${shortHash(revokeTxHash)}`);
  form.append(
    "encryptedFile",
    new Blob([encrypted.encryptedBytes], { type: "application/octet-stream" }),
    `${doc.name}.v${strongRevoke.nextVersion}.enc`
  );

  return window.KryptoVaultApi.post(
    `/api/assets/${encodeURIComponent(doc.id)}/access/strong-revoke/finalize`,
    form
  );
}

async function confirmRevoke() {
  if (!pendingRevoke) return;
  const d = state.documents.find(x => x.id === pendingRevoke.docId);
  const p = isDemoModeEnabled()
    ? d?.permissions.find(x => x.id === pendingRevoke.permId)
    : (d?.accessGrants || []).find(x => x.id === pendingRevoke.permId);
  if (!d || !p) return;
  const mode = document.querySelector('input[name="revokeMode"]:checked').value;

  if (isDemoModeEnabled()) {
    p.active = false;
    d.txHash = randomHex(32);
    addActivity("Access revoked", `${p.name} lost access to ${d.name}`);
    if (mode === "strong") {
      addActivity("Encryption key rotated", `Strong revocation simulated for ${d.name}`);
    }
    closeModal("revokeModal");
    saveState();
    toast(mode === "strong" ? "Access revoked + key rotation simulated." : "Access revoked.");
    return;
  }

  if (!window.KryptoVaultApi || !window.KryptoVaultBlockchain) return toast("Access revocation services are not available.");
  if (!d.blockchainAssetId || d.blockchainVerificationStatus !== "verified") {
    return toast("This document must be registered and verified on-chain before revoking access.");
  }
  if (!isWalletAddress(p.wallet || p.recipient)) return toast("Recipient wallet is invalid.");

  const revokeButton = document.getElementById("confirmRevokeBtn");
  const previousButtonText = revokeButton.textContent;
  revokeButton.disabled = true;
  revokeButton.textContent = mode === "strong" ? "Revoking + rotating..." : "Revoking...";

  try {
    const granteeWallet = p.wallet || p.recipient;
    const tx = await window.KryptoVaultBlockchain.revokeAccess(d.blockchainAssetId, granteeWallet);
    const receipt = await tx.wait(1);
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error("Blockchain revoke transaction failed.");
    }
    await window.KryptoVaultApi.post(`/api/assets/${encodeURIComponent(d.id)}/access/revoke-sync`, {
      granteeWallet,
      blockchainTransactionHash: tx.hash
    });
    if (mode === "strong") {
      await completeStrongRevokeRotation(d, granteeWallet, tx.hash);
    }
    await refreshWorkspaceState();
    const refreshedDoc = state.documents.find(x => x.id === d.id) || d;
    await loadDocumentAccessGrants(refreshedDoc, true);
    addActivity("Access revoked", `${p.name} lost access to ${refreshedDoc.name}`);
    addActivity("Blockchain permission revoked", `Revoke transaction ${shortHash(tx.hash)} confirmed for ${refreshedDoc.name}`);
    if (mode === "strong") {
      addActivity("Strong revoke completed", `${refreshedDoc.name} rotated to version ${refreshedDoc.currentVersion}`);
    }
    currentDocId = refreshedDoc.id;
    closeModal("revokeModal");
    saveState();
    toast(mode === "strong" ? "Access revoked and current file key rotated." : "Access revoked on-chain.");
  } catch (error) {
    toastError(error, "Access revocation failed.");
  } finally {
    revokeButton.disabled = false;
    revokeButton.textContent = previousButtonText;
  }
}

window.verifyIntegrity = async function(docId) {
  const d = state.documents.find(x => x.id === docId);
  if (!d) return;

  if (isDemoModeEnabled()) {
    toast(d.tampered ? "Integrity FAILED: hash mismatch detected." : "Integrity verified: blockchain hash matches.");
    addActivity(d.tampered ? "Integrity check failed" : "Integrity verified", `${d.name} ${d.tampered ? "hash mismatch detected" : "matched its recorded fingerprint"}`);
    saveState();
    return;
  }

  if (!window.KryptoVaultApi || !window.KryptoVaultCrypto) {
    toast("Integrity verification support is not available.");
    return;
  }

  try {
    const response = await window.KryptoVaultApi.get(`/api/assets/${encodeURIComponent(docId)}/integrity`);
    const integrity = response?.integrity || {};
    const expectedSha256 = normalizeHexHash(integrity.expectedSha256);
    const blockchainSha256 = normalizeHexHash(integrity.blockchainSha256);
    if (!expectedSha256 || expectedSha256 !== blockchainSha256 || integrity.blockchainVerificationStatus !== "verified") {
      throw new Error("Blockchain integrity verification failed.");
    }

    const decrypted = await decryptEncryptedAsset(docId, d);
    const actualSha256 = decrypted.sha256;
    if (normalizeHexHash(actualSha256) !== expectedSha256) {
      toast("MISMATCH: local plaintext hash does not match the blockchain record.");
      addActivity("Integrity check failed", `${d.name} local plaintext hash mismatch detected`);
      saveState();
      return;
    }

    toast("VERIFIED: local plaintext hash matches the blockchain record.");
    addActivity("Integrity verified", `${d.name} matched blockchain version ${integrity.currentVersion}`);
    saveState();
  } catch (error) {
    toast(error?.message || "Integrity verification failed.");
  }
};

window.simulateTamper = function(docId) {
  if (!isDemoModeEnabled()) {
    toast("Simulate Tampering is available only in demo mode.");
    return;
  }

  const d = state.documents.find(x => x.id === docId);
  if (!d) return;
  d.tampered = !d.tampered;
  addActivity(d.tampered ? "Tampering simulated" : "Tampering simulation cleared", `${d.name} demo integrity state changed`);
  saveState();
  toast(d.tampered ? "Tamper mode ON. Integrity checks will fail." : "Tamper mode cleared.");
};
window.openSharedDocument = async function(sharedId) {
  const s = state.shared.find(x => x.id === sharedId);
  if (!s) return;
  if (isDemoModeEnabled()) {
    toast("Checking wallet permission in demo mode...");
    await delay(800);
    addActivity("Shared document opened", `${s.name} opened after simulated access verification`);
    saveState();
    toast("Access granted in demo mode.");
    return;
  }

  try {
    const opened = await openEncryptedAsset(s.assetId || s.id, s);
    addActivity("Shared document opened", `${opened.filename || s.name} decrypted locally after blockchain access verification`);
    saveState();
    toast("Shared document decrypted locally and integrity verified.");
  } catch (error) {
    toast(error?.message || "Shared document could not be opened.");
  }
};
window.moveDocument = function(docId) {
  const doc = state.documents.find(d => d.id === docId);
  if (!doc) return;
  currentDocId = docId;
  const select = document.getElementById("moveFolderSelect");
  select.innerHTML = `
    <option value="" ${doc.folderId ? "" : "selected"}>Unfiled</option>
    ${state.folders.map(folder => `
    <option value="${folder.id}" ${folder.id === doc.folderId ? "selected" : ""}>${escapeHtml(folder.name)}</option>
  `).join("")}
  `;
  document.getElementById("moveDocumentName").textContent = doc.name;
  openModal("moveFolderModal");
};

async function confirmMoveDocument() {
  const doc = state.documents.find(d => d.id === currentDocId);
  if (!doc) return;
  const newFolderId = document.getElementById("moveFolderSelect").value || null;
  const oldFolder = folderName(doc.folderId);

  if (isDemoModeEnabled()) {
    doc.folderId = newFolderId;
    addActivity("Document moved", `${doc.name} moved from ${oldFolder} to ${folderName(newFolderId)}`);
    closeModal("moveFolderModal");
    saveState();
    toast("Document moved successfully.");
    return;
  }

  try {
    await window.KryptoVaultApi.patch(`/api/assets/${doc.id}/folder`, {
      folderId: newFolderId
    });
    closeModal("moveFolderModal");
    await refreshWorkspaceState();
    toast("Document moved successfully.");
  } catch (error) {
    toast(error?.message || "Document could not be moved.");
  }
}

async function createFolder() {
  const name = document.getElementById("folderNameInput").value.trim();
  if (!name) return toast("Enter a folder name.");

  if (isDemoModeEnabled()) {
    state.folders.push({ id: `folder-${Date.now()}`, name, createdAt: Date.now() });
    document.getElementById("folderNameInput").value = "";
    closeModal("folderModal");
    addActivity("Folder created", `${name} created`);
    saveState();
    return;
  }

  try {
    await window.KryptoVaultApi.post("/api/folders", { name });
    document.getElementById("folderNameInput").value = "";
    closeModal("folderModal");
    await refreshWorkspaceState();
    toast("Folder created.");
  } catch (error) {
    toast(error?.message || "Folder could not be created.");
  }
}

async function connectWallet() {
  if (window.ethereum?.request && !isDemoModeEnabled()) {
    let selectedWallet = "";
    try {
      console.debug("[wallet] connect clicked");
      resetAccountScopedState("Connecting wallet...");
      selectedWallet = normalizeWalletAddressForUi(await requestWalletAccount());
      const user = await initializeWalletSession(selectedWallet);
      toast(`Wallet authenticated: ${shortHash(user.walletAddress)}`);
      return;
    } catch (err) {
      console.debug("[wallet] auth failure", {
        status: err?.status || null,
        message: err?.message || "Wallet authentication failed."
      });
      await logoutWalletSession("Guest", false);
      if (selectedWallet) {
        resetAccountScopedState("Wallet connected - authentication failed", selectedWallet);
      } else {
        resetAccountScopedState();
      }
      if (err instanceof TypeError && /fetch/i.test(err.message || "")) {
        toast("Backend unavailable. Start the backend before authenticating your wallet.");
        return;
      }
      toast(err?.message || "Wallet authentication was cancelled.");
      return;
    }
  }

  if (!isDemoModeEnabled()) {
    toast("MetaMask is required for wallet authentication.");
    return;
  }

  // Explicit demo fallback so the site can be presented without MetaMask.
  state.user.walletAddress = randomHex(20);
  addActivity("Demo wallet connected", `Generated demo wallet ${shortHash(state.user.walletAddress)}`);
  saveState();
  toast("MetaMask not found — connected a demo wallet instead.");
}

function verifyKyc() {
  mockVerifyKyc();
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  renderAll();
  loadBackendState();
  registerWalletEvents();
  restoreConnectedWallet();

  document.getElementById("themeToggle")?.addEventListener("change", e => {
    state.settings.theme = e.target.checked ? "light" : "dark";
    saveState();
    toast(e.target.checked ? "Light mode enabled." : "Dark mode enabled.");
  });

  document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.page)));
  document.querySelectorAll("[data-page-jump]").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.pageJump)));
  document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => closeModal(btn.dataset.close)));

  document.getElementById("openUploadBtn").addEventListener("click", () => { resetUploadModal(); openModal("uploadModal"); });
  document.getElementById("uploadFromDocs").addEventListener("click", () => { resetUploadModal(); openModal("uploadModal"); });
  document.getElementById("secureUploadBtn").addEventListener("click", startEncryptedUpload);
  document.getElementById("closeUploadSuccess").addEventListener("click", () => { closeModal("uploadModal"); switchPage("documents"); });

  const uploadInput = document.getElementById("uploadFile");
  uploadInput.addEventListener("change", () => {
    selectedUploadFile = uploadInput.files[0] || null;
    document.getElementById("selectedFileLabel").textContent = selectedUploadFile ? `${selectedUploadFile.name} • ${fmtSize(selectedUploadFile.size)}` : "No file selected";
  });

  const drop = document.getElementById("dropZone");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragging"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("dragging");
    selectedUploadFile = e.dataTransfer.files[0] || null;
    document.getElementById("selectedFileLabel").textContent = selectedUploadFile ? `${selectedUploadFile.name} • ${fmtSize(selectedUploadFile.size)}` : "No file selected";
  });

  document.getElementById("walletBtn").addEventListener("click", connectWallet);
  document.getElementById("verifyKycBtn").addEventListener("click", verifyKyc);
  document.getElementById("grantAccessBtn").addEventListener("click", grantAccess);
  document.getElementById("confirmRevokeBtn").addEventListener("click", confirmRevoke);

  document.getElementById("newFolderBtn").addEventListener("click", () => openModal("folderModal"));
  document.getElementById("createFolderBtn").addEventListener("click", createFolder);
  document.getElementById("confirmMoveFolderBtn").addEventListener("click", confirmMoveDocument);

  document.getElementById("docSearch").addEventListener("input", renderDocuments);

  document.querySelectorAll("[data-doc-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-doc-tab]").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".doc-tab").forEach(p => p.classList.remove("active"));
      document.getElementById(`doc-tab-${tab.dataset.docTab}`).classList.add("active");
      if ((tab.dataset.docTab === "access" || tab.dataset.docTab === "activity") && currentDocId) {
        renderDocumentModal();
      }
    });
  });

  document.getElementById("saveProfileBtn").addEventListener("click", saveUserProfile);

  ["requireKyc","requireWallet","showProgress"].forEach(id => {
    document.getElementById(id).addEventListener("change", e => {
      state.settings[id] = e.target.checked;
      saveState();
    });
  });

  document.getElementById("clearActivityBtn").addEventListener("click", () => {
    if (!isDemoModeEnabled()) {
      toast("Real audit activity cannot be cleared.");
      return;
    }
    state.activities = [];
    saveState();
  });

  document.getElementById("seedDemoBtn").addEventListener("click", () => {
    setDemoModeEnabled(true);
    state = { ...initialState(), settings: { ...defaultPreferences(), ...loadPreferences() } };
    saveState();
    toast("Demo data restored.");
  });

  document.getElementById("resetAllBtn").addEventListener("click", () => {
    setDemoModeEnabled(false);
    state = { ...emptyAppData(), settings: { ...defaultPreferences(), ...loadPreferences() } };
    saveState();
    toast("Workspace reset.");
  });

  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
});

