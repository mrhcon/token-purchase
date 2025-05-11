# Token Purchase with Governance Locking - Anchor CPI Implementation

This project implements a Solana program for purchasing tokens and locking them in a governance system using Anchor framework with Cross-Program Invocation (CPI).

## Prerequisites

- Ubuntu Linux (22.04 LTS or newer recommended)
- Rust 1.75.0 or newer
- Node.js v20.x
- Solana CLI 1.16.0 or compatible version
- Anchor CLI 0.28.0 or compatible version

## Installation Steps

### 1. Install Node.js

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Verify installation
node -v  # Should show v20.x.x
npm -v   # Should show 10.x.x or higher
```

### 2. Install Rust and Cargo

```bash
# Install Rust using rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version
```

### 3. Install Solana CLI

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.16.0/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
```

### 4. Install Anchor CLI

```bash
# Install Anchor version manager
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Install Anchor CLI
avm install 0.28.0
avm use 0.28.0

# Verify installation
anchor --version
```

### 5. Set up Solana Wallet for Deployment

```bash
# Create a keypair for program deployment
solana-keygen new -o ./admin-keypair.json

# Airdrop SOL for deployments (on devnet)
solana config set --url https://api.devnet.solana.com
solana airdrop 2 --keypair ./admin-keypair.json
```

## Project Setup

### 1. Initialize Anchor Project

```bash
# Create a new project
anchor init token-purchase
cd token-purchase
```

### 2. Configure Cargo.toml for the Program

Create or update `programs/token-purchase/Cargo.toml`:

```toml
[package]
name = "token-purchase"
version = "0.1.0"
description = "Token purchase program with governance locking"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "token_purchase"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
init-if-needed = []

[dependencies]
anchor-lang = { version = "0.28.0", features = ["init-if-needed"] }
anchor-spl = "0.28.0"
solana-program = "=1.16.0"
```

### 3. Update Program Code

Replace the contents of `programs/token-purchase/src/lib.rs` with the provided Anchor program code.

### 4. Configure Anchor.toml

Update `Anchor.toml` with:

```toml
[features]
seeds = false
skip-lint = false

[programs.devnet]
token_purchase = "YOUR_PROGRAM_ID_HERE"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "./admin-keypair.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[constants]
treasury_address = "4WpsT2QvtjuYh4y9ggDRBPVDJseF98f26ke3DSXptCXt"
governance_program_id = "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
realm_id = "5Zjr7Be8fdrbfG9B2uZYxqyrwawFBpPy1Zkgd3RxwEUk"
community_mint = "JCTnoqWEEoWz4cBuPEF6KgK1Zc8YyBoHSm5u2FBQvHHA"
```

### 5. Build and Deploy

```bash
# Build the program
anchor clean
anchor build

# Get program ID
solana address -k target/deploy/token_purchase-keypair.json

# Update program ID in lib.rs and Anchor.toml
# ...

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

### 6. Set Up Server

```bash
# Install server dependencies
npm install express body-parser @solana/web3.js @solana/spl-token @solana/spl-governance @project-serum/anchor

# Create IDL directory
mkdir -p idl
cp target/idl/token_purchase.json idl/

# Start the server
node server.js
```

## Troubleshooting

### Rust Version Compatibility

If you encounter errors about Rust version compatibility:

```
error: package `solana-program v1.x.x` cannot be built because it requires rustc x.xx.x or newer
```

Fix by pinning Solana program to a compatible version in Cargo.toml:

```toml
solana-program = "=1.16.0"
```

### Solana CLI Version Issues

If you encounter issues with the Solana CLI, ensure the active release is set:

```bash
solana-install update
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

### Anchor Build/Deploy Problems

For issues with Anchor build or deploy:

```bash
# Clean and rebuild
anchor clean
anchor build

# Check Anchor is using the right Rust toolchain
rustup toolchain list
rustup default stable
```

## Usage

1. Connect to the application at http://localhost:3000
2. Connect your Solana wallet (set to devnet)
3. Select a lock duration (1, 3, 6, or 12 months)
4. Enter the amount of SOL to contribute
5. Click "Purchase Tokens" to execute the transaction

## License

This project is open source and available under the [MIT License](LICENSE).
