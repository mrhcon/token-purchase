document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const tabs = document.querySelectorAll('.tab-link');
    const amountInput = document.querySelector('.input-text input');
    const maxBtn = document.querySelector('.input-text a');
    const purchaseBtn = document.querySelector('.input-btn:not(.wallet-connect-btn)');

    // Selected lock duration (default: 1 month)
    let selectedDuration = 1;

    // Handle tab selection
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));

            // Add active class to clicked tab
            this.classList.add('active');

            // Update selected duration
            const tabText = this.textContent.trim();
            if (tabText.includes('1 Month')) selectedDuration = 1;
            else if (tabText.includes('3 Months')) selectedDuration = 3;
            else if (tabText.includes('6 Months')) selectedDuration = 6;
            else if (tabText.includes('12 Months')) selectedDuration = 12;

            // Show bonus information
            updateBonusInfo();
            // Update token estimate if an amount is entered
            if (amountInput.value) {
                updateTokenEstimate(parseFloat(amountInput.value));
            }
        });
    });

    // Function to update bonus information
    function updateBonusInfo() {
        let bonusPercentage = 0;
        switch (selectedDuration) {
            case 1: bonusPercentage = 2; break;
            case 3: bonusPercentage = 6; break;
            case 6: bonusPercentage = 12; break;
            case 12: bonusPercentage = 25; break;
        }

        // Find or create bonus info element
        let bonusInfo = document.getElementById('bonus-info');
        if (!bonusInfo) {
            bonusInfo = document.createElement('div');
            bonusInfo.id = 'bonus-info';
            bonusInfo.className = 'alert alert-info';
            document.querySelector('.input-group').appendChild(bonusInfo);
        }

        // Update bonus information
        bonusInfo.textContent = `${bonusPercentage}% bonus for ${selectedDuration} month${selectedDuration > 1 ? 's' : ''} lock`;
    }

    // Initial bonus information
    updateBonusInfo();

    // Add minimum lock information
    const minLockInfo = document.createElement('div');
    minLockInfo.className = 'alert alert-warning';
    minLockInfo.textContent = 'Note: Purchases less than 1 CROS token will be transferred but not locked in governance.';
    document.querySelector('.input-group:nth-of-type(2)').appendChild(minLockInfo);

    // Handle "Max" button click
    maxBtn.addEventListener('click', async function() {
        if (typeof window.solana === 'undefined') {
            alert("Please install a Solana wallet extension");
            return;
        }

        if (!window.solana.isConnected) {
            await connectWallet();
            return;
        }

        try {
            const connection = new solanaWeb3.Connection('https://api.devnet.solana.com');
            const publicKey = new solanaWeb3.PublicKey(window.solana.publicKey.toString());
            const balance = await connection.getBalance(publicKey);

            // Convert lamports to SOL, leave some for transaction fees
            const maxAmount = (balance / 1_000_000_000) - 0.01;
            if (maxAmount <= 0) {
                alert("Insufficient balance for transaction");
                return;
            }

            // Set the input value
            amountInput.value = maxAmount.toFixed(4);

            // Update token estimate
            updateTokenEstimate(maxAmount);
        } catch (error) {
            console.error("Error getting max amount:", error);
        }
    });

    // Function to update token estimate
    function updateTokenEstimate(solAmount) {
        if (isNaN(solAmount) || solAmount <= 0) return;

        // Calculate token amount with bonus
        const baseTokenAmount = solAmount * 100; // TOKEN_EXCHANGE_RATE = 100

        let bonusMultiplier = 1;
        switch (selectedDuration) {
            case 1: bonusMultiplier = 1.02; break;
            case 3: bonusMultiplier = 1.06; break;
            case 6: bonusMultiplier = 1.12; break;
            case 12: bonusMultiplier = 1.25; break;
        }

        const totalTokenAmount = baseTokenAmount * bonusMultiplier;

        // Find or create token estimate element
        let tokenEstimate = document.getElementById('token-estimate');
        if (!tokenEstimate) {
            tokenEstimate = document.createElement('div');
            tokenEstimate.id = 'token-estimate';
            tokenEstimate.className = 'alert alert-info';
            document.querySelector('.input-group:nth-of-type(2)').appendChild(tokenEstimate);
        }

        // Update token estimate information with details about the purchase
        tokenEstimate.innerHTML = `
            <p>You will receive <strong>${totalTokenAmount.toFixed(2)}</strong> Crossovr tokens</p>
            <p>Base tokens: ${baseTokenAmount.toFixed(2)} + ${((bonusMultiplier - 1) * 100).toFixed(0)}% bonus</p>
        `;

        // Add warning if amount is below locking threshold
        if (totalTokenAmount < 1.0) {
            tokenEstimate.innerHTML += `
                <div class="alert alert-warning" style="margin-top: 8px;">
                    <small>This amount will be transferred but not locked in governance (minimum 1.0 tokens required for locking)</small>
                </div>
            `;
        }
    }

    // Update token estimate when amount changes
    amountInput.addEventListener('input', function() {
        const solAmount = parseFloat(this.value);
        updateTokenEstimate(solAmount);
    });

    // Function to show result message
    function showResultMessage(result, isSuccess) {
        // Create result container if doesn't exist
        let resultContainer = document.getElementById('purchase-result');
        if (!resultContainer) {
            resultContainer = document.createElement('div');
            resultContainer.id = 'purchase-result';
            document.querySelector('.container').appendChild(resultContainer);
        } else {
            // Clear previous messages
            resultContainer.innerHTML = '';
        }

        // Add result alert
        const resultAlert = document.createElement('div');
        resultAlert.className = isSuccess ? 'alert alert-success' : 'alert alert-warning';
        resultAlert.innerHTML = result;
        resultContainer.appendChild(resultAlert);

        // Scroll to result
        resultAlert.scrollIntoView({ behavior: 'smooth' });
    }

    // Function to show status updates
    function updateStatus(message, type = 'info') {
        let statusContainer = document.getElementById('status-updates');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.id = 'status-updates';
            document.querySelector('.container').insertBefore(statusContainer, purchaseBtn.nextSibling);
        }

        const statusAlert = document.createElement('div');
        statusAlert.className = `alert alert-${type}`;
        statusAlert.textContent = message;
        statusContainer.innerHTML = ''; // Clear previous status
        statusContainer.appendChild(statusAlert);
    }

    // Function to handle transaction signing and sending with better error handling
    // MODIFIED: Updated to properly handle the pre-signed transaction from the server
    async function signAndSendTransaction(serializedTransaction) {
        if (!window.solana?.isConnected) {
            throw new Error("Wallet disconnected. Please connect your wallet and try again.");
        }

        try {
            // Convert base64 to Uint8Array
            const binaryData = atob(serializedTransaction);
            const bytes = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                bytes[i] = binaryData.charCodeAt(i);
            }

            // Deserialize transaction
            const transaction = solanaWeb3.Transaction.from(bytes);

            console.log("Transaction ready for signing, instructions:", transaction.instructions.length);
            console.log("Pre-existing signatures:", transaction.signatures.filter(sig => sig.signature !== null).length);
            
            // Debug: log signature details
            transaction.signatures.forEach((sig, i) => {
                console.log(`Signature ${i}: ${sig.publicKey.toString()} - signed: ${sig.signature !== null}`);
            });

            // Sign the transaction with the user's wallet
            // This will add the user's signature alongside the admin's signature
            const signedTransaction = await window.solana.signTransaction(transaction);
            console.log("Transaction signed successfully");
            
            // Debug: log signature details after signing
            signedTransaction.signatures.forEach((sig, i) => {
                console.log(`After signing - Signature ${i}: ${sig.publicKey.toString()} - signed: ${sig.signature !== null}`);
            });

            // Create a connection to send the transaction
            const connection = new solanaWeb3.Connection('https://api.devnet.solana.com');

            // Send the transaction with optimized parameters
            const signature = await connection.sendRawTransaction(
                signedTransaction.serialize(),
                {
                    skipPreflight: true, // Skip preflight to avoid simulation errors
                    preflightCommitment: 'processed',
                    maxRetries: 5 // Add retries for better chance of success
                }
            );

            console.log("Transaction signature:", signature);
            return signature;

        } catch (error) {
            console.error("Error in signAndSendTransaction:", error);

            // Format error message for user
            if (error.message && error.message.includes("User rejected")) {
                throw new Error("Transaction was rejected by your wallet.");
            } else if (error.message && error.message.includes("Signature verification failed")) {
                throw new Error("Transaction signature verification failed. This often happens when the admin signature is invalid or missing.");
            } else {
                throw new Error(`Transaction failed: ${error.message}`);
            }
        }
    }

    // Function to wait for transaction confirmation with timeout and retry
    async function waitForTransactionConfirmation(connection, signature, timeoutMs = 60000) {
        const startTime = Date.now();
        const maxEndTime = startTime + timeoutMs;

        let confirmed = false;

        while (!confirmed && Date.now() < maxEndTime) {
            try {
                // Check status with a short timeout
                const status = await Promise.race([
                    connection.getSignatureStatus(signature),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Status check timeout")), 5000))
                ]);

                if (status?.value?.confirmationStatus === 'confirmed' ||
                    status?.value?.confirmationStatus === 'finalized') {
                    confirmed = true;
                    break;
                }

                // Wait before checking again
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                console.log("Waiting for confirmation...", e);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return confirmed;
    }

    // Handle purchase button click - improved implementation
    purchaseBtn.addEventListener('click', async function() {
        // Check if wallet is connected
        if (!window.solana?.isConnected) {
            await connectWallet();
            return;
        }

        const walletAddress = window.solana.publicKey.toString();

        // Get the SOL amount
        const solAmount = parseFloat(amountInput.value);
        if (isNaN(solAmount) || solAmount <= 0) {
            alert("Please enter a valid SOL amount");
            return;
        }

        // Show loading state
        purchaseBtn.disabled = true;
        purchaseBtn.textContent = "Processing...";

        try {
            updateStatus("Creating transaction...");

            // Step 1: Request a transaction from the server
            const createResponse = await fetch('/api/create-purchase-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: walletAddress,
                    solAmount: solAmount,
                    lockDurationMonths: selectedDuration
                })
            });

            if (!createResponse.ok) {
                const errorData = await createResponse.json();
                throw new Error(errorData.error || "Failed to create transaction");
            }

            const createResult = await createResponse.json();

            if (!createResult.success) {
                throw new Error(createResult.error || "Server could not create the transaction");
            }

            // Step 2: Sign and send the transaction
            updateStatus("Please approve the transaction in your wallet...", "warning");

            const serializedTransaction = createResult.transaction;
            const signature = await signAndSendTransaction(serializedTransaction);

            updateStatus(`Transaction sent! Signature: ${signature.slice(0, 8)}...${signature.slice(-8)}`, "info");

            // Step 3: Wait for confirmation
            updateStatus("Waiting for transaction confirmation...");

            const connection = new solanaWeb3.Connection('https://api.devnet.solana.com');
            const confirmed = await waitForTransactionConfirmation(connection, signature, 60000);

            // Step 4: Notify server of completed purchase
            if (confirmed) {
                updateStatus("Transaction confirmed! Processing purchase...", "success");

                try {
                    await fetch('/api/complete-purchase', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            walletAddress: walletAddress,
                            solAmount: solAmount,
                            lockDurationMonths: selectedDuration,
                            transactionSignature: signature
                        })
                    });
                } catch (notifyError) {
                    console.warn("Could not notify server of purchase completion:", notifyError);
                    // Non-critical error, continue with success message
                }
            }

            // Step 5: Show result information
            const { metadata } = createResult;
            const unlockDate = new Date(metadata.unlockDate);
            const isLocked = metadata.isLocked;

            // Generate success message
            let resultHtml;

            if (confirmed) {
                resultHtml = `
                    <h4>🎉 Purchase Complete!</h4>
                    <p>You've spent <strong>${solAmount}</strong> SOL and received <strong>${metadata.tokenAmount.toFixed(2)}</strong> Crossovr tokens!</p>
                    ${isLocked ?
                        `<p>Your tokens are locked in governance until ${unlockDate.toLocaleString()}.</p>
                        <p>After this date, visit the DAO to unlock your tokens:
                            <a href="https://app.realms.today/dao/${metadata.realmId}?cluster=devnet" target="_blank">Crossovr DAO</a>
                        </p>` :
                        `<p>Your tokens have been transferred to your wallet.</p>
                        <p>Note: The amount was too small to be locked in governance.</p>`
                    }
                    <p>Transaction signature: <a href="https://explorer.solana.com/tx/${signature}?cluster=devnet"
                       target="_blank">${signature.slice(0, 8)}...${signature.slice(-8)}</a></p>
                `;
            } else {
                resultHtml = `
                    <h4>⏳ Transaction Sent</h4>
                    <p>Your transaction has been submitted to the Solana network but has not been confirmed yet.</p>
                    <p>You've requested <strong>${metadata.tokenAmount.toFixed(2)}</strong> Crossovr tokens for <strong>${solAmount}</strong> SOL.</p>
                    <p>View on Solana Explorer: <a href="https://explorer.solana.com/tx/${signature}?cluster=devnet" target="_blank">
                        ${signature.slice(0, 8)}...${signature.slice(-8)}
                    </a></p>
                    <p>The transaction may take a few minutes to confirm depending on network conditions.</p>
                `;
            }

            showResultMessage(resultHtml, true);

            // Clear status updates
            document.getElementById('status-updates')?.remove();

            // Reset form
            amountInput.value = "";
            const tokenEstimate = document.getElementById('token-estimate');
            if (tokenEstimate) tokenEstimate.textContent = "";

            // Update purchase history (after a delay to allow blockchain state to update)
            setTimeout(() => {
                fetchPurchaseHistory(walletAddress);
            }, 5000);

        } catch (error) {
            console.error("Purchase error:", error);

            // Show error message
            const errorHtml = `
                <h4>❌ Error During Purchase</h4>
                <p>${error.message}</p>
                <p>Please try again or contact support if the problem persists.</p>
            `;

            showResultMessage(errorHtml, false);

            // Clear status updates
            document.getElementById('status-updates')?.remove();
        } finally {
            // Reset button state
            purchaseBtn.disabled = false;
            purchaseBtn.textContent = "Purchase Tokens";
        }
    });

    // Enhanced fetchPurchaseHistory function
    window.fetchPurchaseHistory = async function(walletAddress) {
        try {
            console.log("Fetching purchase history for:", walletAddress);

            // Add loading indicator
            let historySection = document.getElementById('purchase-history');
            if (!historySection) {
                historySection = document.createElement('div');
                historySection.id = 'purchase-history';
                historySection.className = 'purchase-history';

                // Create header
                const header = document.createElement('h3');
                header.textContent = 'Your Purchase History';
                historySection.appendChild(header);

                // Add loading indicator
                const loading = document.createElement('div');
                loading.className = 'alert alert-info';
                loading.textContent = 'Loading your purchase history...';
                historySection.appendChild(loading);

                // Add to page after the purchase button
                const purchaseBtn = document.querySelector('.input-btn:not(.wallet-connect-btn)');
                purchaseBtn.parentNode.insertBefore(historySection, purchaseBtn.nextSibling);
            }

            const response = await fetch(`/api/purchase-status/${walletAddress}`);
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log("Purchase history data:", data);

            // Clear existing content (except header)
            while (historySection.childNodes.length > 1) {
                historySection.removeChild(historySection.lastChild);
            }

            if (data.purchases && data.purchases.length > 0) {
                // Add purchase records
                data.purchases.forEach(purchase => {
                    const purchaseCard = document.createElement('div');
                    purchaseCard.className = 'alert purchase-card';

                    // Determine if tokens are still locked
                    const now = new Date();
                    const unlockDate = new Date(purchase.unlockDate);
                    const isLocked = now < unlockDate;

                    if (isLocked) {
                        purchaseCard.className += ' alert-info';
                    } else {
                        purchaseCard.className += ' alert-success';
                    }

                    // Format purchase information
                    purchaseCard.innerHTML = `
                        <p><strong>Amount:</strong> ${purchase.amount.toFixed(2)} Crossovr tokens</p>
                        <p><strong>Lock Duration:</strong> ${purchase.lockDurationMonths} month${purchase.lockDurationMonths > 1 ? 's' : ''}</p>
                        <p><strong>Status:</strong> ${isLocked ? '🔒 Locked' : '🔓 Unlocked'}</p>
                        <p><strong>${isLocked ? 'Unlocks' : 'Unlocked'}:</strong> ${new Date(purchase.unlockDate).toLocaleString()}</p>
                        <p><strong>Purchase Date:</strong> ${new Date(purchase.purchasedAt).toLocaleString()}</p>
                    `;

                    // Add unlock instructions if unlocked
                    if (!isLocked) {
                        const unlockInstructions = document.createElement('div');
                        unlockInstructions.innerHTML = `
                            <p>Your tokens are now available for withdrawal. Visit the DAO to claim them:</p>
                            <a href="https://app.realms.today/dao/5Zjr7Be8fdrbfG9B2uZYxqyrwawFBpPy1Zkgd3RxwEUk?cluster=devnet"
                              target="_blank" class="input-btn">Claim Tokens</a>
                        `;
                        purchaseCard.appendChild(unlockInstructions);
                    }

                    historySection.appendChild(purchaseCard);
                });
            } else {
                // Show no history message
                const noHistory = document.createElement('div');
                noHistory.className = 'alert alert-info';
                noHistory.textContent = 'You have no purchase history yet.';
                historySection.appendChild(noHistory);
            }
        } catch (error) {
            console.error("Error fetching purchase history:", error);

            // Update history section with error
            let historySection = document.getElementById('purchase-history');
            if (historySection) {
                // Clear existing content (except header)
                while (historySection.childNodes.length > 1) {
                    historySection.removeChild(historySection.lastChild);
                }

                // Add error message
                const errorMsg = document.createElement('div');
                errorMsg.className = 'alert alert-danger';
                errorMsg.textContent = 'Could not load purchase history. Please try again later.';
                historySection.appendChild(errorMsg);
            }
        }
    };
});
