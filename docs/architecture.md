flowchart TD

%% =========================================================
%% 1. USER UPLOADS FILE
%% =========================================================

subgraph UPLOAD["1. USER UPLOADS FILE"]

U1[Owner Selects File]
U1 --> U2{Optional Extra File Password?}

U2 -->|Yes| U3[Derive Password Key using KDF]
U3 --> U4[Password-Protect File / Encryption Layer]

U2 -->|No| U5[Continue Normally]
U4 --> U5

U5 --> U6[Generate Random AES-256 Key K1]
U6 --> U7[Encrypt File using AES-256-GCM]

U1 --> U8[Generate SHA-256 Hash H1]

U6 --> U9[Wrap K1 using Owner Public Encryption Key]
U9 --> U10[Create EK_Owner]

U7 --> U11[(Database / Off-chain Storage)]
U10 --> U11

U11 --> U12[Store Encrypted File]
U11 --> U13[Store EK_Owner]
U11 --> U14[Store File Metadata]
U11 --> U15[Store Password Protection Metadata if enabled]

U8 --> U16[Smart Contract]
U16 --> U17[Create Asset ID]
U16 --> U18[Store Owner Wallet]
U16 --> U19[Store SHA-256 H1]
U16 --> U20[Store Current Version = 1]
U16 --> U21[Owner Permission = WRITE]

U16 --> U22[Emit FileRegistered Event]

end

%% =========================================================
%% 2. OWNER GIVES ACCESS
%% =========================================================

subgraph GRANT["2. OWNER GIVES ACCESS"]

G1[Owner Selects File]
G1 --> G2[Select Recipient Alice]

G2 --> G3{Permission Type}

G3 -->|READ| G4[READ]
G3 -->|READ + WRITE| G5[WRITE]

G2 --> G6[Fetch Alice Public Encryption Key]

G6 --> G7[Owner Recovers Current AES Key K1]
G7 --> G8[Wrap K1 using Alice Public Key]
G8 --> G9[Create EK_Alice]

G9 --> G10[(Database)]
G10 --> G11[Store EK_Alice]

G4 --> G12[Call grantAccess]
G5 --> G12

G12 --> G13[Smart Contract Stores Permission]

G13 --> G14[Alice Wallet]
G13 --> G15[READ / WRITE]
G13 --> G16[Valid From]
G13 --> G17[Valid Until]
G13 --> G18[Reason / Message]

G13 --> G19[Emit AccessGranted Event]
G19 --> G20[Alice Authorized]

end

%% =========================================================
%% 3. USER ACCESSES FILE
%% =========================================================

subgraph ACCESS["3. USER ACCESSES FILE"]

A1[Alice Requests File]
A1 --> A2[Authenticate Wallet / Session]

A2 --> A3[Call Smart Contract Access Check]

A3 -->|No Permission| A4[ACCESS DENIED]

A3 -->|Permission Valid| A5[Emit AccessAttempt / AccessGranted Log Event]

A5 --> A6[Backend Sends Encrypted File + EK_Alice]

A6 --> A7[Alice Private Encryption Key]
A7 --> A8[Unwrap EK_Alice]
A8 --> A9[Recover AES Key K1]

A9 --> A10{Password Protection Enabled?}

A10 -->|Yes| A11[Ask User for File Password]
A11 --> A12[Derive Password Key]
A12 --> A13[Unlock Password Layer]

A10 -->|No| A14[Continue]
A13 --> A14

A14 --> A15[Decrypt File Locally]

A15 --> A16{Permission?}

A16 -->|READ| A17[View Only]
A17 --> A18[No New Version Commit Allowed]

A16 -->|WRITE| A19[View + Modify]

A19 --> A20[User Saves Changes]
A20 --> A21[Encrypt Updated File]
A21 --> A22[Generate New SHA-256 Hash H2]

A22 --> A23[(Database)]
A23 --> A24[Store Encrypted Version 2]

A22 --> A25[Smart Contract]
A25 --> A26[Commit Version 2]
A26 --> A27[Store H2]
A26 --> A28[Updated By Alice]
A26 --> A29[Timestamp]
A26 --> A30[Commit Message]

A30 --> A31[Emit VersionCommitted Event]
A31 --> A32[Version 2 Becomes Current]

end

%% =========================================================
%% 4. WEAK REVOKE
%% =========================================================

subgraph WEAK["4. WEAK REVOKE"]

W1[Owner Selects Alice]
W1 --> W2[Choose Weak Revoke]

W2 --> W3[Call revokeAccess]
W3 --> W4[Smart Contract Sets Permission = NONE]

W4 --> W5[Record Revoked By]
W4 --> W6[Timestamp]
W4 --> W7[Reason]

W4 --> W8[Emit AccessRevoked Event]

W8 --> W9[Backend Stops Sending Encrypted File]
W8 --> W10[Backend Stops Sending EK_Alice]

W9 --> W11[Future Platform Access Blocked]
W10 --> W11

W11 --> W12[Current AES Key K1 remains unchanged]

W12 --> W13[If Alice saved old File + EK_Alice]
W13 --> W14[Old copy may still be decryptable]

end

%% =========================================================
%% 5. STRONG REVOKE
%% =========================================================

subgraph STRONG["5. STRONG REVOKE"]

S1[Owner Selects Alice]
S1 --> S2[Choose Strong Revoke]

S2 --> S3[Call revokeAccess]
S3 --> S4[Smart Contract Sets Alice Permission = NONE]

S4 --> S5[Emit AccessRevoked Event]

S5 --> S6[Generate New AES Key K2]

S6 --> S7[Decrypt Current File using K1]
S7 --> S8[Re-encrypt File using K2]

S8 --> S9[(Database)]
S9 --> S10[Store New Encrypted Current Version]

S6 --> S11[Find Remaining Authorized Users]

S11 --> S12[Wrap K2 for Bob]
S11 --> S13[Wrap K2 for John]
S11 --> S14[Wrap K2 for Other Authorized Users]

S12 --> S15[(Database)]
S13 --> S15
S14 --> S15

S15 --> S16[Store New EK_Bob]
S15 --> S17[Store New EK_John]
S15 --> S18[No New EK_Alice]

S8 --> S19[Generate New SHA-256 Hash H_new]

S19 --> S20[Smart Contract]
S20 --> S21[Create New Current Version]
S20 --> S22[Store H_new]
S20 --> S23[Record Strong Revoke]
S20 --> S24[Record Revoked User]
S20 --> S25[Timestamp + Reason]

S25 --> S26[Emit StrongRevoke / VersionCommitted Event]

S26 --> S27[Alice Only Has Old K1]
S27 --> S28[Current File Requires K2]
S28 --> S29[Alice Cannot Decrypt Current Version]

end

%% =========================================================
%% 6. SMART CONTRACT STORAGE
%% =========================================================

subgraph CONTRACT["6. SMART CONTRACT / BLOCKCHAIN"]

C0[AssetRegistry Contract]

C0 --> C1[Asset Records]
C1 --> C2[Asset ID]
C1 --> C3[Owner Wallet]
C1 --> C4[Current SHA-256 Hash]
C1 --> C5[Current Version]
C1 --> C6[Creation Timestamp]

C0 --> C7[Access Permissions]
C7 --> C8[User Wallet]
C7 --> C9[READ / WRITE / NONE]
C7 --> C10[Valid From]
C7 --> C11[Valid Until]
C7 --> C12[Reason / Message]

C0 --> C13[Version History]
C13 --> C14[Version Number]
C13 --> C15[Hash]
C13 --> C16[Updated By]
C13 --> C17[Timestamp]
C13 --> C18[Commit Message]

C0 --> C19[Immutable Events]
C19 --> C20[FileRegistered]
C19 --> C21[AccessGranted]
C19 --> C22[FileAccessed]
C19 --> C23[AccessRevoked]
C19 --> C24[StrongRevoke]
C19 --> C25[VersionCommitted]

end

%% =========================================================
%% 7. DATABASE / OFF-CHAIN STORAGE
%% =========================================================

subgraph DATABASE["7. DATABASE / OFF-CHAIN STORAGE"]

D0[(Database / Storage)]

D0 --> D1[Users]
D1 --> D2[Wallet Address]
D1 --> D3[Public Encryption Key]
D1 --> D4[Profile Metadata]
D1 --> D5[KYC / Credential References]

D0 --> D6[Assets]
D6 --> D7[Encrypted File]
D6 --> D8[Filename]
D6 --> D9[Version]
D6 --> D10[Blockchain Asset ID]
D6 --> D11[Storage Metadata]

D0 --> D12[Wrapped Keys]
D12 --> D13[Asset ID]
D12 --> D14[User Wallet]
D12 --> D15[EK_User]
D12 --> D16[Wrapping Metadata]

D0 --> D17[Optional Password Metadata]
D17 --> D18[Salt]
D17 --> D19[KDF Parameters]
D17 --> D20[Password Protection Enabled]

D0 --> D21[NEVER STORE]
D21 --> D22[Plaintext File]
D21 --> D23[Raw AES Key]
D21 --> D24[Raw Private Encryption Key]
D21 --> D25[Wallet Private Key]
D21 --> D26[Plaintext File Password]

end

%% =========================================================
%% 8. USER SIDE
%% =========================================================

subgraph USER["8. USER SIDE"]

US0[User Device / Browser]

US0 --> US1[MetaMask / Wallet]
US1 --> US2[Wallet Address]
US1 --> US3[Wallet Private Key]
US1 --> US4[Digital Signatures]

US0 --> US5[Encryption Identity]
US5 --> US6[Public Encryption Key]
US5 --> US7[Private Encryption Key]

US7 --> US8[Encrypted Local Key Storage]
US8 --> US9[IndexedDB / Secure Device Storage]

US0 --> US10[Crypto Engine]
US10 --> US11[AES-256-GCM]
US10 --> US12[SHA-256]
US10 --> US13[Wrap / Unwrap AES Keys]
US10 --> US14[Password KDF]

US0 --> US15[Temporary Working Area]
US15 --> US16[Plaintext Exists Only During Use]
US15 --> US17[AES Key Temporarily in Memory]

US16 --> US18[On Save / Close]
US18 --> US19[Re-encrypt File]
US18 --> US20[Generate New Hash if Modified]
US18 --> US21[Clear Temporary Plaintext where possible]

end

%% =========================================================
%% 9. HIGH LEVEL ARCHITECTURE
%% =========================================================

subgraph ARCH["9. HIGH-LEVEL SYSTEM ARCHITECTURE"]

X1[USER SIDE]
X2[BACKEND]
X3[(DATABASE / STORAGE)]
X4[SMART CONTRACT / BLOCKCHAIN]

X1 -->|Wallet Authentication| X2
X2 -->|Check Permissions| X4
X4 -->|READ / WRITE / NONE| X2

X1 -->|Encrypted File Upload| X3
X3 -->|Encrypted File + EK_User| X2
X2 -->|Authorized Data Delivery| X1

X1 -->|SHA-256 + Version Commit| X4

X4 -->|Immutable Logs| X4

end
