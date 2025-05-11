let wallet = null;

async function connectWallet() {
    try {
        // First check if Solana object exists in window
        if (typeof window.solana === 'undefined') {
            console.error("No Solana wallet found in window");
            return null;
        }

        // Check if wallet is already connected
        if (window.solana.isConnected) {
            console.log("Wallet already connected");
            wallet = window.solana.publicKey.toString();
        } else {
            // Connect to wallet
            console.log("Connecting to wallet...");
            try {
                // This is the modern way to connect
                const resp = await window.solana.connect();
                wallet = resp.publicKey.toString();
                console.log("Connected to wallet:", wallet);
            } catch (connErr) {
                console.error("Connection error:", connErr);
                if (connErr.code === 4001) {
                    alert("Connection request was rejected. Please approve the connection request.");
                } else {
                    alert("Failed to connect wallet: " + (connErr.message || "Unknown error"));
                }
                return null;
            }
        }
        
        // Check if connected to devnet
        try {
            const connection = new solanaWeb3.Connection('https://api.devnet.solana.com');
            const publicKey = new solanaWeb3.PublicKey(wallet);
            const balanceInLamports = await connection.getBalance(publicKey);
            const balanceInSOL = balanceInLamports / 1_000_000_000;
            
            console.log(`Wallet: ${wallet}`);
            console.log(`Balance: ${balanceInSOL} SOL`);
            
            // Warn if balance is too low
            if (balanceInSOL < 0.02) {
                alert("Your wallet balance is very low. You need SOL for transaction fees. Consider getting DevNet SOL from a faucet.");
            }
            
            // Update UI to show connected wallet and balance
            document.getElementById('wallet-status').innerHTML = `
                <strong>Connected:</strong> ${wallet.slice(0, 6)}...${wallet.slice(-4)}<br>
                <strong>Balance:</strong> ${balanceInSOL.toFixed(4)} SOL
            `;
            
            // Change connect button to disconnect
            const connectBtn = document.querySelector('.wallet-connect-btn');
            connectBtn.textContent = "Disconnect Wallet";
            connectBtn.onclick = disconnectWallet;
            
            // Show any purchase history
            if (typeof fetchPurchaseHistory === 'function') {
                fetchPurchaseHistory(wallet);
            } else {
                console.warn("fetchPurchaseHistory function not available");
            }
            
            return wallet;
        } catch (balanceErr) {
            console.error("Error checking wallet balance:", balanceErr);
            // Still consider the connection successful even if balance check fails
            
            // Update UI to show connected wallet without balance
            document.getElementById('wallet-status').innerHTML = `
                <strong>Connected:</strong> ${wallet.slice(0, 6)}...${wallet.slice(-4)}<br>
                <strong>Balance:</strong> Unable to fetch
            `;
            
            // Change connect button to disconnect
            const connectBtn = document.querySelector('.wallet-connect-btn');
            connectBtn.textContent = "Disconnect Wallet";
            connectBtn.onclick = disconnectWallet;
            
            return wallet;
        }
    } catch (err) {
        console.error("Error connecting wallet:", err);
        alert("Failed to connect wallet: " + (err.message || "Unknown error"));
        return null;
    }
}

async function disconnectWallet() {
    try {
        if (window.solana && window.solana.isConnected) {
            await window.solana.disconnect();
            wallet = null;
            
            // Update UI
            document.getElementById('wallet-status').textContent = 'Wallet: Not Connected';
            
            // Change disconnect button back to connect
            const connectBtn = document.querySelector('.wallet-connect-btn');
            connectBtn.textContent = "Connect Wallet";
            connectBtn.onclick = connectWallet;
            
            // Remove purchase history
            const historySection = document.getElementById('purchase-history');
            if (historySection) {
                historySection.remove();
            }
            
            console.log('Wallet disconnected');
        }
    } catch (err) {
        console.error("Error disconnecting wallet:", err);
        alert("Could not disconnect wallet: " + (err.message || "Unknown error"));
    }
}

// Check if wallet is already connected on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Checking for wallet connection...");
    console.log("window.solana exists:", typeof window.solana !== 'undefined');
    
    // Try auto-connect only if wallet is available
    if (typeof window.solana !== 'undefined') {
        try {
            // Check if wallet is already connected
            if (window.solana.isConnected) {
                console.log("Wallet is already connected, initializing...");
                await connectWallet();
            }
            // Otherwise if auto-connect is enabled
            else if (localStorage.getItem('autoConnectWallet') === 'true') {
                console.log("Auto-connecting wallet...");
                await connectWallet();
            }
        } catch (err) {
            console.error("Error checking wallet connection:", err);
        }
    } else {
        console.log("No Solana wallet detected");
    }
});
