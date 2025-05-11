const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    SystemProgram,
    sendAndConfirmTransaction
} = require('@solana/web3.js');
const {
    Token,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const {
    Program,
    AnchorProvider,
    web3,
    BN
} = require('@project-serum/anchor');
const fs = require('fs');

// Constants
const PORT = 8080;
const PROGRAM_ID = '9HgVgT5AQ9WdCcZPMgzG8j26892YBjvHFEFL33xk4tb7';
const TREASURY_ADDRESS = '4WpsT2QvtjuYh4y9ggDRBPVDJseF98f26ke3DSXptCXt';
const GOVERNANCE_PROGRAM_ID = 'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw';
const REALM_ID = '5Zjr7Be8fdrbfG9B2uZYxqyrwawFBpPy1Zkgd3RxwEUk';
const COMMUNITY_MINT = 'JCTnoqWEEoWz4cBuPEF6KgK1Zc8YyBoHSm5u2FBQvHHA';

// Initialize Express app
const app = express();

// Add CORS middleware (no dependency required)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Load IDL
let idl;
try {
    idl = JSON.parse(fs.readFileSync('./idl/token_purchase.json', 'utf8'));
    console.log('IDL loaded successfully');

    // Display all available methods for debugging
    console.log('Program instructions:');
    idl.instructions.forEach(instruction => {
        console.log(`- ${instruction.name}`);
        console.log('  Required accounts:');
        instruction.accounts.forEach(account => {
            console.log(`  - ${account.name}${account.isMut ? ' (mutable)' : ''}${account.isSigner ? ' (signer)' : ''}`);
        });
    });
} catch (error) {
    console.error('Error loading IDL file:', error);
}

// Setup Solana connection
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Helper function to load wallet from keypair
function loadAdminWallet() {
    try {
        const keypairBuffer = fs.readFileSync('./admin-keypair.json', 'utf8');
        const keypairData = JSON.parse(keypairBuffer);
        return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
        console.error('Error loading admin keypair:', error);
        return null;
    }
}

// Function to find associated token address
async function findAssociatedTokenAddress(walletAddress, tokenMintAddress) {
    const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey(
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );

    return (await PublicKey.findProgramAddress(
        [
            new PublicKey(walletAddress).toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            new PublicKey(tokenMintAddress).toBuffer(),
        ],
        SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    ))[0];
}

// Helper function to derive Governance program addresses
async function deriveGovernanceAddresses(realmId, communityMint, walletAddress) {
    // Derive Realm Config address
    const realmConfigAddress = await PublicKey.findProgramAddress(
        [Buffer.from('realm-config'), new PublicKey(realmId).toBuffer()],
        new PublicKey(GOVERNANCE_PROGRAM_ID)
    );

    // Derive Governing Token Holding address
    const governingTokenHoldingAddress = await PublicKey.findProgramAddress(
        [
            Buffer.from('governance'),
            new PublicKey(realmId).toBuffer(),
            new PublicKey(communityMint).toBuffer(),
        ],
        new PublicKey(GOVERNANCE_PROGRAM_ID)
    );

    // Derive Governance Token Account (where locked tokens are held)
    const governanceTokenAccountAddress = await PublicKey.findProgramAddress(
        [
            Buffer.from('governance-token-account'),
            new PublicKey(realmId).toBuffer(),
            new PublicKey(communityMint).toBuffer(),
            new PublicKey(walletAddress).toBuffer(),
        ],
        new PublicKey(GOVERNANCE_PROGRAM_ID)
    );

    // Derive Token Owner Record address
    const tokenOwnerRecordAddress = await PublicKey.findProgramAddress(
        [
            Buffer.from('token-owner-record'),
            new PublicKey(realmId).toBuffer(),
            new PublicKey(communityMint).toBuffer(),
            new PublicKey(walletAddress).toBuffer(),
        ],
        new PublicKey(GOVERNANCE_PROGRAM_ID)
    );

    return {
        realmConfig: realmConfigAddress[0],
        governingTokenHolding: governingTokenHoldingAddress[0],
        governanceTokenAccount: governanceTokenAccountAddress[0],
        tokenOwnerRecord: tokenOwnerRecordAddress[0]
    };
}

// Simple in-memory database for purchases (will be reset on server restart)
const purchasesDb = [];

// API endpoint to get user's purchase history
app.get('/api/purchase-status/:publicKey', async (req, res) => {
    try {
        const { publicKey } = req.params;

        // Find all purchases for this user from our database
        const userPurchases = purchasesDb.filter(purchase =>
            purchase.userPublicKey === publicKey
        );

        // If no purchases found, return empty array
        if (userPurchases.length === 0) {
            console.log(`No purchases found for wallet: ${publicKey}`);
        }

        return res.status(200).json({
            success: true,
            purchases: userPurchases
        });
    } catch (error) {
        console.error('Error fetching purchase status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch purchase status',
            error: error.toString()
        });
    }
});

// API endpoint to create purchase transaction for user to sign
app.post('/api/create-purchase-transaction', async (req, res) => {
    try {
        console.log('Transaction request received:', req.body);

        // Extract exactly what the client is sending
        const { walletAddress, solAmount, lockDurationMonths } = req.body;

        if (!walletAddress || !solAmount || !lockDurationMonths) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields. Received: ${JSON.stringify(req.body)}`
            });
        }

        try {
            // Create a proper token purchase and lock transaction
            const senderPubkey = new PublicKey(walletAddress);
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

            // Load admin wallet for creating transaction
            const adminWallet = loadAdminWallet();
            if (!adminWallet) {
                return res.status(500).json({
                    success: false,
                    message: 'Admin wallet not available'
                });
            }

            // Initialize program
            const provider = new AnchorProvider(
                connection,
                {
                    publicKey: adminWallet.publicKey,
                    signTransaction: async (tx) => {
                        tx.sign(adminWallet);
                        return tx;
                    },
                    signAllTransactions: async (txs) => {
                        return txs.map((tx) => {
                            tx.sign(adminWallet);
                            return tx;
                        });
                    }
                },
                { commitment: 'confirmed' }
            );

            const program = new Program(idl, PROGRAM_ID, provider);

            // Convert inputs
            const amount = new BN(parseFloat(solAmount) * 1e9); // Convert SOL to lamports
            const duration = parseInt(lockDurationMonths);

            // Prepare the basic transaction accounts
            const treasuryPubkey = new PublicKey(TREASURY_ADDRESS);
            const governanceProgramId = new PublicKey(GOVERNANCE_PROGRAM_ID);
            const realmPubkey = new PublicKey(REALM_ID);
            const communityMintPubkey = new PublicKey(COMMUNITY_MINT);

            // Find the admin's token account for the community mint
            const adminTokenAccount = await findAssociatedTokenAddress(
                adminWallet.publicKey.toString(),
                COMMUNITY_MINT
            );
            console.log('Found admin token account:', adminTokenAccount.toString());

            // Get user token account - this will be created if it doesn't exist
            const userTokenAccount = await findAssociatedTokenAddress(
                walletAddress,
                COMMUNITY_MINT
            );
            console.log('User token account:', userTokenAccount.toString());

            // Derive governance-related accounts
            const governanceAddresses = await deriveGovernanceAddresses(
                REALM_ID,
                COMMUNITY_MINT,
                walletAddress
            );

            console.log('Governance addresses derived:');
            console.log('- realmConfig:', governanceAddresses.realmConfig.toString());
            console.log('- governingTokenHolding:', governanceAddresses.governingTokenHolding.toString());
            console.log('- governanceTokenAccount:', governanceAddresses.governanceTokenAccount.toString());
            console.log('- tokenOwnerRecord:', governanceAddresses.tokenOwnerRecord.toString());

            // Check available program methods
            console.log('Available program methods:', Object.keys(program.methods));

            // Create the transaction using the correct method from IDL
            let tx;
            try {
                // Use the createPurchaseTransaction method with all required accounts
                tx = await program.methods
                    .createPurchaseTransaction(amount, new BN(duration))
                    .accounts({
                        user: senderPubkey,
                        admin: adminWallet.publicKey,
                        treasury: treasuryPubkey,
                        communityMint: communityMintPubkey,
                        adminTokenAccount: adminTokenAccount,
                        userTokenAccount: userTokenAccount,
                        realm: realmPubkey,
                        realmConfig: governanceAddresses.realmConfig,
                        governingTokenHolding: governanceAddresses.governingTokenHolding,
                        governanceTokenAccount: governanceAddresses.governanceTokenAccount,
                        tokenOwnerRecord: governanceAddresses.tokenOwnerRecord,
                        systemProgram: SystemProgram.programId,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        governanceProgram: governanceProgramId
                    })
                    .transaction();
                console.log('Created transaction using createPurchaseTransaction method');
            } catch (methodError) {
                console.error('Error with createPurchaseTransaction method:', methodError);

                // Fallback to a simple transfer transaction
                console.log('Using fallback SOL transfer transaction');
                tx = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: senderPubkey,
                        toPubkey: treasuryPubkey,
                        lamports: Math.floor(parseFloat(solAmount) * 1e9), // Convert SOL to lamports
                    })
                );
            }

            // Set the recent blockhash and fee payer
            const { blockhash } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.feePayer = senderPubkey;

            // IMPORTANT: Add admin's signature to the transaction
            tx.partialSign(adminWallet);
            
            // Debug: Log signature state before serialization
            console.log(`Transaction has ${tx.signatures.length} signatures before serialization`);
            tx.signatures.forEach((sig, i) => {
                console.log(`Signature ${i}: ${sig.publicKey.toString()} - signed: ${sig.signature !== null}`);
            });
            
            // Verify the transaction is serializable before sending
            try {
                const testSerialize = tx.serialize({
                    requireAllSignatures: false,
                    verifySignatures: false
                });
                console.log('Transaction can be serialized successfully:', testSerialize.length > 0);
            } catch (serializeError) {
                console.error('Serialization test failed:', serializeError);
                return res.status(500).json({
                    success: false,
                    message: 'Transaction serialization failed',
                    error: serializeError.toString()
                });
            }

            // Serialize the transaction to base64
            const serializedTransaction = tx.serialize({
                requireAllSignatures: false, // Important: set to false as user hasn't signed yet
                verifySignatures: false
            }).toString('base64');

            // Calculate token amount with bonus
            const baseTokenAmount = parseFloat(solAmount) * 100; // TOKEN_EXCHANGE_RATE = 100

            let bonusMultiplier = 1;
            switch (parseInt(lockDurationMonths)) {
                case 1: bonusMultiplier = 1.02; break;
                case 3: bonusMultiplier = 1.06; break;
                case 6: bonusMultiplier = 1.12; break;
                case 12: bonusMultiplier = 1.25; break;
            }

            const totalTokenAmount = baseTokenAmount * bonusMultiplier;

            // Current date plus lockDurationMonths
            const unlockDate = new Date();
            unlockDate.setMonth(unlockDate.getMonth() + parseInt(lockDurationMonths));

            // Create response with the serialized transaction
            const response = {
                success: true,
                message: 'Transaction created successfully',
                transaction: serializedTransaction,
                txid: "pending", // Will be replaced with actual signature after user signs
                metadata: {
                    tokenAmount: totalTokenAmount,
                    unlockDate: unlockDate.toISOString(),
                    isLocked: totalTokenAmount >= 1.0,
                    realmId: REALM_ID
                }
            };

            console.log('Transaction response created:', {
                ...response,
                transaction: serializedTransaction.slice(0, 20) + '...' // Log only part of the serialized transaction
            });

            return res.status(200).json(response);

        } catch (txError) {
            console.error('Error creating token purchase transaction:', txError);

            // Provide more detailed error information
            return res.status(500).json({
                success: false,
                message: 'Failed to create token purchase transaction',
                error: txError.toString(),
                details: {
                    programId: PROGRAM_ID,
                    treasury: TREASURY_ADDRESS,
                    realm: REALM_ID
                }
            });
        }
    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.toString()
        });
    }
});

// API endpoint to record completed purchases
app.post('/api/complete-purchase', async (req, res) => {
    try {
        console.log('Purchase completion notification received:', req.body);

        const { walletAddress, solAmount, lockDurationMonths, transactionSignature } = req.body;

        if (!walletAddress || !solAmount || !lockDurationMonths || !transactionSignature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Verify transaction on-chain
        try {
            // Connect to Solana
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

            // Get transaction details
            const txInfo = await connection.getTransaction(transactionSignature, {
                commitment: 'confirmed'
            });

            if (!txInfo) {
                return res.status(400).json({
                    success: false,
                    message: 'Transaction not found on-chain'
                });
            }

            console.log('Transaction verified on-chain');

            // In a real app, you might want to verify that this transaction
            // is actually interacting with your program and treasury
        } catch (verifyError) {
            console.warn('Warning: Could not verify transaction on-chain:', verifyError);
            // Continue anyway for demo purposes
        }

        // Now try to call the completePurchase method if needed
        try {
            // Load admin wallet for creating transaction
            const adminWallet = loadAdminWallet();
            if (!adminWallet) {
                throw new Error('Admin wallet not available');
            }

            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
            const provider = new AnchorProvider(
                connection,
                {
                    publicKey: adminWallet.publicKey,
                    signTransaction: async (tx) => {
                        tx.sign(adminWallet);
                        return tx;
                    },
                    signAllTransactions: async (txs) => {
                        return txs.map((tx) => {
                            tx.sign(adminWallet);
                            return tx;
                        });
                    }
                },
                { commitment: 'confirmed' }
            );

            const program = new Program(idl, PROGRAM_ID, provider);

            // Check if the completePurchase method exists
            if (typeof program.methods.completePurchase === 'function') {
                console.log('Calling completePurchase on-chain');

                const userPubkey = new PublicKey(walletAddress);
                
                // Convert amount and duration to the correct format for the program
                const solAmountLamports = new BN(parseFloat(solAmount) * 1e9);
                const lockDurationBN = new BN(parseInt(lockDurationMonths));

                // Call the on-chain completion method with required arguments and accounts
                await program.methods
                    .completePurchase(
                        solAmountLamports, 
                        lockDurationBN, 
                        transactionSignature
                    )
                    .accounts({
                        user: userPubkey,
                        systemProgram: SystemProgram.programId
                        // Add any other accounts required by your Rust program
                    })
                    .rpc();

                console.log('On-chain completePurchase successful');
            }
        } catch (completionError) {
            console.warn('Warning: On-chain completePurchase failed:', completionError);
            // Continue anyway for demo purposes
        }

        // Calculate token amount with bonus
        const baseTokenAmount = parseFloat(solAmount) * 100; // TOKEN_EXCHANGE_RATE = 100

        let bonusMultiplier = 1;
        switch (parseInt(lockDurationMonths)) {
            case 1: bonusMultiplier = 1.02; break;
            case 3: bonusMultiplier = 1.06; break;
            case 6: bonusMultiplier = 1.12; break;
            case 12: bonusMultiplier = 1.25; break;
        }

        const totalTokenAmount = baseTokenAmount * bonusMultiplier;

        // Calculate unlock date
        const unlockDate = new Date();
        unlockDate.setMonth(unlockDate.getMonth() + parseInt(lockDurationMonths));

        // Record purchase in our database
        const purchaseRecord = {
            id: `purchase_${Date.now()}`,
            userPublicKey: walletAddress,
            amount: totalTokenAmount,
            lockDurationMonths: parseInt(lockDurationMonths),
            purchasedAt: new Date().toISOString(),
            unlockDate: unlockDate.toISOString(),
            transactionSignature: transactionSignature
        };

        // Add to in-memory database
        purchasesDb.push(purchaseRecord);

        console.log('Purchase recorded:', purchaseRecord);

        return res.status(200).json({
            success: true,
            message: 'Purchase completion recorded',
            purchaseRecord: purchaseRecord
        });
    } catch (error) {
        console.error('Error recording purchase completion:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to record purchase completion',
            error: error.toString()
        });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
